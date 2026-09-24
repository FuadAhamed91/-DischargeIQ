/**
 * Conversation state machine for WhatsApp interactions.
 *
 * States are persisted in `whatsapp_conversations.conversation_state`.
 * Transitions happen when a patient replies to an interactive message.
 */

import { containsEmergencyKeyword, isAcknowledgement, normaliseMessage } from '@/lib/ai/intent'
import { parseSlotReply } from '@/lib/appointments/slots'
import type { MedsTaken } from './checkin-templates'

export type ConversationState =
  | 'idle'
  | 'awaiting_appointment_confirm'
  | 'awaiting_slot_selection'
  | 'awaiting_reminder_response'   // legacy per-dose reminders
  | 'awaiting_checkin_meds'        // nightly check-in Q1: did you take your medicines?
  | 'awaiting_checkin_symptoms'    // nightly check-in Q2: how are you feeling?
  | 'nurse_attending'              // a nurse is chatting from the dashboard: assistant stays quiet

/** How long a nurse message keeps the assistant quiet before the conversation returns to idle. */
export const NURSE_ATTENDING_MS = 30 * 60 * 1000

export interface ConversationStateRecord {
  state: ConversationState
  /** nurse_attending only: ISO time after which the assistant answers again */
  until?: string
  /** nurse_attending only: profile id of the nurse who last wrote */
  by?: string
}

const KNOWN_STATES = new Set<string>([
  'idle',
  'awaiting_appointment_confirm',
  'awaiting_slot_selection',
  'awaiting_reminder_response',
  'awaiting_checkin_meds',
  'awaiting_checkin_symptoms',
  'nurse_attending',
])

/**
 * whatsapp_conversations.conversation_state is jsonb and has been written three
 * ways over time: the activation trigger seeds {"state":"idle"}, the handler and
 * dispatcher store a bare string, and nurse chat stores {"state":"nurse_attending",
 * "until": ..., "by": ...}. Read all of them; an expired nurse_attending is idle.
 */
export function readConversationState(raw: unknown, now: Date = new Date()): ConversationStateRecord {
  let state = 'idle'
  let until: string | undefined
  let by: string | undefined
  if (typeof raw === 'string') {
    state = raw
  } else if (raw && typeof raw === 'object' && 'state' in raw) {
    const obj = raw as { state?: unknown; until?: unknown; by?: unknown }
    state = String(obj.state ?? 'idle')
    if (typeof obj.until === 'string') until = obj.until
    if (typeof obj.by === 'string') by = obj.by
  }
  if (!KNOWN_STATES.has(state)) state = 'idle'
  if (state === 'nurse_attending' && (!until || Date.parse(until) <= now.getTime())) {
    return { state: 'idle' }
  }
  return { state: state as ConversationState, until, by }
}

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
  /** The sender's WhatsApp profile name (Twilio ProfileName) — who is actually typing on a shared phone */
  senderName?: string
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
    | 'start_reschedule'       // "2": offer new times (lib/whatsapp/reschedule.ts)
    | 'choose_slot'            // a number / "none" / a date answering the times offered: move the appointment, or hand it to a nurse
    | 'log_reminder_response'
    | 'log_symptom_ok'
    | 'log_checkin_meds'      // nightly Q1 answered → record, then ask Q2
    | 'checkin_ok'            // nightly Q2 answered "fine" → say good night
    | 'triage_text'           // free-text symptom report → AI risk classification
    | 'route_to_triage'       // voice note → transcribe + classify
    | 'route_to_ai'
    | 'unsupported_media'     // picture / document with no caption → say we cannot read it
    | 'noop'
  appointmentId?: string
  /** choose_slot: the reply to read against the times offered (a list-row id, a number, a date, free text) */
  slotReply?: string
  reminderResponse?: string
  medsTaken?: MedsTaken
}

// ------------------------------------
// Nightly check-in answer parsing
// ------------------------------------

// Whole-message matches after normalisation. "no" lives under NONE because in
// answer to "did you take all your medicines?" it means none were taken.
const MEDS_NONE = new Set([
  '3', 'no', 'none', 'nothing', 'not yet', 'missed', 'forgot', 'i forgot', 'did not', 'didnt', 'not taken', 'no i did not', 'nope',
  'لا', 'لم اتناول', 'لم آخذ', 'لا شيء', 'ولا واحد', 'نسيت',
  'नहीं', 'नहीं ली', 'एक भी नहीं', 'भूल गया', 'भूल गयी', 'nahi', 'nahin', 'bhool gaya',
  'இல்லை', 'எடுக்கவில்லை', 'எதுவும் இல்லை', 'மறந்துவிட்டேன்', 'illai',
  'hindi', 'wala', 'hindi ko nainom', 'nakalimutan ko',
])

const MEDS_SOME = new Set([
  '2', 'some', 'a few', 'few', 'partly', 'partially', 'partial', 'most', 'most of them', 'some of them', 'not all', 'missed one', 'missed some', 'half',
  'بعض', 'بعضها', 'ليس كلها', 'معظمها',
  'कुछ', 'कुछ ली', 'सब नहीं', 'आधी', 'kuch', 'kuch li',
  'சில', 'சிலவற்றை', 'எல்லாம் இல்லை', 'sila',
  'ilan', 'ang ilan', 'ilan lang', 'hindi lahat', 'karamihan',
])

