/**
 * Table-driven checks for lib/whatsapp/routing.ts — which patient a message
 * is about when one WhatsApp number is linked to several open episodes.
 *
 * No network or API keys needed. Run with:  npm run check:routing
 */
import {
  routeInbound,
  parseChoice,
  parseNamePrefix,
  isSwitchRequest,
  promptLanguage,
  sessionAfterDelivery,
  sessionWhileAsking,
  EMPTY_SESSION,
  CHOICE_TTL_MS,
  STICKY_TTL_MS,
} from '@/lib/whatsapp/routing'
import type { RoutingCandidate, NumberSession, RoutingDecision } from '@/lib/whatsapp/routing'
import type { ParsedInbound, ConversationState } from '@/lib/whatsapp/fsm'
import { holdReason } from '@/lib/reminders/stagger'

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

const now = new Date('2026-09-22T18:00:00Z')
const iso = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString()

const cand = (patientId: string, patientName: string, state: ConversationState = 'idle', language: RoutingCandidate['language'] = 'en'): RoutingCandidate =>
  ({ patientId, patientName, episodeId: `ep-${patientId}`, language, state })
const msg = (text?: string, type: ParsedInbound['type'] = 'text', extra: Partial<ParsedInbound> = {}): ParsedInbound =>
  ({ waMessageId: `SM-${text ?? type}`, from: '+971500000001', type, text, timestamp: 0, ...extra })

const farzana = cand('p-farzana', 'Farzana Arif')
const umar = cand('p-umar', 'Umar Siddiqui')
const two = [farzana, umar]

const sticky = (patientId: string, ageMs = 0): NumberSession =>
  ({ activePatientId: patientId, activeUntil: iso(STICKY_TTL_MS - ageMs), pendingChoice: null })
const asked = (held: ParsedInbound | null, ageMs = 0, repeated = false): NumberSession =>
  ({ activePatientId: null, activeUntil: null, pendingChoice: { options: ['p-farzana', 'p-umar'], held, askedAt: iso(-ageMs), repeated } })

// Compact rendering of a decision for the tables below.
const show = (d: RoutingDecision): string => {
  if (d.kind === 'deliver') return `deliver:${d.candidate.patientId}:${d.via}:[${d.messages.map((m) => m.text ?? m.type).join('|')}]`
  if (d.kind === 'ask') return `ask:${d.options.map((o) => o.patientId).join(',')}:${d.held ? `held(${d.held.text ?? d.held.type})` : 'nothing'}${d.repeat ? ':repeat' : ''}`
  return `switched:${d.candidate.patientId}`
}
const route = (candidates: RoutingCandidate[], session: NumberSession, m: ParsedInbound) => show(routeInbound(candidates, session, m, now))

console.log('— one open episode: unchanged behaviour —')
eq('single patient, any text', route([farzana], EMPTY_SESSION, msg('hi')), 'deliver:p-farzana:only:[hi]')
eq('single patient, voice note', route([farzana], EMPTY_SESSION, msg(undefined, 'audio')), 'deliver:p-farzana:only:[audio]')
eq('single patient ignores a stale session', route([farzana], sticky('p-umar'), msg('1')), 'deliver:p-farzana:only:[1]')

