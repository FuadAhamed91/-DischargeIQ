/**
 * Which patient is a message about, when one WhatsApp number is linked to
 * more than one open episode?
 *
 * One hospital number serves every patient, and a patient's number is not
 * unique either: a family shares a phone, a daughter writes for both
 * parents, a tester registers three demo patients on their own number.
 * Each patient still has their own conversation, state and transcript —
 * this module only decides which one an inbound message belongs to.
 *
 * Decision order (first match wins):
 *   1. one open episode behind the number → that one (the common case)
 *   2. a choice is pending ("Who is this about? 1. … 2. …") → parse the answer
 *   3. the message starts with a patient's name ("Umar: …") → that patient
 *   4. "switch" → ask again
 *   5. the remembered patient is mid-dialogue (a question is waiting) → them
 *   6. exactly one conversation is waiting for a reply → that one
 *   7. the patient chosen or written about most recently (24 h) → them
 *   8. an emergency keyword → the likeliest patient, never held back
 *   9. otherwise ask, holding the message to replay once answered
 *
 * Everything here is pure so it can be table-tested (scripts/check-routing.ts).
 */

import { containsEmergencyKeyword, normaliseMessage } from '@/lib/ai/intent'
import type { LanguageCode } from '@/types/enums'
import type { ConversationState, ParsedInbound } from './fsm'

export interface RoutingCandidate {
  patientId: string
  patientName: string
  episodeId: string
  language: LanguageCode
  /** Parsed conversation state (an expired nurse_attending already reads as idle). */
  state: ConversationState
}

export interface PendingChoice {
  /** Patient ids in the order they were listed to the sender ("1." is options[0]). */
  options: string[]
  /** The message that triggered the question, replayed once the sender answers. */
  held: ParsedInbound | null
  askedAt: string
  /** The question was already repeated once; the next non-answer gives up asking. */
  repeated?: boolean
}

export interface NumberSession {
  activePatientId: string | null
  activeUntil: string | null
  pendingChoice: PendingChoice | null
}

export const EMPTY_SESSION: NumberSession = { activePatientId: null, activeUntil: null, pendingChoice: null }

/** How a message was matched to its patient — stored on the message for the transcript. */
export type RoutedVia =
  | 'only'       // the number has one open episode
  | 'choice'     // the sender answered "who is this about?"
  | 'name'       // the message started with the patient's name
  | 'reply'      // the only conversation waiting for an answer
  | 'recent'     // the patient chosen or written about most recently
  | 'emergency'  // emergency keyword: best guess, never held back
  | 'fallback'   // the sender would not choose; best guess so nothing is lost

export type RoutingDecision =
  | { kind: 'deliver'; candidate: RoutingCandidate; messages: ParsedInbound[]; via: RoutedVia }
  | { kind: 'ask'; options: RoutingCandidate[]; held: ParsedInbound | null; repeat: boolean }
  | { kind: 'switched'; candidate: RoutingCandidate; message: ParsedInbound; via: 'name' | 'choice' }

/** A pending question is answered within this long; after that a "2" is just a message. */
export const CHOICE_TTL_MS = 60 * 60 * 1000
/** How long the last patient written about stays the default. */
export const STICKY_TTL_MS = 24 * 60 * 60 * 1000

const WAITING_STATES = new Set<ConversationState>([
  'awaiting_appointment_confirm',
  'awaiting_slot_selection',
  'awaiting_reminder_response',
  'awaiting_checkin_meds',
  'awaiting_checkin_symptoms',
  'nurse_attending',
])

const SWITCH_WORDS = new Set([
  'switch', 'change', 'change patient', 'other patient', 'someone else', 'menu', 'who',
  'تغيير', 'تبديل', 'شخص آخر', 'مريض آخر',
  'बदलें', 'बदलो', 'badlo', 'badal', 'dusra', 'doosra',
  'மாற்று', 'மாற்றவும்', 'maatru', 'mathu',
  'palit', 'ibang pasyente', 'iba',
])

