/**
 * End-to-end checks for the inbound WhatsApp handler against an in-memory
 * database (scripts/lib/fake-supabase.ts) and a captured Twilio API.
 *
 * Covers what the unit tables cannot: that the handler actually asks a
 * shared number who a message is about, holds and replays the message,
 * keeps each patient's conversation and transcript apart, routes replies to
 * the conversation that is waiting, drops a redelivered SID, and leaves a
 * single-patient number exactly as it was. Only deterministic paths are
 * exercised (greetings, acknowledgements, the check-in, emergencies, an
 * appointment reschedule) — no model call, no network, no API keys.
 *
 * Run with:  npm run check:webhook
 */

process.env.TWILIO_ACCOUNT_SID ??= 'ACtest'
process.env.TWILIO_AUTH_TOKEN ??= 'token'
process.env.TWILIO_WHATSAPP_NUMBER ??= 'whatsapp:+14155238886'
process.env.WHATSAPP_USE_TEXT_FALLBACK ??= 'true'
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://fake.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake'
process.env.GEMINI_API_KEY = 'test-key' // read lazily; every model call below goes to the stub

import { GenerativeModel } from '@google/generative-ai'
import { FakeDb } from './lib/fake-supabase'
import { handleInboundMessage } from '@/lib/whatsapp/webhook-handler'
import { withSenderLock, senderKey, pendingSenders } from '@/lib/whatsapp/sender-queue'
import { parseStatusCallback, applyStatusCallback, nextRowStatus } from '@/lib/whatsapp/status-callback'
import { rememberPatientIfShared, pruneStaleNumberSessions, summariseNumberSession, STALE_SESSION_MS } from '@/lib/whatsapp/number-session'
import { parseWebhookPayload } from '@/lib/whatsapp/twilio-payload'
import { raiseEpisodeRisk, isLowering } from '@/lib/episodes/risk'
import { proposeSlots, DEFAULT_CLINIC_DAYS } from '@/lib/appointments/slots'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { ServiceClient } from '@/lib/whatsapp/recipient'
import type { ParsedInbound } from '@/lib/whatsapp/fsm'

// ------------------------------------
// Captured Twilio
// ------------------------------------

