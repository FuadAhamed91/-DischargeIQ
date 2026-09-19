/**
 * Processes inbound WhatsApp webhook payloads from Twilio.
 *
 * Responsibilities:
 *  1. Parse the Twilio form-encoded payload into a normalised ParsedInbound struct.
 *  2. Resolve the patient + episode by phone number and Twilio sandbox number.
 *  3. Persist the raw message in whatsapp_messages.
 *  4. Run the FSM to decide next action.
 *  5. Dispatch the action (confirm appt, log reminder, route to AI/triage).
 *  6. Persist the timeline event.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { sendMessage, markAsRead } from './client'
import type { OutboundMessage } from './client'
import { sendAndLog } from './outbound'
import {
  buildNotRegisteredMessage,
  buildEscalationAcknowledgement,
  buildAcknowledgementReply,
  buildGreetingReply,
  buildEmergencyEscalationMessage,
} from './templates'
import { transition } from './fsm'
import type { ParsedInbound, ConversationState } from './fsm'
import {
  buildCheckinSymptomQuestion,
  buildCheckinGoodnight,
  buildTriageReply,
} from './checkin-templates'
import type { LanguageCode } from '@/types/enums'
import { classifyRisk, triageVoiceNote } from '@/lib/ai/triage'
import type { TriageResult } from '@/lib/ai/triage'
import { answerPatientQuestion } from '@/lib/ai/chat'
import { classifyPreIntent } from '@/lib/ai/intent'
import type { DischargeSummary, Medication } from '@/types/database'

// ------------------------------------
// Payload parsing (Twilio form data)
// ------------------------------------

/**
 * Parses a Twilio WhatsApp webhook (application/x-www-form-urlencoded).
 *
 * Key Twilio fields:
 *   From          = whatsapp:+971501234567
 *   To            = whatsapp:+14155238886
 *   Body          = message text
 *   MessageSid    = SMxxxxxx
 *   NumMedia      = number of attached media files
 *   MediaUrl0     = URL to media (requires Twilio Basic Auth to download)
 *   MediaContentType0 = e.g. audio/ogg, image/jpeg
 */
export function parseWebhookPayload(params: Record<string, string>): ParsedInbound[] {
  const from = (params.From ?? '').replace('whatsapp:', '')
  const sid = params.MessageSid ?? `twilio-${Date.now()}`
  const body = params.Body ?? ''
  const numMedia = parseInt(params.NumMedia ?? '0', 10)
  const mediaUrl = params.MediaUrl0 ?? ''
  const mediaContentType = params.MediaContentType0 ?? ''

  const parsed: ParsedInbound = {
    waMessageId: sid,
    from,
    type: 'unknown',
    timestamp: Math.floor(Date.now() / 1000),
  }

  if (numMedia > 0 && mediaContentType.startsWith('audio/')) {
    parsed.type = 'audio'
    parsed.audioUrl = mediaUrl
    parsed.audioMimeType = mediaContentType
  } else if (body.trim() !== '') {
    parsed.type = 'text'
    parsed.text = body
  }

  return [parsed]
}

/**
 * Extracts the Twilio sandbox number (the "To" field) to identify the hospital.
 * Returns the number in E.164 format (without "whatsapp:" prefix).
 */
export function extractPhoneNumberId(params: Record<string, string>): string | null {
  const to = params.To ?? ''
  return to.replace('whatsapp:', '') || null
}

const KNOWN_STATES: ReadonlySet<string> = new Set<ConversationState>([
  'idle',
  'awaiting_appointment_confirm',
  'awaiting_slot_selection',
  'awaiting_reminder_response',
  'awaiting_checkin_meds',
  'awaiting_checkin_symptoms',
])

/**
 * conversation_state is jsonb. The episode-activation trigger seeds it as
 * {"state": "idle"} while this handler and the dispatcher store a plain
 * string; accept both and fall back to idle for anything unrecognised.
 */
function normaliseState(raw: unknown): ConversationState {
  const value =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'state' in raw
        ? String((raw as { state: unknown }).state)
        : 'idle'
  return (KNOWN_STATES.has(value) ? value : 'idle') as ConversationState
}

// ------------------------------------
// Triage persistence (voice notes, text symptom reports, nightly check-in)
// ------------------------------------

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>