/** True when this conversation has asked the patient something and is waiting. */
export function isWaiting(state: ConversationState): boolean {
  return WAITING_STATES.has(state)
}

function stickyCandidate(session: NumberSession, candidates: RoutingCandidate[], now: Date): RoutingCandidate | null {
  if (!session.activePatientId || !session.activeUntil) return null
  if (Date.parse(session.activeUntil) <= now.getTime()) return null
  return candidates.find((c) => c.patientId === session.activePatientId) ?? null
}

function pendingChoice(session: NumberSession, now: Date): PendingChoice | null {
  const pending = session.pendingChoice
  if (!pending) return null
  if (Date.parse(pending.askedAt) + CHOICE_TTL_MS <= now.getTime()) return null
  return pending
}

// ------------------------------------
// Names
// ------------------------------------

/** Keycap digits ("1️⃣") normalise to their digit; other combining marks are kept. */
function normaliseAnswer(text: string): string {
  return normaliseMessage(text.replace(/[\uFE0F\u20E3]/g, ''))
}

/** The ways a sender might write a patient's name: full name, then first name when unique. */
function nameKeys(candidates: RoutingCandidate[]): Map<string, RoutingCandidate[]> {
  const keys = new Map<string, RoutingCandidate[]>()
  const add = (key: string, c: RoutingCandidate) => {
    if (!key) return
    const list = keys.get(key) ?? []
    if (!list.includes(c)) list.push(c)
    keys.set(key, list)
  }
  for (const c of candidates) {
    const full = normaliseMessage(c.patientName)
    add(full, c)
    const first = full.split(' ')[0]
    if (first && first !== full) add(first, c)
  }
  return keys
}

/** Longest name key at the start of `norm` that belongs to exactly one candidate. */
function matchNameAtStart(norm: string, keys: Map<string, RoutingCandidate[]>): { key: string; candidate: RoutingCandidate } | null {
  let best: { key: string; candidate: RoutingCandidate } | null = null
  for (const [key, list] of keys) {
    if (list.length !== 1) continue
    if (norm !== key && !norm.startsWith(key + ' ')) continue
    if (!best || key.length > best.key.length) best = { key, candidate: list[0] }
  }
  return best
}

// Words that may come before a name ("for Umar", "para kay Umar", "عن Umar")
// and after it ("Farzana ke liye" — Hindi/Urdu put the "for" after the name).
const LEAD_INS = [
  'this is', 'it is', 'its', 'it s', 'for', 'about', 're', 'from',
  'عن', 'بخصوص', 'من',
  'para kay', 'tungkol kay', 'para sa', 'kay', 'si', 'ni',
]
const TRAILERS = [
  'ke liye', 'ke baare mein', 'ke bare mein', 'ke bare me', 'ki taraf se', 'ke bare', 'के लिए', 'के बारे में', 'की तरफ से',
  'patri', 'patthi', 'பற்றி', 'kaga', 'க்காக', 'sarbil', 'சார்பில்',
]
const longestFirst = (words: string[]) => [...words].sort((a, b) => b.length - a.length)
const NAME_LEAD_IN = new RegExp(`^(${longestFirst(LEAD_INS).join('|')})\\s+`)
const NAME_TRAILER = new RegExp(`^(${longestFirst(TRAILERS).join('|')})(?:\\s+|$)`)

export interface NamePrefix {
  candidate: RoutingCandidate
  /** The message without the name and its separator; empty when the message was only the name. */
  rest: string
}

/**
 * "Umar: can I walk today?", "for Farzana - she is dizzy", "Umar" → the
 * patient and the message meant for them. Only the start of the message
 * counts, so a question that merely mentions a relative does not re-route.
 */