interface Sent { to: string; body: string }
const outbox: Sent[] = []
let sidCounter = 0
/** Set to make the next Twilio send fail (a 63016 "not joined to the sandbox", say). */
let failNextSend: string | null = null
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.includes('api.twilio.com')) throw new Error(`unexpected fetch: ${url}`)
  // A voice note's audio, downloaded from Twilio.
  if (url.includes('/Media/')) return new Response(new Uint8Array([79, 103, 103, 83]), { status: 200, headers: { 'Content-Type': 'audio/ogg' } })
  const params = new URLSearchParams(String(init?.body ?? ''))
  if (failNextSend) {
    const message = failNextSend
    failNextSend = null
    return new Response(JSON.stringify({ code: 63016, message }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }
  outbox.push({ to: params.get('To') ?? '', body: params.get('Body') ?? '' })
  return new Response(JSON.stringify({ sid: `SMout${++sidCounter}` }), { status: 201, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch

/** Everything sent since the last call. */
function drain(): Sent[] {
  return outbox.splice(0, outbox.length)
}

// ------------------------------------
// Stubbed Gemini: what the next voice note is heard as, and the next triage colour
// ------------------------------------

let heardNext: { transcript: string; clarity: number } = { transcript: '', clarity: 0 }
let triageNext: 'green' | 'yellow' | 'red' = 'green'
const modelCalls: string[] = []
GenerativeModel.prototype.generateContent = async function (request: unknown) {
  const prompt = JSON.stringify(request)
  const answer = (text: string) => ({ response: { text: () => text } }) as unknown as ReturnType<GenerativeModel['generateContent']>
  if (prompt.includes('Transcribe this voice message')) {
    modelCalls.push('transcribe')
    return answer(JSON.stringify(heardNext))
  }
  if (prompt.includes('clinical triage assistant')) {
    modelCalls.push('triage')
    return answer(JSON.stringify({ riskLevel: triageNext, reasoning: 'scripted', keySymptoms: [], requiresImmediateAttention: triageNext === 'red' }))
  }
  // Patient chat and the rest: nothing usable, so their fallbacks answer (as with no key at all).
  modelCalls.push('other')
  return answer('')
} as GenerativeModel['generateContent']

// ------------------------------------
// Seed: one hospital number, a shared family phone, a patient of her own
// ------------------------------------

const HOSPITAL_NUMBER = '+14155238886'
const FAMILY_PHONE = '+971500000001'
const SOLO_PHONE = '+971500000002'

function seed(): FakeDb {
  return new FakeDb({
    hospitals: [{ id: 'h1', name: 'Demo Hospital', timezone: 'Asia/Dubai', settings: {}, whatsapp_phone_number_id: HOSPITAL_NUMBER }],
    patients: [
      { id: 'p-farzana', hospital_id: 'h1', mrn: 'MRN-1', full_name: 'Farzana Arif', phone_e164: FAMILY_PHONE, preferred_language: 'en' },
      { id: 'p-umar', hospital_id: 'h1', mrn: 'MRN-2', full_name: 'Umar Siddiqui', phone_e164: FAMILY_PHONE, preferred_language: 'en' },
      { id: 'p-solo', hospital_id: 'h1', mrn: 'MRN-3', full_name: 'Priya Nair', phone_e164: SOLO_PHONE, preferred_language: 'hi' },
    ],
    care_episodes: [
      { id: 'ep-farzana', hospital_id: 'h1', patient_id: 'p-farzana', status: 'active', current_risk_level: 'green', created_at: '2026-09-10T08:00:00Z' },
      { id: 'ep-umar', hospital_id: 'h1', patient_id: 'p-umar', status: 'active', current_risk_level: 'green', created_at: '2026-09-15T08:00:00Z' },
      { id: 'ep-solo', hospital_id: 'h1', patient_id: 'p-solo', status: 'active', current_risk_level: 'green', created_at: '2026-09-16T08:00:00Z' },
    ],
    whatsapp_conversations: [
      { id: 'c-farzana', episode_id: 'ep-farzana', hospital_id: 'h1', patient_id: 'p-farzana', wa_phone: FAMILY_PHONE, conversation_state: { state: 'idle' } },
      { id: 'c-umar', episode_id: 'ep-umar', hospital_id: 'h1', patient_id: 'p-umar', wa_phone: FAMILY_PHONE, conversation_state: { state: 'idle' } },
    ],
  })
}

// ------------------------------------
// Harness
// ------------------------------------

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}
const includes = (label: string, haystack: string, needle: string) => {
  const ok = haystack.includes(needle)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  (wanted "${needle}" in ${JSON.stringify(haystack)})`}`)
}

let sidIn = 0
const inbound = (from: string, text?: string, type: ParsedInbound['type'] = 'text', extra: Partial<ParsedInbound> = {}): ParsedInbound =>
  ({ waMessageId: `SMin${++sidIn}`, from, type, text, timestamp: 0, ...extra })

const db = seed()
const client = db as unknown as ServiceClient
const send = (msg: ParsedInbound) => handleInboundMessage(HOSPITAL_NUMBER, msg, { supabase: client })

const messagesOf = (conversationId: string) =>
  db.rows('whatsapp_messages').filter((m) => m.conversation_id === conversationId)
const inboundOf = (conversationId: string) => messagesOf(conversationId).filter((m) => m.direction === 'inbound')
const routingOf = (m: Record<string, unknown>) => ((m.metadata as Record<string, unknown> | undefined)?.routing as Record<string, unknown> | undefined)?.via ?? null
const stateOf = (conversationId: string) => {
  const raw = db.rows('whatsapp_conversations').find((c) => c.id === conversationId)?.conversation_state
  return typeof raw === 'string' ? raw : (raw as { state?: string } | null)?.state
}
const session = () => db.rows('whatsapp_number_sessions').find((s) => s.wa_phone === FAMILY_PHONE) ?? null
const riskOf = (episodeId: string) => db.rows('care_episodes').find((e) => e.id === episodeId)?.current_risk_level

async function main() {
  console.log('— a number with one open episode: nothing changes —')
  await send(inbound(SOLO_PHONE, 'namaste'))
  let sent = drain()
  eq('one reply, to that number', sent.map((s) => s.to), [`whatsapp:${SOLO_PHONE}`])
  includes('greeting in her language', sent[0]?.body ?? '', 'नमस्ते Priya Nair')
  const soloConversation = db.rows('whatsapp_conversations').find((c) => c.episode_id === 'ep-solo')
  eq('conversation created on first message', Boolean(soloConversation), true)
  eq('inbound logged without routing metadata', inboundOf(String(soloConversation?.id)).map(routingOf), [null])
  eq('no number session for a single patient', db.rows('whatsapp_number_sessions').length, 0)

  console.log('— a picture with no caption —')
  await send(inbound(SOLO_PHONE, undefined, 'image'))
  sent = drain()
  includes('told, in her language, that pictures cannot be read', sent[0]?.body ?? '', 'माफ़ कीजिए Priya Nair')
  eq('no alert, no AI interaction', [db.rows('alerts').length, db.rows('ai_interactions').length], [0, 0])

  console.log('— an unknown number —')
  const inboundBefore = db.rows('whatsapp_messages').filter((m) => m.direction === 'inbound').length
  await send(inbound('+971500009999', 'hello?'))
  sent = drain()
  includes('not-registered reply', sent[0]?.body ?? '', 'could not find an active care record')
  eq('nothing logged', db.rows('whatsapp_messages').filter((m) => m.direction === 'inbound').length, inboundBefore)
  await send(inbound('+971500009999', 'hello??'))
  eq('a second message within the hour gets no second reply', drain().length, 0)

  console.log('— a registered number whose episode has closed —')
  db.rows('care_episodes').find((e) => e.id === 'ep-solo')!.status = 'completed'
  await send(inbound(SOLO_PHONE, 'hello again'))
  sent = drain()
  includes('told by name, in her language, that the episode has ended', sent[0]?.body ?? '', 'नमस्ते Priya Nair')
  db.rows('care_episodes').find((e) => e.id === 'ep-solo')!.status = 'active'

  console.log('— a shared number, first contact: the assistant has to ask —')
  const hi = inbound(FAMILY_PHONE, 'hi')
  await send(hi)
  sent = drain()
  eq('one prompt sent', sent.length, 1)
  includes('newest episode listed first', sent[0].body, '1. Umar Siddiqui\n2. Farzana Arif')
  includes('promises to pass the message on', sent[0].body, 'pass your message on')
  includes('tip uses a name from the list', sent[0].body, 'e.g. “Farzana: …”')
  eq('question logged on both transcripts', [messagesOf('c-farzana').length, messagesOf('c-umar').length], [1, 1])
  eq('session holds the message', (session()?.pending_choice as { held?: { text?: string } } | null)?.held?.text, 'hi')
  eq('no reply to "hi" itself yet', inboundOf('c-umar').length + inboundOf('c-farzana').length, 0)

  console.log('— the same webhook again (Twilio retry) while held —')
  await send({ ...hi })
  eq('ignored: nothing sent', drain().length, 0)

  console.log('— the sender answers "2" —')
  await send(inbound(FAMILY_PHONE, '2'))
  sent = drain()
  eq('one reply', sent.length, 1)
  includes('the held "hi" is answered for Farzana', sent[0].body, 'Hello Farzana Arif')
  eq('"2" then "hi" on Farzana\'s transcript, both marked as routed by choice', inboundOf('c-farzana').map((m) => [m.content, routingOf(m)]), [['2', 'choice'], ['hi', 'choice']])
  eq('nothing inbound on Umar\'s transcript', inboundOf('c-umar').length, 0)
  eq('session: Farzana remembered, nothing pending', [session()?.active_patient_id, session()?.pending_choice], ['p-farzana', null])

  console.log('— follow-up without a name goes to the remembered patient —')
  await send(inbound(FAMILY_PHONE, 'thanks'))
  sent = drain()
  includes('acknowledgement for Farzana', sent[0]?.body ?? '', 'Thank you, Farzana Arif')
  eq('routed as recent', routingOf(inboundOf('c-farzana').at(-1)!), 'recent')

  console.log('— a name at the start switches patient —')
  await send(inbound(FAMILY_PHONE, 'Umar: hello'))
  sent = drain()
  includes('greeting for Umar', sent[0]?.body ?? '', 'Hello Umar Siddiqui')
  eq('logged for Umar without the name, routed by name', inboundOf('c-umar').map((m) => [m.content, routingOf(m)]), [['hello', 'name']])
  eq('session now remembers Umar', session()?.active_patient_id, 'p-umar')

  console.log('— a bare name just switches —')
  await send(inbound(FAMILY_PHONE, 'Farzana'))
  sent = drain()
  includes('confirmation', sent[0]?.body ?? '', 'about *Farzana Arif*')
  eq('session remembers Farzana', session()?.active_patient_id, 'p-farzana')

  console.log('— the nightly check-in fires for Umar: replies go to the conversation that is waiting —')
  const umar = db.rows('whatsapp_conversations').find((c) => c.id === 'c-umar')!
  umar.conversation_state = 'awaiting_checkin_meds'
  await send(inbound(FAMILY_PHONE, '1'))
  sent = drain()
  includes('Q2 asked of Umar', sent[0]?.body ?? '', 'Well done, Umar Siddiqui')
  eq('"1" landed on Umar, routed as a reply', [inboundOf('c-umar').at(-1)?.content, routingOf(inboundOf('c-umar').at(-1)!)], ['1', 'reply'])
  eq('Umar now awaiting symptoms; Farzana untouched', [stateOf('c-umar'), stateOf('c-farzana')], ['awaiting_checkin_symptoms', 'idle'])
  eq('adherence recorded on Umar\'s episode', db.rows('patient_timeline_events').filter((e) => e.event_type === 'reminder_response').map((e) => e.episode_id), ['ep-umar'])
  await send(inbound(FAMILY_PHONE, 'ok'))
  sent = drain()
  includes('good night to Umar', sent[0]?.body ?? '', 'Umar Siddiqui. Sleep well')
  eq('Umar back to idle', stateOf('c-umar'), 'idle')
  eq('Umar is now the remembered patient', session()?.active_patient_id, 'p-umar')

  console.log('— both check-ins pending: the sender is asked, the answer replays —')
  db.rows('whatsapp_conversations').find((c) => c.id === 'c-umar')!.conversation_state = 'awaiting_checkin_meds'
  db.rows('whatsapp_conversations').find((c) => c.id === 'c-farzana')!.conversation_state = 'awaiting_checkin_meds'
  session()!.active_until = '2000-01-01T00:00:00Z'   // memory expired
  await send(inbound(FAMILY_PHONE, '3'))
  sent = drain()
  includes('asked who "3" is for', sent[0]?.body ?? '', 'Who is this message about?')
  await send(inbound(FAMILY_PHONE, 'Farzana'))
  sent = drain()
  includes('"none taken" handled for Farzana', sent[0]?.body ?? '', 'Thank you for telling us, Farzana Arif')
  eq('missed-medication alert on Farzana\'s episode only', db.rows('alerts').filter((a) => a.type === 'missed_medication').map((a) => a.episode_id), ['ep-farzana'])
  eq('Umar still waiting for his own answer', stateOf('c-umar'), 'awaiting_checkin_meds')

  console.log('— an emergency is never held —')
  session()!.active_until = '2000-01-01T00:00:00Z'
  db.rows('whatsapp_conversations').find((c) => c.id === 'c-farzana')!.conversation_state = 'idle'
  db.rows('whatsapp_conversations').find((c) => c.id === 'c-umar')!.conversation_state = 'idle'
  await send(inbound(FAMILY_PHONE, 'he has chest pain'))
  sent = drain()
  includes('emergency reply went out immediately', sent[0]?.body ?? '', 'medical emergency')
  eq('critical alert raised', db.rows('alerts').filter((a) => a.severity === 'critical').length, 1)
  const emergencyEpisode = db.rows('alerts').find((a) => a.severity === 'critical')?.episode_id
  eq('…and that patient turns red — no triage needed', riskOf(String(emergencyEpisode)), 'red')

  console.log('— the question itself cannot be sent: nothing is held for nobody —')
  session()!.active_until = '2000-01-01T00:00:00Z'
  session()!.pending_choice = null
  failNextSend = 'Twilio is having a bad day'
  await send(inbound(FAMILY_PHONE, 'good evening'))
  sent = drain()
  eq('the greeting was still answered (for the likeliest patient)', sent.length, 1)
  includes('…for Umar, the newest episode', sent[0]?.body ?? '', 'Hello Umar Siddiqui')
  eq('routed as fallback', routingOf(inboundOf('c-umar').at(-1)!), 'fallback')
  eq('a low alert asks a nurse to confirm the patient', db.rows('alerts').filter((a) => a.severity === 'low' && a.episode_id === 'ep-umar').length, 1)
  eq('…with the reason on the timeline', db.rows('patient_timeline_events').filter((e) => (e.payload as { intent?: string }).intent === 'shared_number_best_guess').length, 1)
  eq('no question left pending', session()?.pending_choice ?? null, null)
  eq('the failed prompt is on the transcript as not delivered', messagesOf('c-umar').filter((m) => m.status === 'failed').length, 1)

  console.log('— a redelivered SID after handling is dropped —')
  const again = inbound(FAMILY_PHONE, 'thanks')
  await send(again)
  drain()
  await send({ ...again })
  eq('second delivery sends nothing', drain().length, 0)

  console.log('— the hospital writes first: the addressee becomes the topic —')
  eq('a number with one open episode gets no session', await rememberPatientIfShared(client, { hospitalId: 'h1', phone: SOLO_PHONE, patientId: 'p-solo', patientName: 'Priya Nair', episodeId: 'ep-solo' }), false)
  eq('…still no row', db.rows('whatsapp_number_sessions').some((s) => s.wa_phone === SOLO_PHONE), false)
  eq('a shared number does', await rememberPatientIfShared(client, { hospitalId: 'h1', phone: FAMILY_PHONE, patientId: 'p-farzana', patientName: 'Farzana Arif', episodeId: 'ep-farzana' }), true)
  eq('…and Farzana is now the topic', session()?.active_patient_id, 'p-farzana')
  await send(inbound(FAMILY_PHONE, 'thank you'))
  sent = drain()
  includes('so the relative\'s thanks goes to her', sent[0]?.body ?? '', 'Thank you, Farzana Arif')

  console.log('— what the dashboard is told about a number —')
  const soon = new Date(Date.now() + 3600_000).toISOString()
  const ago = new Date(Date.now() - 3600_000).toISOString()
  eq('no row → nothing', summariseNumberSession(null), null)
  eq('live memory', summariseNumberSession({ active_patient_id: 'p-umar', active_until: soon, pending_choice: null }), { activePatientId: 'p-umar', choicePending: false })
  eq('lapsed memory reads as none', summariseNumberSession({ active_patient_id: 'p-umar', active_until: ago, pending_choice: null }), { activePatientId: null, choicePending: false })
  eq('fresh question pending', summariseNumberSession({ active_patient_id: null, active_until: null, pending_choice: { options: ['a'], held: null, askedAt: new Date().toISOString() } })?.choicePending, true)
  eq('stale question is not pending', summariseNumberSession({ active_patient_id: null, active_until: null, pending_choice: { options: ['a'], held: null, askedAt: ago } })?.choicePending, false)

  console.log('— nightly housekeeping —')
  db.rows('whatsapp_number_sessions').push({ hospital_id: 'h1', wa_phone: '+971500000777', active_patient_id: null, active_until: null, pending_choice: null, updated_at: new Date(Date.now() - STALE_SESSION_MS - 1000).toISOString() })
  session()!.updated_at = new Date().toISOString()
  eq('a week-old session is pruned, the live one stays', [await pruneStaleNumberSessions(client), db.rows('whatsapp_number_sessions').map((s) => s.wa_phone)], [1, [FAMILY_PHONE]])

  console.log('— parsing what Twilio posts —')
  const twilio = (extra: Record<string, string>) => parseWebhookPayload({ MessageSid: 'SMx', From: 'whatsapp:+971500000001', To: 'whatsapp:+14155238886', ...extra })[0]
  eq('text', [twilio({ Body: 'hi', NumMedia: '0' }).type, twilio({ Body: 'hi', NumMedia: '0' }).text], ['text', 'hi'])
  eq('voice note', [twilio({ Body: '', NumMedia: '1', MediaUrl0: 'https://m/1', MediaContentType0: 'audio/ogg' }).type, twilio({ NumMedia: '1', MediaUrl0: 'https://m/1', MediaContentType0: 'audio/ogg' }).audioMimeType], ['audio', 'audio/ogg'])
  eq('picture without caption', twilio({ Body: '', NumMedia: '1', MediaUrl0: 'https://m/2', MediaContentType0: 'image/jpeg' }).type, 'image')
  eq('picture with caption is its caption', [twilio({ Body: 'is this ok?', NumMedia: '1', MediaContentType0: 'image/jpeg' }).type, twilio({ Body: 'is this ok?', NumMedia: '1', MediaContentType0: 'image/jpeg' }).text], ['text', 'is this ok?'])
  eq('pdf', twilio({ Body: '', NumMedia: '1', MediaContentType0: 'application/pdf' }).type, 'document')
  eq('sticker / location: unknown', twilio({ Body: '', NumMedia: '0', Latitude: '25.2' }).type, 'unknown')
  eq('profile name kept, trimmed', twilio({ Body: 'hi', ProfileName: '  Noor  ' }).senderName, 'Noor')
  eq('no profile name → absent', 'senderName' in twilio({ Body: 'hi' }), false)
  eq('phone without the whatsapp: prefix', twilio({ Body: 'hi' }).from, '+971500000001')

  console.log('— delivery receipts (Twilio StatusCallback) —')
  const receipt = (MessageStatus: string, extra: Record<string, string> = {}) =>
    parseStatusCallback({ MessageSid: 'SMout1', MessageStatus, SmsStatus: MessageStatus, To: `whatsapp:${SOLO_PHONE}`, From: `whatsapp:${HOSPITAL_NUMBER}`, AccountSid: 'AC', ...extra })
  eq('a receipt is recognised', receipt('delivered')?.status, 'delivered')
  eq('an inbound message is not a receipt', parseStatusCallback({ MessageSid: 'SMin99', SmsStatus: 'received', Body: 'hi', NumMedia: '0', From: 'whatsapp:+1', To: 'whatsapp:+2' }), null)
  eq('an inbound message parses as a message', parseWebhookPayload({ MessageSid: 'SMin99', SmsStatus: 'received', Body: 'hi', NumMedia: '0', From: 'whatsapp:+1', To: 'whatsapp:+2' })[0].type, 'text')
  eq('sent → delivered', nextRowStatus('sent', 'delivered'), 'delivered')
  eq('delivered → read', nextRowStatus('delivered', 'read'), 'read')
  eq('read then a late "delivered" is ignored', nextRowStatus('read', 'delivered'), null)
  eq('queued / sending change nothing', [nextRowStatus('sent', 'queued'), nextRowStatus('sent', 'sending')], [null, null])
  eq('undelivered → failed', nextRowStatus('delivered', 'undelivered'), 'failed')
  eq('failed is final', nextRowStatus('failed', 'delivered'), null)
  const firstOutbound = db.rows('whatsapp_messages').find((m) => m.wa_message_id === 'SMout1')!
  await applyStatusCallback(client, receipt('delivered')!)
  eq('row moved to delivered', firstOutbound.status, 'delivered')
  await applyStatusCallback(client, receipt('read')!)
  eq('row moved to read, stamped', [firstOutbound.status, typeof (firstOutbound.metadata as Record<string, unknown>).read_at], ['read', 'string'])
  await applyStatusCallback(client, receipt('delivered')!)
  eq('late delivered receipt does not roll back', firstOutbound.status, 'read')
  const secondOutbound = db.rows('whatsapp_messages').find((m) => m.wa_message_id === 'SMout2')!
  await applyStatusCallback(client, { ...receipt('failed', { ErrorCode: '63016', ErrorMessage: 'Failed to send freeform message' })!, messageSid: 'SMout2' })
  eq('failure explained in plain language', [secondOutbound.status, String((secondOutbound.metadata as Record<string, unknown>).error).includes('24-hour window'), (secondOutbound.metadata as Record<string, unknown>).error_code], ['failed', true, 63016])
  eq('…and the nurse is alerted once', db.rows('alerts').filter((a) => a.type === 'delivery_failed').length, 1)
  await applyStatusCallback(client, { ...receipt('delivered')!, messageSid: 'SM-not-ours' })
  eq('unknown SID ignored', db.log.filter((l) => l.op === 'update' && l.table === 'whatsapp_messages').length, 3)

  console.log('— sender queue: one number in order, different numbers side by side —')
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const order: string[] = []
  await Promise.all([
    withSenderLock('A', async () => { order.push('a1 start'); await sleep(30); order.push('a1 end') }),
    withSenderLock('A', async () => { order.push('a2') }),
    withSenderLock('B', async () => { order.push('b1') }),
    withSenderLock('A', async () => { throw new Error('boom') }).catch(() => order.push('a3 failed')),
    withSenderLock('A', async () => { order.push('a4') }),
  ])
  eq('a2 waits for a1, b1 does not; a failure does not block a4', order, ['a1 start', 'b1', 'a1 end', 'a2', 'a3 failed', 'a4'])
  eq('queue is empty afterwards', pendingSenders(), 0)

  // Through the real handler: two check-in answers from the family phone at
  // once. Serialised, "1" answers Q1 and "ok" answers Q2; unserialised both
  // would have read the same state.
  db.rows('whatsapp_conversations').find((c) => c.id === 'c-umar')!.conversation_state = 'awaiting_checkin_meds'
  session()!.active_patient_id = 'p-umar'
  session()!.active_until = new Date(Date.now() + 3600_000).toISOString()
  const key = senderKey(HOSPITAL_NUMBER, FAMILY_PHONE)
  await Promise.all([
    withSenderLock(key, () => send(inbound(FAMILY_PHONE, '1'))),
    withSenderLock(key, () => send(inbound(FAMILY_PHONE, 'ok'))),
  ])
  sent = drain()
  eq('two replies, in order: Q2 then good night', sent.map((m) => (m.body.includes('Sleep well') ? 'goodnight' : m.body.includes('feeling tonight') ? 'q2' : 'other')), ['q2', 'goodnight'])
  eq('conversation idle again', stateOf('c-umar'), 'idle')

  console.log('— a care plan that never arrived goes out again when the patient writes —')
  // Priya's plan was sent outside WhatsApp's 24-hour window: Twilio accepted it, then reported 63016.
  db.rows('discharge_summaries').push({
    id: 'sum-solo', episode_id: 'ep-solo', hospital_id: 'h1', status: 'sent', source_language: 'en',
    emergency_symptoms: ['Chest pain'], lifestyle_instructions: [], restrictions: [], activities: [],
  })
  db.rows('medications').push({ id: 'med-1', summary_id: 'sum-solo', hospital_id: 'h1', name: 'Aspirin', dosage: '75 mg', frequency: 'once daily', instructions: '', reminder_times: [], sort_order: 0 })
  // A Hindi translation of the letter from before the nurse corrected the dose (made before translations recorded their source text).
  db.rows('discharge_summary_translations').push({
    id: 'tr-solo', summary_id: 'sum-solo', language: 'hi',
    content: { medications: [{ name: 'एस्पिरिन', dosage: '300 मि.ग्रा.', frequency: 'दिन में एक बार' }], emergency_symptoms: ['सीने में दर्द'], lifestyle_instructions: [] },
  })
  await send(inbound(SOLO_PHONE, 'hello'))
  drain()
  const priyaConversation = db.rows('whatsapp_conversations').find((c) => c.episode_id === 'ep-solo')!
  db.rows('whatsapp_messages').push({
    id: 'm-plan-1', conversation_id: priyaConversation.id, hospital_id: 'h1', direction: 'outbound', message_type: 'text',
    wa_message_id: 'SMplan1', content: '(care plan)', status: 'failed',
    metadata: { kind: 'care_plan', summary_id: 'sum-solo', error_code: 63016, error: 'outside the 24-hour window' },
    created_at: '2026-09-22T10:26:19Z',
  })
  const modelCallsBefore = modelCalls.length
  await send(inbound(SOLO_PHONE, 'Hi'))
  sent = drain()
  includes('care plan re-sent first (in her language)', sent[0]?.body ?? '', 'डिस्चार्ज निर्देश')
  includes('…with her medicines', sent[0]?.body ?? '', 'Aspirin')
  eq('…as saved, not the stored translation of other text', [sent[0]?.body.includes('Aspirin 75 mg'), sent[0]?.body.includes('300 मि.ग्रा.')], [true, false])
  eq('…and no model call held up her reply', modelCalls.length - modelCallsBefore, 0)
  const planMeta = (m: Record<string, unknown>) => m.metadata as Record<string, unknown>
  const resent = db.rows('whatsapp_messages').filter((m) => m.conversation_id === priyaConversation.id && planMeta(m)?.kind === 'care_plan')
  eq('logged as a re-send triggered by her message', resent.map((m) => [planMeta(m).resend ?? null, planMeta(m).trigger ?? null]), [[null, null], [true, 'patient_message']])
  eq('timeline: summary_sent again, marked resend', db.rows('patient_timeline_events').filter((e) => e.episode_id === 'ep-solo' && e.event_type === 'summary_sent').map((e) => (e.payload as Record<string, unknown>).resend), [true])
  await send(inbound(SOLO_PHONE, 'thanks'))
  sent = drain()
  eq('not sent a third time once it went through', sent.filter((m) => m.body.includes('💊')).length, 0)

  console.log('— shared number: a message about one patient lets the other one\'s undelivered plan through —')
  // Umar's plan failed (63016). The family phone writes about Farzana: the
  // 24-hour window is the phone's, so Umar's plan can go out now too.
  db.rows('discharge_summaries').push({
    id: 'sum-umar', episode_id: 'ep-umar', hospital_id: 'h1', status: 'sent', source_language: 'en',
    emergency_symptoms: ['Chest pain'], lifestyle_instructions: [], restrictions: [], activities: [],
  })
  db.rows('medications').push({ id: 'med-umar', summary_id: 'sum-umar', hospital_id: 'h1', name: 'Ticagrelor', dosage: '90 mg', frequency: 'twice daily', instructions: '', reminder_times: [], sort_order: 0 })
  db.rows('whatsapp_messages').push({
    id: 'm-plan-umar', conversation_id: 'c-umar', hospital_id: 'h1', direction: 'outbound', message_type: 'text',
    wa_message_id: 'SMplanUmar', content: '(care plan)', status: 'failed',
    metadata: { kind: 'care_plan', summary_id: 'sum-umar', error_code: 63016, error: 'outside the 24-hour window' },
    created_at: '2026-09-22T10:26:19Z',
  })
  db.rows('whatsapp_conversations').find((c) => c.id === 'c-umar')!.conversation_state = 'idle'
  db.rows('whatsapp_conversations').find((c) => c.id === 'c-farzana')!.conversation_state = 'idle'
  await send(inbound(FAMILY_PHONE, 'Farzana: hello'))
  sent = drain()
  eq('two messages: her greeting first, then his plan', sent.length, 2)
  includes('the reply is about Farzana', sent[0]?.body ?? '', 'Hello Farzana Arif')
  includes('Umar\'s care plan re-sent to the same phone', sent[1]?.body ?? '', 'Hello Umar Siddiqui')
  includes('…with his medicines', sent[1]?.body ?? '', 'Ticagrelor')
  eq('logged on Umar\'s transcript as a re-send', db.rows('whatsapp_messages').filter((m) => m.conversation_id === 'c-umar' && planMeta(m)?.kind === 'care_plan').map((m) => planMeta(m).resend ?? null), [null, true])
  eq('the number is still taken to be about Farzana', session()?.active_patient_id, 'p-farzana')
  await send(inbound(FAMILY_PHONE, 'thanks'))
  sent = drain()
  eq('nothing re-sent twice', sent.filter((m) => m.body.includes('💊')).length, 0)

  console.log('— the whole conversation in her language: an emergency in Hindi —')
  await send(inbound(SOLO_PHONE, 'मेरे सीने में दर्द हो रहा है।'))
  sent = drain()
  includes('emergency reply in Hindi', sent[0]?.body ?? '', 'मेडिकल इमरजेंसी')
  includes('…addressed to her', sent[0]?.body ?? '', 'Priya Nair')
  eq('critical alert on her episode', db.rows('alerts').filter((a) => a.severity === 'critical' && a.episode_id === 'ep-solo').length, 1)
  eq('…and she is red', riskOf('ep-solo'), 'red')

  console.log('— a voice note whose audio cannot be downloaded: acknowledged in Hindi, a nurse takes it —')
  await send(inbound(SOLO_PHONE, undefined, 'audio', { audioUrl: 'https://media.example/voice.ogg', audioMimeType: 'audio/ogg' }))
  sent = drain()
  includes('acknowledged in Hindi', sent[0]?.body ?? '', 'आपका संदेश मिल गया है')
  eq('escalated at medium for a nurse', db.rows('alerts').filter((a) => a.severity === 'medium' && a.episode_id === 'ep-solo').length, 1)
  eq('a yellow-level report does not lower red', riskOf('ep-solo'), 'red')

  console.log('— the colour only goes up on its own; lowering is a nurse\'s call —')
  db.rows('care_episodes').find((e) => e.id === 'ep-farzana')!.current_risk_level = 'green'
  await raiseEpisodeRisk(client, 'ep-farzana', 'yellow')
  eq('green → yellow', riskOf('ep-farzana'), 'yellow')
  await raiseEpisodeRisk(client, 'ep-farzana', 'red')
  eq('yellow → red', riskOf('ep-farzana'), 'red')
  await raiseEpisodeRisk(client, 'ep-farzana', 'yellow')
  eq('red stays red', riskOf('ep-farzana'), 'red')
  eq('lowering needs a note, raising or keeping does not', [isLowering('red', 'green'), isLowering('red', 'yellow'), isLowering('yellow', 'red'), isLowering('green', 'green')], [true, true, false, false])

  console.log('— voice notes: the audio is kept, and a note is acted on only when heard clearly —')
  let voiceSid = 0
  const voiceNote = () => {
    const sid = `MMvoice${++voiceSid}`
    return inbound(SOLO_PHONE, undefined, 'audio', { audioUrl: `https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/${sid}/Media/ME${sid}`, audioMimeType: 'audio/ogg; codecs=opus' })
  }
  const solo = db.rows('whatsapp_conversations').find((c) => c.episode_id === 'ep-solo')!
  const lastSolo = () => inboundOf(String(solo.id)).at(-1)!
  const voiceOf = (m: Record<string, unknown>) => (m.metadata as { voice?: unknown } | undefined)?.voice
  const soloAlerts = () => db.rows('alerts').filter((a) => a.episode_id === 'ep-solo').length
  db.rows('care_episodes').find((e) => e.id === 'ep-solo')!.current_risk_level = 'green'
  solo.conversation_state = 'idle'

  heardNext = { transcript: 'नमस्ते', clarity: 92 }
  let alertsBefore = soloAlerts()
  await send(voiceNote())
  sent = drain()
  eq('heard clearly: answered like a typed "नमस्ते" — one reply, no "a nurse will review it"', [sent.length, sent[0]?.body.startsWith('नमस्ते Priya Nair')], [1, true])
  eq('the audio is kept for the nurse', db.uploads.at(-1), { bucket: 'voice-notes', path: `h1/ep-solo/${lastSolo().wa_message_id}.ogg`, contentType: 'audio/ogg', bytes: 4 })
  eq('the transcript is the message text; the audio path and clarity are on it', [lastSolo().content, lastSolo().media_storage_path, voiceOf(lastSolo())], ['नमस्ते', db.uploads.at(-1)?.path, { clarity: 92, clear: true }])
  eq('no alert', soloAlerts() - alertsBefore, 0)

  heardNext = { transcript: 'मुझे [unclear] कल से [unclear]', clarity: 45 }
  triageNext = 'yellow'
  alertsBefore = soloAlerts()
  await send(voiceNote())
  sent = drain()
  includes('not clear: told in Hindi that the care team will look at it', sent[0]?.body ?? '', 'आपका संदेश मिल गया है')
  eq('…one medium alert for the nurse', [soloAlerts() - alertsBefore, db.rows('alerts').at(-1)?.severity], [1, 'medium'])
  const unclearEvent = db.rows('patient_timeline_events').filter((e) => (e.payload as { intent?: string }).intent === 'unclear_voice_note').at(-1)?.payload as { clarity?: number; reason?: string } | undefined
  eq('…saying it was unclear, and how clear', [unclearEvent?.clarity, unclearEvent?.reason?.includes('45%')], [45, true])
  eq('…the patient turns yellow', riskOf('ep-solo'), 'yellow')
  eq('…and the message is marked unclear, with what was heard', [voiceOf(lastSolo()), lastSolo().content], [{ clarity: 45, clear: false }, 'मुझे [unclear] कल से [unclear]'])

  heardNext = { transcript: 'सीने में [unclear] साँस नहीं [unclear]', clarity: 40 }
  triageNext = 'red'
  alertsBefore = soloAlerts()
  await send(voiceNote())
  sent = drain()
  includes('not clear, but red: the urgent reply goes out at once', sent[0]?.body ?? '', 'ज़रूरी, Priya Nair')
  eq('…triage recorded red (the database raises the critical alert and the colour)', db.rows('triage_assessments').filter((t) => t.episode_id === 'ep-solo').at(-1)?.risk_level, 'red')
  eq('…and no "unclear" hand-over on top', soloAlerts() - alertsBefore, 0)

  heardNext = { transcript: '', clarity: 0 }
  alertsBefore = soloAlerts()
  await send(voiceNote())
  sent = drain()
  eq('nothing intelligible: acknowledged, handed to a nurse, nothing triaged', [sent[0]?.body.includes('आपका संदेश मिल गया है'), soloAlerts() - alertsBefore, modelCalls.at(-1)], [true, 1, 'transcribe'])

  solo.conversation_state = { state: 'nurse_attending', until: new Date(Date.now() + 600_000).toISOString(), by: 'nurse-1' }
  heardNext = { transcript: 'मैं ठीक हूँ', clarity: 95 }
  triageNext = 'green'
  await send(voiceNote())
  eq('while a nurse is chatting: the assistant says nothing', drain().length, 0)
  eq('…the nurse keeps the conversation, and the note was still triaged', [stateOf(String(solo.id)), modelCalls.at(-1)], ['nurse_attending', 'triage'])

  solo.conversation_state = 'idle'
  db.failUploads = true
  heardNext = { transcript: 'नमस्ते', clarity: 90 }
  await send(voiceNote())
  sent = drain()
  eq('storage not ready (00016 not applied): still heard and answered, no audio path', [sent[0]?.body.startsWith('नमस्ते Priya Nair'), lastSolo().media_storage_path ?? null], [true, null])
  db.failUploads = false

  console.log('— "2 — change the date": times offered, one chosen by its date, the appointment moves —')
  // Priya (Hindi, her own number): Cardiology on a Monday at least a week away, 09:00 in Dubai.
  const DUBAI = 'Asia/Dubai'
  let monday = new Date(Date.now() + 7 * 86400_000)
  while (formatInTimeZone(monday, DUBAI, 'i') !== '1') monday = new Date(monday.getTime() + 86400_000)
  const booked = fromZonedTime(`${formatInTimeZone(monday, DUBAI, 'yyyy-MM-dd')}T09:00:00`, DUBAI).toISOString()
  db.rows('appointments').push({
    id: 'appt-cardio', episode_id: 'ep-solo', hospital_id: 'h1', specialty: 'Cardiology', scheduled_at: booked, location: null,
    status: 'confirmation_pending', confirmation_requested_at: new Date().toISOString(), confirmed_at: null, time_tbc: false,
  })
  const appointment = () => db.rows('appointments').find((a) => a.id === 'appt-cardio')!
  const priyaState = () => stateOf(String(priyaConversation.id))
  const lastChange = () => db.rows('patient_timeline_events').filter((e) => e.event_type === 'appointment_rescheduled').at(-1)?.payload as Record<string, unknown> | undefined
  const openAppointmentAlerts = () => db.rows('alerts').filter((a) => a.type === 'unconfirmed_appointment' && a.episode_id === 'ep-solo').length
  const askToChange = async () => {
    appointment().status = 'confirmation_pending'
    priyaConversation.conversation_state = 'awaiting_appointment_confirm'
    await send(inbound(SOLO_PHONE, '2'))
    return drain()
  }
  const offered = proposeSlots({ current: booked, now: new Date(), timezone: DUBAI, clinicDays: DEFAULT_CLINIC_DAYS })
  const hindiLine = (i: number) => `*${i + 1}* — ${formatInTimeZone(new Date(offered[i]), DUBAI, 'EEEE, d MMMM, HH:mm')} बजे`

  sent = await askToChange()
  includes('three times offered, in Hindi', sent[0]?.body ?? '', [0, 1, 2].map(hindiLine).join('\n'))
  includes('…and a number for none of them', sent[0]?.body ?? '', '*4* भेजें')
  eq('appointment waits for a new time; conversation for the choice', [appointment().status, priyaState()], ['reschedule_pending', 'awaiting_slot_selection'])
  eq('what was offered is kept', (db.rows('appointment_slots_cache')[0]?.slots as Array<{ datetime: string }>).map((s) => s.datetime), offered)
  eq('timeline: the request, with the times offered', lastChange()?.offered, offered)

  await send(inbound(SOLO_PHONE, 'ok'))
  sent = drain()
  includes('"ok" is answered at once', sent[0]?.body ?? '', 'Priya Nair')
  eq('…and the times stay on offer', priyaState(), 'awaiting_slot_selection')

  await send(inbound(SOLO_PHONE, '7'))
  sent = drain()
  includes('a number not on the list: asked again', sent[0]?.body ?? '', 'माफ़ कीजिए Priya Nair')
  includes('…with the same times', sent[0]?.body ?? '', hindiLine(1))
  eq('…still waiting for the choice', priyaState(), 'awaiting_slot_selection')

  // The second time, typed as its date the way Umar typed "6th October".
  await send(inbound(SOLO_PHONE, formatInTimeZone(new Date(offered[1]), DUBAI, 'do MMMM')))
  sent = drain()
  includes('confirmed at the new time, in Hindi', sent[0]?.body ?? '', `${formatInTimeZone(new Date(offered[1]), DUBAI, 'EEEE, d MMMM yyyy')}*, *09:00* बजे पक्का`)
  eq('the appointment moved there, confirmed', [appointment().scheduled_at, appointment().status, typeof appointment().confirmed_at], [offered[1], 'confirmed', 'string'])
  eq('timeline: moved by the patient, from → to', [lastChange()?.from, lastChange()?.to, lastChange()?.chosen_by], [booked, offered[1], 'patient'])
  eq('offer cleared, conversation idle', [db.rows('appointment_slots_cache').length, priyaState()], [0, 'idle'])

  console.log('— none of the times suit: a nurse arranges it —')
  await askToChange()
  const ownDate = formatInTimeZone(new Date(Date.parse(booked) + 14 * 86400_000), DUBAI, 'do MMMM')   // not on the list
  await send(inbound(SOLO_PHONE, ownDate))
  sent = drain()
  includes('a date of her own: told a nurse will contact her, in Hindi', sent[0]?.body ?? '', 'नर्स आपसे संपर्क करके')
  eq('an alert for the nurse', openAppointmentAlerts(), 1)
  eq('timeline: the date she asked for', [lastChange()?.none_suit, lastChange()?.preference], [true, ownDate])
  eq('the appointment still needs a time; conversation idle', [appointment().status, priyaState()], ['reschedule_pending', 'idle'])
  await askToChange()
  await send(inbound(SOLO_PHONE, '4'))
  sent = drain()
  includes('"4": the same hand-off', sent[0]?.body ?? '', 'नर्स आपसे संपर्क करके')
  eq('…without a second open alert', openAppointmentAlerts(), 1)
  eq('…recorded as none of them', [lastChange()?.none_suit, lastChange()?.preference], [true, null])

  console.log('— a time that has gone by, and a nurse who got there first —')
  await askToChange()
  ;(db.rows('appointment_slots_cache')[0].slots as Array<{ datetime: string }>)[0].datetime = new Date(Date.now() - 3600_000).toISOString()
  await send(inbound(SOLO_PHONE, '1'))
  sent = drain()
  includes('told it has passed, with fresh times', sent[0]?.body ?? '', 'वह समय निकल चुका है')
  eq('…still waiting for the choice; the appointment has not moved', [priyaState(), appointment().scheduled_at], ['awaiting_slot_selection', offered[1]])
  appointment().status = 'confirmed'   // sorted out by phone meanwhile
  await send(inbound(SOLO_PHONE, '1'))
  sent = drain()
  includes('nothing moves; she is told a nurse will check', sent[0]?.body ?? '', 'कोई अपॉइंटमेंट नहीं मिला')
  eq('…offer cleared, conversation idle', [db.rows('appointment_slots_cache').length, priyaState(), appointment().scheduled_at], [0, 'idle', offered[1]])

  console.log('— the offer cannot be stored: straight to a nurse, never a list nobody can answer —')
  const realFrom = db.from.bind(db)
  const broken: Record<string, unknown> = {}
  for (const method of ['select', 'insert', 'delete', 'eq', 'order', 'limit', 'maybeSingle']) broken[method] = () => broken
  broken.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: { message: 'relation "appointment_slots_cache" does not exist' }, count: null })
  db.from = ((table: string) => (table === 'appointment_slots_cache' ? broken : realFrom(table))) as typeof db.from
  sent = await askToChange()
  db.from = realFrom
  includes('told a nurse will contact her', sent[0]?.body ?? '', 'नर्स आपसे संपर्क करके')
  eq('no list of times', sent.some((m) => m.body.includes('*1* —')), false)
  eq('conversation idle; the appointment waits for the nurse, who is alerted', [priyaState(), appointment().status, openAppointmentAlerts()], ['idle', 'reschedule_pending', 1])
  eq('timeline: the request, nothing offered', [lastChange()?.requested_by, lastChange()?.offered], ['patient', null])

  console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
  process.exit(fails ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