interface RecordTriageParams {
  supabase: ServiceClient
  episodeId: string
  hospitalId: string
  patient: { full_name: string; language: LanguageCode; to: string }
  reply: (outbound: OutboundMessage) => Promise<unknown>
  triage: TriageResult
  waMessageId: string
  source: 'voice' | 'text' | 'nightly_checkin'
  voiceArtifactId?: string | null
}

/**
 * Stores a triage result, moves the episode's risk level, raises the nurse
 * alert for yellow/red and tells the patient what to do next. Shared by every
 * path that classifies a symptom report so the dashboard sees one shape.
 */
async function recordTriage(params: RecordTriageParams): Promise<void> {
  const { supabase, episodeId, hospitalId, patient, reply, triage, waMessageId, source } = params

  const { data: assessment } = await supabase
    .from('triage_assessments')
    .insert({
      episode_id: episodeId,
      hospital_id: hospitalId,
      voice_artifact_id: params.voiceArtifactId ?? null,
      inbound_text: triage.transcript,
      risk_level: triage.riskLevel,
      matched_symptoms: triage.keySymptoms,
      reasoning: triage.reasoning,
      model_version: 'gemini-2.5-flash',
    })
    .select('id')
    .single()

  await supabase
    .from('care_episodes')
    .update({ current_risk_level: triage.riskLevel })
    .eq('id', episodeId)

  if (triage.riskLevel !== 'green') {
    await supabase.from('alerts').insert({
      episode_id: episodeId,
      hospital_id: hospitalId,
      triage_id: assessment?.id ?? null,
      type: triage.riskLevel === 'red' ? 'risk_red' : 'risk_yellow',
      severity: triage.riskLevel === 'red' ? 'critical' : 'medium',
    })
  }

  await reply(buildTriageReply({
    to: patient.to,
    patientName: patient.full_name,
    language: patient.language,
    riskLevel: triage.riskLevel,
  }))

  await supabase.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: hospitalId,
    event_type: 'triage_completed',
    payload: {
      risk_level: triage.riskLevel,
      transcript: triage.transcript,
      key_symptoms: triage.keySymptoms,
      source,
      wa_message_id: waMessageId,
    },
    risk_level: triage.riskLevel,
  })
}

// ------------------------------------
// Main handler
// ------------------------------------

