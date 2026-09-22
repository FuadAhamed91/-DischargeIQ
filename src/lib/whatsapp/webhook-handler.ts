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
import { resolveHospital, isKnownNumber, findOpenEpisodesByPhone, getOrCreateConversation } from './recipient'
import type { ServiceClient, InboundHospital, InboundPatient, InboundEpisode } from './recipient'
import { alreadyHandled, logInbound } from './inbound-log'
import { loadNumberSession, saveNumberSession } from './number-session'
import { loadRoutingCandidates, askWhoIsThisAbout } from './shared-number'
import { routeInbound, sessionAfterDelivery, EMPTY_SESSION } from './routing'
import type { RoutedVia } from './routing'
import { buildNowAboutMessage } from './routing-templates'
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
import { transition, readConversationState } from './fsm'
import type { ParsedInbound } from './fsm'
import {
  buildCheckinSymptomQuestion,
  buildCheckinGoodnight,
  buildTriageReply,
} from './checkin-templates'
import {
  buildAppointmentConfirmedReply,
  buildRescheduleReply,
  buildNoPendingAppointmentReply,
} from './appointment-templates'
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
 *   ProfileName   = the sender's WhatsApp display name (not verified; useful on a shared phone)
 */
export function parseWebhookPayload(params: Record<string, string>): ParsedInbound[] {
  const from = (params.From ?? '').replace('whatsapp:', '')
  const sid = params.MessageSid ?? `twilio-${Date.now()}`
  const body = params.Body ?? ''
  const numMedia = parseInt(params.NumMedia ?? '0', 10)
  const mediaUrl = params.MediaUrl0 ?? ''
  const mediaContentType = params.MediaContentType0 ?? ''

  const senderName = (params.ProfileName ?? '').trim().slice(0, 80)
  const parsed: ParsedInbound = {
    waMessageId: sid,
    from,
    ...(senderName ? { senderName } : {}),
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

// ------------------------------------
// Triage persistence (voice notes, text symptom reports, nightly check-in)
// ------------------------------------

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
 * Stores a triage result and tells the patient what to do next. Shared by
 * every path that classifies a symptom report so the dashboard sees one shape.
 *
 * The alert and the episode risk level are NOT written here: migration 00003
 * has AFTER INSERT triggers on triage_assessments (create_alert_on_triage,
 * sync_episode_risk_on_triage) that do both — and assign the alert to the
 * nurse. Inserting them here as well produced two alerts per red triage.
 */
async function recordTriage(params: RecordTriageParams): Promise<void> {
  const { supabase, episodeId, hospitalId, patient, reply, triage, waMessageId, source } = params

  const { error } = await supabase
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
  if (error) throw new Error(`triage_assessments insert failed: ${error.message}`)

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

interface AwaitingAppointment {
  id: string
  specialty: string
  scheduled_at: string
  location: string | null
}

/** The appointment a YES/NO reply refers to: by id when the channel gave one, else the latest one asked about. */
async function findAwaitingAppointment(supabase: ServiceClient, episodeId: string, appointmentId?: string): Promise<AwaitingAppointment | null> {
  let query = supabase
    .from('appointments')
    .select('id, specialty, scheduled_at, location')
    .eq('episode_id', episodeId)
  query = appointmentId
    ? query.eq('id', appointmentId)
    : query.eq('status', 'confirmation_pending').order('confirmation_requested_at', { ascending: false, nullsFirst: false })
  const { data } = await query.limit(1).maybeSingle()
  return (data as AwaitingAppointment | null) ?? null
}

/** Model unavailable: hand the message to a nurse at medium rather than lose it. */
async function escalateUntriaged(
  supabase: ServiceClient,
  episodeId: string,
  hospitalId: string,
  reason: string,
  waMessageId: string,
  text?: string,
): Promise<void> {
  await supabase.from('alerts').insert({
    episode_id: episodeId,
    hospital_id: hospitalId,
    type: 'escalation',
    severity: 'medium',
  })
  await supabase.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: hospitalId,
    event_type: 'escalation_created',
    payload: { reason, intent: 'untriaged_symptom_report', severity: 'medium', text: text ?? null, wa_message_id: waMessageId },
    risk_level: 'yellow',
  })
}

// ------------------------------------
// Main handler
// ------------------------------------

export interface HandlerDeps {
  /** Injected by scripts/check-webhook.ts (in-memory fake); production uses the service client. */
  supabase?: ServiceClient
}

export async function handleInboundMessage(
  phoneNumberId: string,
  message: ParsedInbound,
  deps: HandlerDeps = {},
): Promise<void> {
  const supabase = deps.supabase ?? (await createServiceClient())

  // 0. A redelivered webhook carries a SID we have already answered.
  if (await alreadyHandled(supabase, message.waMessageId)) {
    console.warn('[WhatsApp] duplicate delivery ignored:', message.waMessageId)
    return
  }

  // 1. Resolve hospital from phone_number_id
  const hospital = await resolveHospital(supabase, phoneNumberId)
  if (!hospital) {
    console.error('[WhatsApp] No hospital found for phone_number_id:', phoneNumberId)
    return
  }

  // 2 + 3. Every open episode behind this number. A number is not unique to
  // one patient (a shared family phone, a tester's own number on several demo
  // patients); the old single-row lookup failed on the second registration
  // and answered "not registered" to a patient who very much was.
  const candidates = await findOpenEpisodesByPhone(supabase, hospital.id, message.from)

  if (candidates.length === 0) {
    if (await isKnownNumber(supabase, hospital.id, message.from)) {
      // Registered, but every episode is closed.
      await sendMessage(phoneNumberId, {
        type: 'text',
        to: message.from,
        body: `Hello,\n\nWe do not have an active care episode for this number at this time. Please contact the hospital if you have questions.`,
      })
    } else {
      await sendMessage(phoneNumberId, buildNotRegisteredMessage(message.from))
    }
    return
  }

  // 4. Which patient is this message about? One open episode: no question.
  // Several (a shared family phone, a caregiver, a tester's own number): the
  // number's session and the routing rules decide, and when they cannot,
  // the sender is asked and the message held until they answer.
  const shared = candidates.length > 1
  const session = shared ? await loadNumberSession(supabase, hospital.id, message.from) : EMPTY_SESSION
  if (session.pendingChoice?.held?.waMessageId === message.waMessageId) {
    // A held message is not logged until it is replayed, so the SID check
    // above cannot catch its redelivery.
    console.warn('[WhatsApp] duplicate delivery of a held message ignored:', message.waMessageId)
    return
  }

  const decision = routeInbound(await loadRoutingCandidates(supabase, candidates), session, message)

  if (decision.kind === 'ask') {
    await askWhoIsThisAbout({
      supabase,
      phoneNumberId,
      hospitalId: hospital.id,
      phone: message.from,
      options: decision.options,
      held: decision.held,
      repeat: decision.repeat,
      session,
    })
    return
  }

  const target = candidates.find((c) => c.patient.id === decision.candidate.patientId) ?? candidates[0]
  const routing = shared ? { via: decision.via, linkedPatients: candidates.length } : undefined
  if (shared) await saveNumberSession(supabase, hospital.id, message.from, sessionAfterDelivery(decision.candidate))

  if (decision.kind === 'switched') {
    await confirmSwitch({ supabase, phoneNumberId, hospital, patient: target.patient, episode: target.episode, message, routing })
    return
  }

  // A bare "2" answers the question and carries nothing to act on, but the
  // transcript should still show it next to the message it unlocked.
  if (decision.via === 'choice' && !decision.messages.some((m) => m.waMessageId === message.waMessageId)) {
    await logRoutingAnswer({ supabase, phoneNumberId, hospital, patient: target.patient, episode: target.episode, message, routing })
  }

  // A held message replays first, then the one that answered the question.
  for (const routed of decision.messages) {
    await processForPatient({ supabase, phoneNumberId, hospital, patient: target.patient, episode: target.episode, message: routed, routing })
  }
}

interface RoutingInfo {
  via: RoutedVia
  linkedPatients: number
}

interface PatientMessageParams {
  supabase: ServiceClient
  phoneNumberId: string
  hospital: InboundHospital
  patient: InboundPatient
  episode: InboundEpisode
  message: ParsedInbound
  /** Set when the number is linked to more than one patient: how this message was matched. */
  routing?: RoutingInfo
}

function routingMetadata(routing?: RoutingInfo): Record<string, unknown> | undefined {
  return routing ? { routing: { via: routing.via, linked_patients: routing.linkedPatients } } : undefined
}

/** The reply that only said who a message is about: recorded on that patient's transcript, nothing to act on. */
async function logRoutingAnswer(params: PatientMessageParams): Promise<'logged' | 'duplicate' | 'failed'> {
  const { supabase, hospital, patient, episode, message, routing } = params
  const conversation = await getOrCreateConversation(supabase, {
    episodeId: episode.id,
    hospitalId: hospital.id,
    patientId: patient.id,
    phone: message.from,
  })
  if (!conversation) return 'failed'
  const metadata = { ...routingMetadata(routing), answer: true }
  const logged = await logInbound({ supabase, conversationId: conversation.id, hospitalId: hospital.id, message, metadata })
  return logged.status
}

/** A bare name or a choice with nothing to pass on: log it, confirm who we are talking about now. */
async function confirmSwitch(params: PatientMessageParams): Promise<void> {
  const { supabase, phoneNumberId, hospital, patient, episode, message } = params
  if ((await logRoutingAnswer(params)) === 'duplicate') return
  await sendAndLog({
    supabase,
    phoneNumberId,
    message: buildNowAboutMessage({ to: message.from, patientName: patient.full_name, language: (patient.preferred_language as LanguageCode) ?? 'en' }),
    episodeId: episode.id,
    hospitalId: hospital.id,
    patientId: patient.id,
  })
}

// ------------------------------------
// One message, one patient
// ------------------------------------

async function processForPatient(params: PatientMessageParams): Promise<void> {
  const { supabase, phoneNumberId, hospital, patient, episode, message, routing } = params

  // 5. Get or create the conversation record (messages hang off it)
  const conversation = await getOrCreateConversation(supabase, {
    episodeId: episode.id,
    hospitalId: hospital.id,
    patientId: patient.id,
    phone: message.from,
  })
  if (!conversation) return

  const state = readConversationState(conversation.conversation_state).state

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

  // 6. Persist inbound message. The UNIQUE wa_message_id makes this the
  // claim: if another delivery of the same SID got here first, it is already
  // replying and this one must not (Twilio retries, double-taps).
  const logged = await logInbound({ supabase, conversationId: conversation.id, hospitalId: hospital.id, message, metadata: routingMetadata(routing) })
  if (logged.status === 'duplicate') {
    console.warn('[WhatsApp] duplicate delivery ignored:', message.waMessageId)
    return
  }
  const savedMsg = logged.status === 'logged' ? { id: logged.messageId } : null

  // 7. Run FSM
  const result = transition(state, message)

  // 8. Execute action
  const lang = (patient.preferred_language as LanguageCode) ?? 'en'

  switch (result.action) {
    case 'confirm_appointment': {
      // A text "1"/"YES" carries no id: take the appointment most recently
      // asked about. (Status is confirmation_pending — a stale lookup for
      // 'pending_confirmation' here meant a "1" confirmed nothing.)
      const appointment = await findAwaitingAppointment(supabase, episode.id, result.appointmentId)

      if (!appointment) {
        await reply(buildNoPendingAppointmentReply({ to: message.from, patientName: patient.full_name, language: lang }))
        break
      }

      await supabase
        .from('appointments')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', appointment.id)

      await reply(buildAppointmentConfirmedReply({
        to: message.from,
        patientName: patient.full_name,
        language: lang,
        appointment,
        timezone: hospital.timezone ?? 'Asia/Dubai',
      }))

      await supabase.from('patient_timeline_events').insert({
        episode_id: episode.id,
        hospital_id: hospital.id,
        event_type: 'appointment_confirmed',
        payload: { appointment_id: appointment.id, specialty: appointment.specialty, wa_message_id: message.waMessageId },
      })
      break
    }

    case 'start_reschedule': {
      const appointment = await findAwaitingAppointment(supabase, episode.id, result.appointmentId)

      await reply(buildRescheduleReply({
        to: message.from,
        patientName: patient.full_name,
        language: lang,
        specialty: appointment?.specialty ?? null,
      }))

      if (appointment) {
        await supabase
          .from('appointments')
          .update({ status: 'reschedule_pending', updated_at: new Date().toISOString() })
          .eq('id', appointment.id)
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'appointment_rescheduled',
          payload: { appointment_id: appointment.id, specialty: appointment.specialty, requested_by: 'patient', wa_message_id: message.waMessageId },
        })
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
          // Acknowledged already; make sure a nurse still sees that a voice
          // note came in and could not be assessed automatically.
          console.error('[Triage] failed:', err)
          await escalateUntriaged(supabase, episode.id, hospital.id, 'Voice note could not be transcribed or triaged automatically', message.waMessageId)
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
        await escalateUntriaged(supabase, episode.id, hospital.id, 'Symptom report could not be triaged automatically', message.waMessageId, text)
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
          model: chatResult.model ?? 'none',
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

  // 9. Update conversation state (the row is guaranteed to exist from step 5).
  // While a nurse is attending, keep the stored object (it carries the expiry)
  // instead of flattening it to a bare string.
  const keepAttending = result.nextState === 'nurse_attending' && state === 'nurse_attending'
  await supabase
    .from('whatsapp_conversations')
    .update({
      conversation_state: keepAttending ? conversation.conversation_state : result.nextState,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  // 10. Log timeline for outbound (generic)
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

  // 11. Mark as read
  await markAsRead(phoneNumberId, message.waMessageId)
}