console.log('— names at the start of a message —')
const np = (text: string) => { const r = parseNamePrefix(text, two); return r ? `${r.candidate.patientId}|${r.rest}` : null }
eq('"Umar: can I walk today?"', np('Umar: can I walk today?'), 'p-umar|can I walk today?')
eq('"umar - is coffee ok"', np('umar - is coffee ok'), 'p-umar|is coffee ok')
eq('"Farzana Arif, she is dizzy"', np('Farzana Arif, she is dizzy'), 'p-farzana|she is dizzy')
eq('"for Farzana she is dizzy"', np('for Farzana she is dizzy'), 'p-farzana|she is dizzy')
eq('"This is Umar. I took my tablets"', np('This is Umar. I took my tablets'), 'p-umar|I took my tablets')
eq('"Umar" alone → name only, empty rest', np('Umar'), 'p-umar|')
eq('"umar" lower-case', np('umar'), 'p-umar|')
eq('name mid-sentence does not route', np('can Umar eat rice?'), null)
eq('"para kay Umar, pwede ba siyang maglakad?" (Tagalog lead-in)', np('para kay Umar, pwede ba siyang maglakad?'), 'p-umar|pwede ba siyang maglakad?')
eq('"si Farzana" (Tagalog, name only)', np('si Farzana'), 'p-farzana|')
eq('"Farzana ke liye, kya woh chai pi sakti hai?" (Hindi trailer)', np('Farzana ke liye, kya woh chai pi sakti hai?'), 'p-farzana|kya woh chai pi sakti hai?')
eq('"Umar ke bare mein - dawai le li" (Hindi trailer)', np('Umar ke bare mein - dawai le li'), 'p-umar|dawai le li')
eq('"عن Farzana: hi" (Arabic lead-in, Latin name)', np('عن Farzana: hi'), 'p-farzana|hi')
eq('"Umar patri: nalla irukkar" (Tamil trailer)', np('Umar patri: nalla irukkar'), 'p-umar|nalla irukkar')
eq('unknown name', np('Ahmed: hello'), null)
eq('single candidate never parses', parseNamePrefix('Umar: hi', [umar]), null)
const twoMohammads = [cand('p-m1', 'Mohammad Ali'), cand('p-m2', 'Mohammad Khan')]
eq('shared first name is ambiguous', parseNamePrefix('Mohammad: hi', twoMohammads), null)
eq('full name still works when first names clash', parseNamePrefix('Mohammad Khan: hi', twoMohammads)?.candidate.patientId, 'p-m2')

console.log('— answers to "who is this about?" —')
const pc = (text: string) => { const r = parseChoice(text, two); return r ? `${r.candidate.patientId}|${r.rest}` : null }
eq('"1"', pc('1'), 'p-farzana|')
eq('"2"', pc('2'), 'p-umar|')
eq('"2."', pc('2.'), 'p-umar|')
eq('"2️⃣" keycap', pc('2️⃣'), 'p-umar|')
eq('"2 please" — one trailing word is not a message', pc('2 please'), 'p-umar|')
eq('"2: can she eat rice?" — the rest is a message', pc('2: can she eat rice?'), 'p-umar|can she eat rice?')
eq('"3" out of range', pc('3'), null)
eq('"0" out of range', pc('0'), null)
eq('"Umar"', pc('Umar'), 'p-umar|')
eq('"Umar, is coffee ok?"', pc('Umar, is coffee ok?'), 'p-umar|is coffee ok?')
eq('"farzana arif"', pc('farzana arif'), 'p-farzana|')
eq('"it is for Farzana"', pc('it is for Farzana'), 'p-farzana|')
eq('"for my mother farzana"', pc('for my mother farzana'), 'p-farzana|')
eq('"Farzana and Umar" is ambiguous', pc('Farzana and Umar'), null)
eq('"yes"', pc('yes'), null)
eq('"" empty', pc(''), null)

console.log('— switch words —')
eq('"switch"', isSwitchRequest('switch'), true)
eq('"Change patient"', isSwitchRequest('Change patient'), true)
eq('"switch to umar" is not the bare word', isSwitchRequest('switch to umar'), false)
eq('"palit" (Tagalog)', isSwitchRequest('palit'), true)
eq('"बदलें" (Hindi)', isSwitchRequest('बदलें'), true)
eq('"تغيير" (Arabic)', isSwitchRequest('تغيير'), true)
eq('"மாற்று" (Tamil)', isSwitchRequest('மாற்று'), true)