export async function handleInboundMessage(
  phoneNumberId: string,
  message: ParsedInbound,
): Promise<void> {
  const supabase = await createServiceClient()

  // 1. Resolve hospital from phone_number_id
  const { data: hospital } = await supabase
    .from('hospitals')
    .select('id, name, timezone, settings')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .single()

  if (!hospital) {
    console.error('[WhatsApp] No hospital found for phone_number_id:', phoneNumberId)
    return
  }

  // 2. Resolve patient
  const { data: patient } = await supabase
    .from('patients')
    .select('id, full_name, preferred_language, hospital_id')
    .eq('hospital_id', hospital.id)
    .eq('phone_e164', message.from)
    .single()

  if (!patient) {
    await sendMessage(phoneNumberId, buildNotRegisteredMessage(message.from))
    return
  }

  // 3. Find active episode
  const { data: episode } = await supabase
    .from('care_episodes')
    .select('id, status')
    .eq('patient_id', patient.id)
    .eq('hospital_id', hospital.id)
    .in('status', ['active', 'pending_review'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!episode) {
    await sendMessage(phoneNumberId, {
      type: 'text',
      to: message.from,
      body: `Hi ${patient.full_name},\n\nWe do not have an active care episode for you at this time. Please contact the hospital if you have questions.`,
    })
    return
  }

  // 4. Get or create the conversation record (messages hang off it)
  let { data: conversation } = await supabase
    .from('whatsapp_conversations')
    .select('id, conversation_state')
    .eq('episode_id', episode.id)
    .maybeSingle()

  if (!conversation) {
    const { data: created, error: convErr } = await supabase
      .from('whatsapp_conversations')
      .insert({
        episode_id: episode.id,
        hospital_id: hospital.id,
        patient_id: patient.id,
        wa_phone: message.from,
        conversation_state: 'idle',
      })
      .select('id, conversation_state')
      .single()
    if (convErr || !created) {
      console.error('[WhatsApp] could not create conversation:', convErr?.message)
      return
    }
    conversation = created
  }

  const state = normaliseState(conversation.conversation_state)

  // Every reply from here on is sent AND recorded on the conversation so the
  // dashboard transcript shows both sides. Conversation state is set in step 8.
  const reply = (outbound: OutboundMessage) =>
    sendAndLog({
      supabase,
      phoneNumberId,
      message: outbound,
      episodeId: episode.id,
      hospitalId: hospital.id,
      patientId: patient.id,
    })

  // 5. Persist inbound message
  const { data: savedMsg, error: msgErr } = await supabase
    .from('whatsapp_messages')
    .insert({
      conversation_id: conversation.id,
      hospital_id: hospital.id,
      wa_message_id: message.waMessageId,
      direction: 'inbound',
      message_type: message.type === 'audio' ? 'audio' : message.type === 'interactive_reply' ? 'interactive' : 'text',
      content: message.text ?? message.interactiveTitle ?? '',
      status: 'delivered',
    })
    .select('id')
    .single()
  if (msgErr) console.error('[WhatsApp] could not persist inbound message:', msgErr.message)

  // 6. Run FSM
  const result = transition(state, message)

  // 7. Execute action
  const lang = (patient.preferred_language as LanguageCode) ?? 'en'

  switch (result.action) {
    case 'confirm_appointment': {
      // appointmentId may be missing when patient typed "YES" (Twilio text reply)
      let appointmentId = result.appointmentId
      if (!appointmentId) {
        const { data: pendingAppt } = await supabase
          .from('appointments')
          .select('id')
          .eq('episode_id', episode.id)
          .eq('status', 'pending_confirmation')
          .order('scheduled_at', { ascending: true })
          .limit(1)
          .single()
        appointmentId = pendingAppt?.id
      }

      if (appointmentId) {
        await supabase
          .from('appointments')
          .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
          .eq('id', appointmentId)

        await reply({
          type: 'text',
          to: message.from,
          body: `✅ Thank you ${patient.full_name}! Your appointment has been confirmed. We look forward to seeing you.`,
        })

        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'appointment_confirmed',
          payload: { appointment_id: appointmentId, wa_message_id: message.waMessageId },
        })
      }
      break
    }

    case 'start_reschedule': {
      let appointmentId = result.appointmentId
      if (!appointmentId) {
        const { data: pendingAppt } = await supabase
          .from('appointments')
          .select('id')
          .eq('episode_id', episode.id)
          .eq('status', 'pending_confirmation')
          .order('scheduled_at', { ascending: true })
          .limit(1)
          .single()
        appointmentId = pendingAppt?.id
      }

      const specialty = appointmentId
        ? (await supabase.from('appointments').select('specialty').eq('id', appointmentId).single()).data?.specialty
        : 'follow-up'

      await reply({
        type: 'text',
        to: message.from,
        body: `We understand, ${patient.full_name}. 🙏\n\nPlease contact the hospital to reschedule your *${specialty ?? 'follow-up'}* appointment, or reply with your preferred date and a nurse will assist you.`,
      })

      if (appointmentId) {
        await supabase
          .from('appointments')
          .update({ status: 'reschedule_pending' })
          .eq('id', appointmentId)
      }
      break
    }

    case 'log_reminder_response':
    case 'log_symptom_ok': {
      await supabase.from('patient_timeline_events').insert({
        episode_id: episode.id,
        hospital_id: hospital.id,
        event_type: 'reminder_response',
        payload: {
          response: result.reminderResponse ?? 'symptom_ok',
          wa_message_id: message.waMessageId,
          message_id: savedMsg?.id,
        },
      })
      // Simple acknowledgement
      await reply({
        type: 'text',
        to: message.from,
        body: `Thank you, ${patient.full_name}! ✅ Keep it up!`,
      })
      break
    }

    case 'route_to_triage': {
      // Always acknowledge immediately so patient isn't left waiting
      await reply(buildEscalationAcknowledgement({
        to: message.from,
        patientName: patient.full_name,
      }))

      if (message.audioUrl) {
        try {
          // Load emergency symptoms from approved summary
          const { data: summary } = await supabase
            .from('discharge_summaries')
            .select('emergency_symptoms')
            .eq('episode_id', episode.id)
            .single()

          const triageResult = await triageVoiceNote({
            audioUrl: message.audioUrl,
            audioMimeType: message.audioMimeType,
            emergencySymptoms: (summary?.emergency_symptoms as string[]) ?? [],
            patientName: patient.full_name,
          })

          // Persist voice artifact (only if we have a saved message row)
          let voiceArtifactId: string | null = null
          if (savedMsg?.id) {
            const { data: voiceArtifact } = await supabase
              .from('voice_artifacts')
              .insert({
                episode_id: episode.id,
                hospital_id: hospital.id,
                message_id: savedMsg.id,
                audio_storage_path: `voice/${episode.id}/${message.audioId}`,
                transcript: triageResult.transcript,
              })
              .select('id')
              .single()
            voiceArtifactId = voiceArtifact?.id ?? null
          }

          await recordTriage({
            supabase,
            episodeId: episode.id,
            hospitalId: hospital.id,
            patient: { full_name: patient.full_name, language: lang, to: message.from },
            reply,
            triage: triageResult,
            waMessageId: message.waMessageId,
            source: 'voice',
            voiceArtifactId,
          })
        } catch (err) {
          console.error('[Triage] failed:', err)
          // Already sent acknowledgement above — no further action needed
        }
      }
      break
    }

    case 'triage_text': {
      // Free-text symptom report (nightly check-in answer, or instead of one).
      const text = (message.text ?? '').trim()
      try {
        const { data: summary } = await supabase
          .from('discharge_summaries')
          .select('emergency_symptoms')
          .eq('episode_id', episode.id)
          .maybeSingle()

        const triage = await classifyRisk({
          transcript: text,
          emergencySymptoms: (summary?.emergency_symptoms as string[]) ?? [],
          patientName: patient.full_name,
        })

        await recordTriage({
          supabase,
          episodeId: episode.id,
          hospitalId: hospital.id,
          patient: { full_name: patient.full_name, language: lang, to: message.from },
          reply,
          triage,
          waMessageId: message.waMessageId,
          source: state === 'idle' ? 'text' : 'nightly_checkin',
        })
      } catch (err) {
        // The model is down or returned garbage: never drop a symptom report
        // on the floor. Acknowledge, and hand it to a nurse at medium.
        console.error('[Triage text] failed:', err)
        await reply(buildEscalationAcknowledgement({ to: message.from, patientName: patient.full_name }))
        await supabase.from('alerts').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          type: 'escalation',
          severity: 'medium',
        })
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'escalation_created',
          payload: { reason: 'Symptom report could not be triaged automatically', text, wa_message_id: message.waMessageId },
          risk_level: 'yellow',
        })
      }
      break
    }

    case 'log_checkin_meds': {
      const taken = result.medsTaken ?? 'all'

      // Tie the answer to the latest check-in job when there is one.
      const { data: job } = await supabase
        .from('reminder_jobs')
        .select('id')
        .eq('episode_id', episode.id)
        .eq('status', 'sent')
        .order('fire_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // reminder_response feeds the adherence metrics, so it is only written
      // when at least some medicines were taken; "none" becomes an escalation.
      if (taken !== 'none') {
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'reminder_response',
          payload: {
            response: taken,
            source: 'nightly_checkin',
            job_id: job?.id ?? null,
            wa_message_id: message.waMessageId,
            message_id: savedMsg?.id,
          },
        })
      }

      if (taken !== 'all') {
        const severity = taken === 'none' ? 'medium' : 'low'
        await supabase.from('alerts').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          type: 'missed_medication',
          severity,
        })
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'escalation_created',
          payload: {
            reason: taken === 'none' ? 'Patient took none of their medicines today' : 'Patient missed some medicines today',
            intent: 'missed_medication',
            severity,
            job_id: job?.id ?? null,
            wa_message_id: message.waMessageId,
          },
          risk_level: taken === 'none' ? 'yellow' : null,
        })
      }

      await reply(buildCheckinSymptomQuestion({
        to: message.from,
        patientName: patient.full_name,
        language: lang,
        medsTaken: taken,
      }))
      break
    }

    case 'checkin_ok': {
      await reply(buildCheckinGoodnight({ to: message.from, patientName: patient.full_name, language: lang }))
      break
    }

    case 'route_to_ai': {
      const text = message.text ?? ''
      const preIntent = classifyPreIntent(text)

      // Emergency keyword: instant, deterministic, critical — no model in the loop.
      if (preIntent === 'emergency') {
        await reply(buildEmergencyEscalationMessage({ to: message.from, patientName: patient.full_name }))
        await supabase.from('alerts').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          type: 'escalation',
          severity: 'critical',
        })
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'escalation_created',
          payload: { reason: 'Emergency keyword in patient message', intent: 'emergency', wa_message_id: message.waMessageId },
          risk_level: 'red',
        })
        break
      }

      // Plain acknowledgement or greeting: reply instantly, no model, no alert.
      // (These used to be sent to the model, which escalated them as "unanswerable".)
      if (preIntent === 'acknowledgement' || preIntent === 'greeting') {
        const instantReply = preIntent === 'greeting'
          ? buildGreetingReply({ to: message.from, patientName: patient.full_name, language: lang })
          : buildAcknowledgementReply({ to: message.from, patientName: patient.full_name, language: lang })
        await reply(instantReply)
        break
      }

      try {
        // Load discharge context
        const { data: summary } = await supabase
          .from('discharge_summaries')
          .select('*, medications(*)')
          .eq('episode_id', episode.id)
          .single()

        const { data: guidance } = await supabase
          .from('hospital_approved_guidance')
          .select('category, answer')
          .eq('hospital_id', hospital.id)
          .eq('is_active', true)

        const chatResult = await answerPatientQuestion({
          question: text,
          patientName: patient.full_name,
          language: (lang as string) ?? 'en',
          summary: summary as unknown as DischargeSummary,
          medications: (summary as unknown as { medications: Medication[] })?.medications ?? [],
          approvedGuidance: (guidance ?? []).map((g) => ({
            category: g.category as string,
            answer: g.answer as Record<string, string>,
          })),
        })

        // Send AI answer to patient
        await reply({
          type: 'text',
          to: message.from,
          body: chatResult.answer,
        })

        // Escalation is derived from the classified intent (lib/ai/chat.ts):
        // never for acknowledgements/greetings, low for out-of-scope questions,
        // medium/high for reported concerns.
        if (chatResult.shouldEscalate) {
          const severity = chatResult.severity ?? 'low'
          await supabase.from('alerts').insert({
            episode_id: episode.id,
            hospital_id: hospital.id,
            type: 'escalation',
            severity,
          })
          await supabase.from('patient_timeline_events').insert({
            episode_id: episode.id,
            hospital_id: hospital.id,
            event_type: 'escalation_created',
            payload: {
              reason: chatResult.escalationReason ?? null,
              intent: chatResult.intent,
              severity,
              wa_message_id: message.waMessageId,
            },
            risk_level: severity === 'high' ? 'red' : severity === 'medium' ? 'yellow' : null,
          })
        }

        await supabase.from('ai_interactions').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          input_type: 'text',
          model: 'gemini-2.5-flash',
          input_text: text,
          output_text: chatResult.answer,
          confidence: chatResult.confidence === 'high' ? 0.9 : chatResult.confidence === 'medium' ? 0.6 : 0.3,
          escalated: chatResult.shouldEscalate,
        })

        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'ai_response',
          payload: {
            question: text,
            intent: chatResult.intent,
            escalated: chatResult.shouldEscalate,
            wa_message_id: message.waMessageId,
          },
        })
      } catch (err) {
        console.error('[AI chat] failed:', err)
        await reply({
          type: 'text',
          to: message.from,
          body: `Thank you for your message, ${patient.full_name}. 💙\n\nA member of your care team will follow up with you shortly.\n\n_If this is urgent, please call emergency services._`,
        })
        await supabase.from('alerts').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          type: 'escalation',
          severity: 'low',
        })
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'escalation_created',
          payload: { reason: 'AI assistant unavailable', intent: 'unknown', severity: 'low', wa_message_id: message.waMessageId },
        })
      }
      break
    }

    case 'noop':
    default:
      break
  }

  // 8. Update conversation state (the row is guaranteed to exist from step 4)
  await supabase
    .from('whatsapp_conversations')
    .update({
      conversation_state: result.nextState,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  // 9. Log timeline for outbound (generic)
  await supabase.from('patient_timeline_events').insert({
    episode_id: episode.id,
    hospital_id: hospital.id,
    event_type: 'whatsapp_inbound',
    payload: {
      wa_message_id: message.waMessageId,
      type: message.type,
      state_transition: { from: state, to: result.nextState, action: result.action },
    },
  })

  // 10. Mark as read
  await markAsRead(phoneNumberId, message.waMessageId)
}
