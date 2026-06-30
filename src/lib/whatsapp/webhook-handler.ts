/**
 * Processes inbound WhatsApp webhook payloads.
 *
 * Responsibilities:
 *  1. Parse the Meta payload into a normalised ParsedInbound struct.
 *  2. Resolve the patient + episode by phone number and WhatsApp phone_number_id.
 *  3. Persist the raw message in whatsapp_messages.
 *  4. Run the FSM to decide next action.
 *  5. Dispatch the action (confirm appt, log reminder, route to AI/triage).
 *  6. Persist the timeline event.
 *  7. Acknowledge read receipt.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { sendMessage, markAsRead } from './client'
import {
  buildAppointmentConfirmationRequest,
  buildSlotSelectionMessage,
  buildNotRegisteredMessage,
  buildEscalationAcknowledgement,
} from './templates'
import { transition } from './fsm'
import type { ParsedInbound, ConversationState } from './fsm'
import type { LanguageCode } from '@/types/enums'

// ------------------------------------
// Payload parsing
// ------------------------------------

export function parseWebhookPayload(body: Record<string, unknown>): ParsedInbound[] {
  const results: ParsedInbound[] = []

  const entry = (body.entry as Array<Record<string, unknown>>)?.[0]
  if (!entry) return results

  const changes = entry.changes as Array<Record<string, unknown>>
  if (!changes) return results

  for (const change of changes) {
    const value = change.value as Record<string, unknown>
    if (!value || (value.object as string) === 'whatsapp_business_account') {
      // status update, not a message — skip
    }

    const messages = value.messages as Array<Record<string, unknown>>
    if (!messages) continue

    for (const msg of messages) {
      const type = msg.type as string
      const parsed: ParsedInbound = {
        waMessageId: msg.id as string,
        from: msg.from as string,
        type: 'unknown',
        timestamp: Number(msg.timestamp),
      }

      if (type === 'text') {
        parsed.type = 'text'
        parsed.text = (msg.text as Record<string, string>)?.body
      } else if (type === 'interactive') {
        parsed.type = 'interactive_reply'
        const interactive = msg.interactive as Record<string, unknown>
        const interType = interactive?.type as string
        if (interType === 'button_reply') {
          const reply = interactive.button_reply as Record<string, string>
          parsed.interactiveId = reply.id
          parsed.interactiveTitle = reply.title
        } else if (interType === 'list_reply') {
          const reply = interactive.list_reply as Record<string, string>
          parsed.interactiveId = reply.id
          parsed.interactiveTitle = reply.title
        }
      } else if (type === 'audio') {
        parsed.type = 'audio'
        parsed.audioId = (msg.audio as Record<string, string>)?.id
      } else if (type === 'image') {
        parsed.type = 'image'
      } else if (type === 'document') {
        parsed.type = 'document'
      }

      results.push(parsed)
    }
  }

  return results
}

export function extractPhoneNumberId(body: Record<string, unknown>): string | null {
  const entry = (body.entry as Array<Record<string, unknown>>)?.[0]
  const change = (entry?.changes as Array<Record<string, unknown>>)?.[0]
  const value = change?.value as Record<string, unknown>
  return (value?.metadata as Record<string, string>)?.phone_number_id ?? null
}

// ------------------------------------
// Main handler
// ------------------------------------

export async function handleInboundMessage(
  phoneNumberId: string,
  message: ParsedInbound,
): Promise<void> {
  const supabase = createServiceClient()

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

  // 4. Get or create conversation record
  const { data: conversation } = await supabase
    .from('whatsapp_conversations')
    .select('id, conversation_state')
    .eq('episode_id', episode.id)
    .single()

  const state: ConversationState =
    (conversation?.conversation_state as ConversationState) ?? 'idle'

  // 5. Persist inbound message
  const { data: savedMsg } = await supabase
    .from('whatsapp_messages')
    .insert({
      episode_id: episode.id,
      hospital_id: hospital.id,
      wa_message_id: message.waMessageId,
      direction: 'inbound',
      message_type: message.type === 'audio' ? 'audio' : message.type === 'interactive_reply' ? 'interactive' : 'text',
      content: message.text ?? message.interactiveTitle ?? '',
      status: 'delivered',
    })
    .select('id')
    .single()

  // 6. Run FSM
  const result = transition(state, message)

  // 7. Execute action
  const lang = (patient.preferred_language as LanguageCode) ?? 'en'

  switch (result.action) {
    case 'confirm_appointment': {
      if (result.appointmentId) {
        await supabase
          .from('appointments')
          .update({ status: 'confirmed', confirmed_at: new Date().toISOString() })
          .eq('id', result.appointmentId)

        await sendMessage(phoneNumberId, {
          type: 'text',
          to: message.from,
          body: `✅ Thank you ${patient.full_name}! Your appointment has been confirmed. We look forward to seeing you.`,
        })

        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'appointment_confirmed',
          payload: { appointment_id: result.appointmentId, wa_message_id: message.waMessageId },
        })
      }
      break
    }

    case 'start_reschedule': {
      if (result.appointmentId) {
        const { data: appt } = await supabase
          .from('appointments')
          .select('specialty')
          .eq('id', result.appointmentId)
          .single()

        // For now send a manual reschedule instruction (Phase 3 adds real slot fetching)
        await sendMessage(phoneNumberId, {
          type: 'text',
          to: message.from,
          body: `We understand, ${patient.full_name}. 🙏\n\nPlease contact the hospital to reschedule your *${appt?.specialty ?? 'follow-up'}* appointment, or reply with your preferred date and a nurse will assist you.`,
        })

        await supabase
          .from('appointments')
          .update({ status: 'reschedule_pending' })
          .eq('id', result.appointmentId)
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
      await sendMessage(phoneNumberId, {
        type: 'text',
        to: message.from,
        body: `Thank you, ${patient.full_name}! ✅ Keep it up!`,
      })
      break
    }

    case 'route_to_triage': {
      if (message.audioId) {
        // Persist audio reference and queue async triage (Phase 4 adds real Whisper + Gemini)
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'whatsapp_inbound',
          payload: {
            type: 'audio',
            audio_id: message.audioId,
            wa_message_id: message.waMessageId,
          },
        })
        await sendMessage(phoneNumberId, buildEscalationAcknowledgement({
          to: message.from,
          patientName: patient.full_name,
        }))
      } else {
        await sendMessage(phoneNumberId, buildEscalationAcknowledgement({
          to: message.from,
          patientName: patient.full_name,
        }))
      }
      break
    }

    case 'route_to_ai': {
      // Phase 4 adds real Gemini Q&A; for now send a care-team escalation message
      const text = message.text ?? ''
      await supabase.from('patient_timeline_events').insert({
        episode_id: episode.id,
        hospital_id: hospital.id,
        event_type: 'whatsapp_inbound',
        payload: { text, wa_message_id: message.waMessageId },
      })

      await sendMessage(phoneNumberId, {
        type: 'text',
        to: message.from,
        body: `Thank you for your message, ${patient.full_name}. 💙\n\nYour question has been received and a member of your care team will follow up with you shortly.\n\n_If this is urgent, please call emergency services._`,
      })

      // Create a nurse alert for inbound text questions
      await supabase.from('alerts').insert({
        episode_id: episode.id,
        hospital_id: hospital.id,
        type: 'patient_question',
        message: text.slice(0, 500),
        risk_level: 'green',
        status: 'open',
      })
      break
    }

    case 'noop':
    default:
      break
  }

  // 8. Update conversation state
  if (conversation) {
    await supabase
      .from('whatsapp_conversations')
      .update({ conversation_state: result.nextState, updated_at: new Date().toISOString() })
      .eq('id', conversation.id)
  } else {
    await supabase.from('whatsapp_conversations').insert({
      episode_id: episode.id,
      hospital_id: hospital.id,
      patient_phone: message.from,
      conversation_state: result.nextState,
    })
  }

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