export function parseNamePrefix(text: string, candidates: RoutingCandidate[]): NamePrefix | null {
  if (candidates.length < 2) return null
  const keys = nameKeys(candidates)
  const norm = normaliseAnswer(text)
  const lead = norm.match(NAME_LEAD_IN)
  const body = lead ? norm.slice(lead[0].length) : norm
  const match = matchNameAtStart(body, keys)
  if (!match) return null
  const afterName = body.slice(match.key.length).trim()
  const trailer = afterName.match(NAME_TRAILER)

  // Drop the same number of words from the original text so the rest keeps
  // its casing and punctuation, then the separator ("Umar: …", "Umar - …").
  const words =
    (lead ? lead[0].trim().split(' ').length : 0) +
    match.key.split(' ').length +
    (trailer ? trailer[1].split(' ').length : 0)
  let rest = text.trim()
  for (let i = 0; i < words; i++) {
    rest = rest.replace(/^[^\p{L}\p{N}]*[\p{L}\p{M}\p{N}'’]+/u, '')
  }
  rest = rest.replace(/^[\s:\-–—,.;!]+/u, '').trim()
  return { candidate: match.candidate, rest }
}

export interface ChoiceAnswer {
  candidate: RoutingCandidate
  /** Words after the choice that read as a message of their own ("2, can she eat rice?"). */
  rest: string
}

/** Candidates whose (unique) name appears as whole words anywhere in `norm`. */
function mentioned(norm: string, keys: Map<string, RoutingCandidate[]>): RoutingCandidate[] {
  const found: RoutingCandidate[] = []
  for (const [key, list] of keys) {
    if (list.length === 1 && ` ${norm} `.includes(` ${key} `) && !found.includes(list[0])) found.push(list[0])
  }
  return found
}

/** A tail is only a message if it has a couple of words; "2 please" is just a choice. */
function messageTail(rest: string): string {
  return normaliseMessage(rest).split(' ').filter(Boolean).length >= 2 ? rest : ''
}

/**
 * The answer to "Who is this message about? 1. … 2. …": the option number,
 * or a name (full, or first name when unique), on its own, in a short
 * sentence, or ahead of a message ("2: can she eat rice?"). Naming two
 * patients is no answer.
 */
export function parseChoice(text: string, options: RoutingCandidate[]): ChoiceAnswer | null {
  const norm = normaliseAnswer(text)
  if (!norm) return null

  const numbered = norm.match(/^(\d{1,2})(?:\s+(.*))?$/)
  if (numbered) {
    const candidate = options[parseInt(numbered[1], 10) - 1]
    if (!candidate) return null
    const rest = text.trim().replace(/^[^\p{N}]*\d{1,2}[\s:.\-–—,;!]*/u, '')
    return { candidate, rest: messageTail(rest) }
  }

  const keys = nameKeys(options)
  if (mentioned(norm, keys).length > 1) return null
  const named = parseNamePrefix(text, options)
  if (named) return { candidate: named.candidate, rest: messageTail(named.rest) }
  // "it is for my mother farzana" — a unique name anywhere in a short answer.
  if (norm.split(' ').length <= 6) {
    const found = mentioned(norm, keys)
    if (found.length === 1) return { candidate: found[0], rest: '' }
  }
  return null
}

export function isSwitchRequest(text: string): boolean {
  return SWITCH_WORDS.has(normaliseAnswer(text))
}

// ------------------------------------
// The decision
// ------------------------------------

export function routeInbound(
  candidates: RoutingCandidate[],
  session: NumberSession,
  message: ParsedInbound,
  now: Date = new Date(),
): RoutingDecision {
  if (candidates.length === 0) throw new Error('routeInbound needs at least one candidate')
  if (candidates.length === 1) return { kind: 'deliver', candidate: candidates[0], messages: [message], via: 'only' }

  const text = message.type === 'text' ? (message.text ?? '') : ''
  const sticky = stickyCandidate(session, candidates, now)
  const fallback = sticky ?? candidates[0]
  const emergency = text !== '' && containsEmergencyKeyword(text)

  // 2. A question is pending: read the reply as the answer. Options keep
  // their listed position even if one episode closed in the meantime.
  const pending = pendingChoice(session, now)
  if (pending) {
    const listed = pending.options.map((id) => candidates.find((c) => c.patientId === id) ?? null)
    const options = listed.filter((c): c is RoutingCandidate => c !== null)
    const chosen = text ? parseChoiceFromListed(text, listed) : null
    if (chosen) {
      const messages: ParsedInbound[] = []
      if (pending.held) messages.push(pending.held)
      if (chosen.rest) messages.push({ ...message, text: chosen.rest })
      if (messages.length === 0) return { kind: 'switched', candidate: chosen.candidate, message, via: 'choice' }
      return { kind: 'deliver', candidate: chosen.candidate, messages, via: 'choice' }
    }
    // Not an answer. An emergency, a voice note, or a second non-answer is
    // handled for the likeliest patient rather than held any longer.
    if (emergency || message.type !== 'text' || pending.repeated) {
      const held = pending.held ? [pending.held] : []
      return { kind: 'deliver', candidate: fallback, messages: [...held, message], via: emergency ? 'emergency' : 'fallback' }
    }
    return { kind: 'ask', options, held: pending.held, repeat: true }
  }

  // 3. The message names the patient.
  if (text) {
    const named = parseNamePrefix(text, candidates)
    if (named) {
      if (!named.rest) return { kind: 'switched', candidate: named.candidate, message, via: 'name' }
      return { kind: 'deliver', candidate: named.candidate, messages: [{ ...message, text: named.rest }], via: 'name' }
    }
    // 4. The sender wants the list.
    if (isSwitchRequest(text)) return { kind: 'ask', options: candidates, held: null, repeat: false }
  }

  // 5 + 6. Someone is being asked a question — a reply almost certainly answers it.
  const waiting = candidates.filter((c) => isWaiting(c.state))
  if (sticky && waiting.includes(sticky)) return { kind: 'deliver', candidate: sticky, messages: [message], via: 'reply' }
  if (waiting.length === 1) return { kind: 'deliver', candidate: waiting[0], messages: [message], via: 'reply' }
  if (waiting.length > 1) {
    if (emergency) return { kind: 'deliver', candidate: fallback, messages: [message], via: 'emergency' }
    return { kind: 'ask', options: candidates, held: message, repeat: false }
  }

  // 7. The last patient written about.
  if (sticky) return { kind: 'deliver', candidate: sticky, messages: [message], via: 'recent' }

  // 8. Never hold an emergency behind a question.
  if (emergency) return { kind: 'deliver', candidate: fallback, messages: [message], via: 'emergency' }

  // 9. Genuinely unclear: ask, and replay this message once answered.
  return { kind: 'ask', options: candidates, held: message, repeat: false }
}

/**
 * parseChoice over the list as it was shown: an episode that closed since
 * leaves a gap at its number (a placeholder with no id), so "3" still means
 * the third name the sender saw.
 */
function parseChoiceFromListed(text: string, listed: Array<RoutingCandidate | null>): ChoiceAnswer | null {
  const padded = listed.map((c) => c ?? { patientId: '', patientName: '', episodeId: '', language: 'en' as const, state: 'idle' as const })
  const answer = parseChoice(text, padded)
  return answer && answer.candidate.patientId ? answer : null
}

/** The session after a message was delivered to `candidate`: they become the default for a day. */
export function sessionAfterDelivery(candidate: RoutingCandidate, now: Date = new Date()): NumberSession {
  return {
    activePatientId: candidate.patientId,
    activeUntil: new Date(now.getTime() + STICKY_TTL_MS).toISOString(),
    pendingChoice: null,
  }
}

/** The session while the sender is being asked who a message is about. */
export function sessionWhileAsking(
  previous: NumberSession,
  options: RoutingCandidate[],
  held: ParsedInbound | null,
  repeat: boolean,
  now: Date = new Date(),
): NumberSession {
  return {
    activePatientId: previous.activePatientId,
    activeUntil: previous.activeUntil,
    pendingChoice: { options: options.map((c) => c.patientId), held, askedAt: now.toISOString(), repeated: repeat },
  }
}

/** Prompt language: the one every linked patient shares, else English. */
export function promptLanguage(options: RoutingCandidate[]): LanguageCode {
  const first = options[0]?.language ?? 'en'
  return options.every((c) => c.language === first) ? first : 'en'
}