console.log('— two patients, nothing pending —')
eq('idle + idle + no memory → ask, holding the message', route(two, EMPTY_SESSION, msg('can I take panadol?')), 'ask:p-farzana,p-umar:held(can I take panadol?)')
eq('idle + idle + memory → the remembered patient', route(two, sticky('p-umar'), msg('can I take panadol?')), 'deliver:p-umar:recent:[can I take panadol?]')
eq('memory expired → ask', route(two, sticky('p-umar', STICKY_TTL_MS + 1), msg('hello')), 'ask:p-farzana,p-umar:held(hello)')
eq('memory of a patient no longer open → ask', route(two, sticky('p-gone'), msg('hello')), 'ask:p-farzana,p-umar:held(hello)')
eq('name prefix beats memory', route(two, sticky('p-umar'), msg('Farzana: is coffee ok?')), 'deliver:p-farzana:name:[is coffee ok?]')
eq('bare name switches', route(two, sticky('p-umar'), msg('Farzana')), 'switched:p-farzana')
eq('"switch" asks without holding', route(two, sticky('p-umar'), msg('switch')), 'ask:p-farzana,p-umar:nothing')
eq('emergency + no memory → newest episode, not held', route(two, EMPTY_SESSION, msg('she has chest pain')), 'deliver:p-farzana:emergency:[she has chest pain]')
eq('emergency + memory → remembered patient', route(two, sticky('p-umar'), msg('chest pain')), 'deliver:p-umar:recent:[chest pain]')
eq('Arabic emergency ("her chest hurts her") → newest episode, not held', route(two, EMPTY_SESSION, msg('صدرها يعورها')), 'deliver:p-farzana:emergency:[صدرها يعورها]')
eq('…"her chest does not hurt" is asked about like any other message', route(two, EMPTY_SESSION, msg('صدرها ما يعورها')), 'ask:p-farzana,p-umar:held(صدرها ما يعورها)')
eq('voice note + no memory → ask (held)', route(two, EMPTY_SESSION, msg(undefined, 'audio')), 'ask:p-farzana,p-umar:held(audio)')
eq('voice note + memory → remembered patient', route(two, sticky('p-umar'), msg(undefined, 'audio')), 'deliver:p-umar:recent:[audio]')

console.log('— a question is waiting on one conversation —')
const umarAsked = [farzana, cand('p-umar', 'Umar Siddiqui', 'awaiting_checkin_meds')]
eq('"1" → the waiting conversation', route(umarAsked, EMPTY_SESSION, msg('1')), 'deliver:p-umar:reply:[1]')
eq('free text → the waiting conversation too', route(umarAsked, EMPTY_SESSION, msg('feeling dizzy')), 'deliver:p-umar:reply:[feeling dizzy]')
eq('waiting beats memory of the other patient', route(umarAsked, sticky('p-farzana'), msg('1')), 'deliver:p-umar:reply:[1]')
eq('name prefix still beats waiting', route(umarAsked, EMPTY_SESSION, msg('Farzana: can I walk?')), 'deliver:p-farzana:name:[can I walk?]')
const nurseWithFarzana = [cand('p-farzana', 'Farzana Arif', 'nurse_attending'), umar]
eq('nurse chatting with Farzana → replies go to her', route(nurseWithFarzana, EMPTY_SESSION, msg('thanks nurse')), 'deliver:p-farzana:reply:[thanks nurse]')

console.log('— both conversations are waiting (two check-ins fired) —')
const bothAsked = [cand('p-farzana', 'Farzana Arif', 'awaiting_checkin_meds'), cand('p-umar', 'Umar Siddiqui', 'awaiting_checkin_meds')]
eq('"1" + no memory → ask, holding the "1"', route(bothAsked, EMPTY_SESSION, msg('1')), 'ask:p-farzana,p-umar:held(1)')
eq('"1" + memory of Umar → Umar (mid-dialogue)', route(bothAsked, sticky('p-umar'), msg('1')), 'deliver:p-umar:reply:[1]')
eq('emergency → best guess, never held', route(bothAsked, EMPTY_SESSION, msg('cant breathe')), 'deliver:p-farzana:emergency:[cant breathe]')

