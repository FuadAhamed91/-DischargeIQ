/**
 * Conversation state machine for WhatsApp interactions.
 *
 * States are persisted in `whatsapp_conversations.conversation_state`.
 * Transitions happen when a patient replies to an interactive message.
 */

export type ConversationState =
  | 'idle'
  | 'awaiting_appointment_confirm'
  | 'awaiting_slot_selection'
  | 'awaiting_reminder_response'

export type InboundMessageType =
  | 'text'
  | 'interactive_reply'       // button or list selection
  | 'audio'                   // voice note → triage
  | 'image'
  | 'document'
  | 'unknown'

export interface ParsedInbound {
  waMessageId: string
  from: string               // E.164 phone number
  type: InboundMessageType
  text?: string
  interactiveId?: string     // button/list reply ID (Meta only)
  interactiveTitle?: string
  audioId?: string           // Meta media object ID (Meta only)
  audioUrl?: string          // Twilio direct media URL
  audioMimeType?: string     // e.g. audio/ogg, audio/mpeg
  timestamp: number
}

export interface FsmResult {
  nextState: ConversationState
  action:
    | 'confirm_appointment'
    | 'start_reschedule'
    | 'log_reminder_response'
    | 'log_symptom_ok'
    | 'route_to_triage'
    | 'route_to_ai'
    | 'noop'
  appointmentId?: string
  slotId?: string
  reminderResponse?: string
}

/**
 * Given the current conversation state and an inbound message,
 * returns the next state and action to take.
 */
export function transition(
  state: ConversationState,
  message: ParsedInbound,
): FsmResult {
  if (message.type === 'audio') {
    return { nextState: 'idle', action: 'route_to_triage' }
  }

  switch (state) {
    case 'awaiting_appointment_confirm': {
      const id = message.interactiveId ?? ''
      // Meta interactive button replies
      if (id.startsWith('confirm_appt_')) {
        const appointmentId = id.replace('confirm_appt_', '')
        return { nextState: 'idle', action: 'confirm_appointment', appointmentId }
      }
      if (id.startsWith('reschedule_appt_')) {
        const appointmentId = id.replace('reschedule_appt_', '')
        return { nextState: 'awaiting_slot_selection', action: 'start_reschedule', appointmentId }
      }
      // Twilio text replies ("1", "YES", "CONFIRM" = confirm; "2", "NO" = reschedule)
      const textBody = (message.text ?? '').toUpperCase().trim()
      if (textBody === '1' || textBody === 'YES' || textBody === 'CONFIRM') {
        return { nextState: 'idle', action: 'confirm_appointment' }
      }
      if (textBody === '2' || textBody === 'NO' || textBody === 'RESCHEDULE') {
        return { nextState: 'awaiting_slot_selection', action: 'start_reschedule' }
      }
      return { nextState: 'idle', action: 'route_to_ai' }
    }

    case 'awaiting_slot_selection': {
      const id = message.interactiveId ?? ''
      if (id.startsWith('slot_')) {
        const slotId = id.replace('slot_', '')
        return { nextState: 'idle', action: 'confirm_appointment', slotId }
      }
      return { nextState: 'idle', action: 'route_to_ai' }
    }

    case 'awaiting_reminder_response': {
      const interactiveId = message.interactiveId
      if (interactiveId === 'symptom_good') {
        return { nextState: 'idle', action: 'log_symptom_ok' }
      }
      if (interactiveId === 'symptom_concern') {
        return { nextState: 'idle', action: 'route_to_triage' }
      }
      // Plain text reply (Twilio) or text fallback
      const body = (message.text ?? '').toUpperCase().trim()
      if (body === 'TAKEN' || body === 'DONE' || body === 'YES' || body === '1') {
        return { nextState: 'idle', action: 'log_reminder_response', reminderResponse: body }
      }
      if (body === '2' || body === 'CONCERN' || body === 'NO') {
        return { nextState: 'idle', action: 'route_to_triage' }
      }
      return { nextState: 'idle', action: 'route_to_ai' }
    }

    case 'idle':
    default:
      // Free-form text in idle state → AI Q&A
      return { nextState: 'idle', action: 'route_to_ai' }
  }
}