const MEDS_ALL = new Set([
  '1', 'all', 'yes all', 'all of them', 'took all', 'taken all', 'all taken', 'yes taken', 'everything', 'complete', 'completed',
  'كلها', 'نعم كلها', 'جميعها', 'الكل',
  'सभी', 'हाँ सभी', 'सब', 'सब ली', 'sab', 'sabhi', 'haan sab',
  'அனைத்தும்', 'ஆம் அனைத்தும்', 'எல்லாம்', 'ellam',
  'lahat', 'oo lahat', 'nainom ko lahat',
])

const FEELING_OK = new Set([
  'ok', 'okay', 'k', 'fine', 'good', 'im fine', 'i am fine', 'im ok', 'i am ok', 'all good', 'feeling fine', 'feeling good', 'feeling ok',
  'no', 'nothing', 'none', 'no symptoms', 'no problem', 'no problems', 'no pain', 'better', 'much better', 'well', 'great', 'normal', '1',
  'بخير', 'انا بخير', 'أنا بخير', 'تمام', 'الحمد لله', 'لا شيء', 'لا اعراض', 'كويس', 'ممتاز',
  'ठीक', 'ठीक हूँ', 'ठीक हूं', 'मैं ठीक हूँ', 'अच्छा', 'अच्छी', 'सब ठीक', 'कोई दिक्कत नहीं', 'theek', 'theek hoon', 'thik hu', 'sab theek', 'accha', 'badhiya',
  'நலம்', 'நன்றாக', 'நன்றாக இருக்கிறேன்', 'நலமாக இருக்கிறேன்', 'பரவாயில்லை', 'எதுவும் இல்லை', 'nalam', 'nalla irukken',
  'ayos', 'ayos lang', 'ok lang', 'okay lang', 'maayos', 'maayos naman', 'mabuti', 'mabuti naman', 'wala', 'walang sintomas', 'walang problema',
])

/** Interprets a reply to "Did you take all your medicines today?", or null if it isn't one. */
export function parseMedsAnswer(text: string): MedsTaken | null {
  const norm = normaliseMessage(text)
  if (MEDS_NONE.has(norm)) return 'none'
  if (MEDS_SOME.has(norm)) return 'some'
  if (MEDS_ALL.has(norm)) return 'all'
  // "yes", "taken", "done", "👍", "ok"… in answer to Q1 mean all taken
  // (isAcknowledgement also recognises emoji-only replies, which normalise to "")
  if (isAcknowledgement(text)) return 'all'
  return null
}

/** True when a reply to "How are you feeling?" means "fine / nothing to report". */
export function isFeelingOk(text: string): boolean {
  return FEELING_OK.has(normaliseMessage(text)) || isAcknowledgement(text)
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

  const raw = message.text ?? ''

  // Anything alarming outranks whatever question was pending.
  if (raw && containsEmergencyKeyword(raw)) {
    return { nextState: 'idle', action: 'route_to_ai' }
  }

  // Nothing to read: a picture or document without a caption gets told so
  // (nobody looks at it); a sticker, contact or location is simply ignored.
  // Neither is sent to the model. A pending question stays pending.
  if (!raw.trim()) {
    if (message.type === 'image' || message.type === 'document') {
      return { nextState: state, action: 'unsupported_media' }
    }
    return { nextState: state, action: 'noop' }
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
      const textBody = raw.toUpperCase().trim()
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
        return { nextState: 'idle', action: 'choose_slot', slotReply: id.replace('slot_', '') }
      }
      // A number, "none of these", or a date on its own: read against the times offered.
      if (parseSlotReply(raw).kind !== 'text') {
        return { nextState: 'idle', action: 'choose_slot', slotReply: raw }
      }
      // Anything else ("ok", a question, a symptom) is answered as usual — the
      // assistant is what spots warning signs — and the times stay on offer.
      return { nextState: 'awaiting_slot_selection', action: 'route_to_ai' }
    }

    case 'awaiting_checkin_meds': {
      const meds = parseMedsAnswer(raw)
      if (meds) {
        return { nextState: 'awaiting_checkin_symptoms', action: 'log_checkin_meds', medsTaken: meds }
      }
      // Skipped the question and described how they feel instead.
      return { nextState: 'idle', action: 'triage_text' }
    }

    case 'awaiting_checkin_symptoms': {
      if (isFeelingOk(raw)) {
        return { nextState: 'idle', action: 'checkin_ok' }
      }
      return { nextState: 'idle', action: 'triage_text' }
    }

    case 'nurse_attending': {
      // A nurse is in the conversation: log the reply for them, say nothing.
      // (Emergency keywords were already caught above; voice notes are still
      // triaged so a red flag never waits on a human reading the transcript.)
      return { nextState: 'nurse_attending', action: 'noop' }
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
      const body = raw.toUpperCase().trim()
      if (body === '2' || body === 'CONCERN' || body === 'NO' || body === 'NOT YET' || body === 'MISSED') {
        return { nextState: 'idle', action: 'route_to_triage' }
      }
      // "TAKEN", "done ✅", "ok", "ले लिया", "تم", 👍 … all count as the dose taken
      if (body === '1' || isAcknowledgement(raw)) {
        return { nextState: 'idle', action: 'log_reminder_response', reminderResponse: body || 'ACK' }
      }
      return { nextState: 'idle', action: 'route_to_ai' }
    }

    case 'idle':
    default:
      // Free-form text in idle state → AI Q&A
      return { nextState: 'idle', action: 'route_to_ai' }
  }
}