console.log('— answering the question —')
eq('"2" → held message replayed to Umar', route(two, asked(msg('can I take panadol?')), msg('2')), 'deliver:p-umar:choice:[can I take panadol?]')
eq('"Farzana" → held message replayed to Farzana', route(two, asked(msg('1')), msg('Farzana')), 'deliver:p-farzana:choice:[1]')
eq('"2" with nothing held (after "switch") → switched', route(two, asked(null), msg('2')), 'switched:p-umar')
eq('"2, can she eat rice?" → held replayed, then the question', route(two, asked(msg('hello')), msg('2, can she eat rice?')), 'deliver:p-umar:choice:[hello|can she eat rice?]')
eq('"Umar: can he walk?" with nothing held → just the question', route(two, asked(null), msg('Umar: can he walk?')), 'deliver:p-umar:choice:[can he walk?]')
eq('not an answer → ask again, keep holding', route(two, asked(msg('hello')), msg('what?')), 'ask:p-farzana,p-umar:held(hello):repeat')
eq('second non-answer → best guess gets both messages', route(two, asked(msg('hello'), 0, true), msg('what?')), 'deliver:p-farzana:fallback:[hello|what?]')
eq('second non-answer with memory → remembered patient', route(two, { ...asked(msg('hello'), 0, true), ...{ activePatientId: 'p-umar', activeUntil: iso(STICKY_TTL_MS) } }, msg('what?')), 'deliver:p-umar:fallback:[hello|what?]')
eq('voice note while pending → best guess gets both', route(two, asked(msg('hello')), msg(undefined, 'audio')), 'deliver:p-farzana:fallback:[hello|audio]')
eq('emergency while pending → best guess, now', route(two, asked(msg('hello')), msg('chest pain')), 'deliver:p-farzana:emergency:[hello|chest pain]')
eq('question expired → "2" is just a message (asks again)', route(two, asked(msg('hello'), CHOICE_TTL_MS + 1), msg('2')), 'ask:p-farzana,p-umar:held(2)')
const umarClosed = [farzana]
eq('option whose episode closed → "2" no longer resolves', routeInbound(umarClosed, asked(msg('hi')), msg('2'), now).kind, 'deliver')   // one candidate left: plain delivery
const threeListedOneGone = [farzana, cand('p-ali', 'Ali Hassan')]
const askedThree: NumberSession = { activePatientId: null, activeUntil: null, pendingChoice: { options: ['p-farzana', 'p-umar', 'p-ali'], held: msg('hi'), askedAt: iso(0) } }
eq('"3" keeps its listed position when "2" closed', route(threeListedOneGone, askedThree, msg('3')), 'deliver:p-ali:choice:[hi]')
eq('"2" (closed) → not an answer, re-ask with the open ones', route(threeListedOneGone, askedThree, msg('2')), 'ask:p-farzana,p-ali:held(hi):repeat')

console.log('— session bookkeeping —')
const after = sessionAfterDelivery(umar, now)
eq('delivery remembers the patient for a day', [after.activePatientId, after.activeUntil, after.pendingChoice], ['p-umar', iso(STICKY_TTL_MS), null])
const asking = sessionWhileAsking(sticky('p-umar'), two, msg('hi'), false, now)
eq('asking keeps the memory and records the options', [asking.activePatientId, asking.pendingChoice?.options, asking.pendingChoice?.held?.text, asking.pendingChoice?.repeated], ['p-umar', ['p-farzana', 'p-umar'], 'hi', false])
eq('prompt language: shared', promptLanguage([cand('a', 'A', 'idle', 'ar'), cand('b', 'B', 'idle', 'ar')]), 'ar')
eq('prompt language: mixed → en', promptLanguage([cand('a', 'A', 'idle', 'ar'), cand('b', 'B', 'idle', 'hi')]), 'en')

console.log('— dispatcher: one open question per phone (lib/reminders/stagger.ts) —')
const conv = (episode_id: string, wa_phone: string, state: string, until?: string) => ({ episode_id, wa_phone, conversation_state: { state, until } })
const job = (episodeId: string, phone: string, minutesAgo = 0) => ({ episodeId, phone, fireAt: iso(-minutesAgo * 60000) })
const hold = (j: ReturnType<typeof job>, convs: ReturnType<typeof conv>[], sent: string[] = []) => holdReason(j, convs, new Set(sent), now)
eq('nobody else on the phone → send', hold(job('ep-a', '+1'), [conv('ep-a', '+1', 'idle')]), null)
eq('other patient idle → send', hold(job('ep-a', '+1'), [conv('ep-b', '+1', 'idle')]), null)
eq('other patient mid check-in → hold', hold(job('ep-a', '+1'), [conv('ep-b', '+1', 'awaiting_checkin_meds')]), 'another_waiting')
eq('own conversation waiting does not hold', hold(job('ep-a', '+1'), [conv('ep-a', '+1', 'awaiting_checkin_meds')]), null)
eq('waiting patient on a different phone → send', hold(job('ep-a', '+1'), [conv('ep-b', '+2', 'awaiting_checkin_meds')]), null)
eq('already wrote to this phone in the run → hold', hold(job('ep-a', '+1'), [], ['+1']), 'sent_this_run')
eq('an hour late → send regardless', hold(job('ep-a', '+1', 61), [conv('ep-b', '+1', 'awaiting_checkin_meds')], ['+1']), null)
eq('expired nurse_attending counts as idle → send', hold(job('ep-a', '+1'), [conv('ep-b', '+1', 'nurse_attending', iso(-1000))]), null)
eq('live nurse_attending → hold', hold(job('ep-a', '+1'), [conv('ep-b', '+1', 'nurse_attending', iso(600000))]), 'another_waiting')

console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
