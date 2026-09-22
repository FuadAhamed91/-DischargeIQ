/**
 * End-to-end checks for the inbound WhatsApp handler against an in-memory
 * database (scripts/lib/fake-supabase.ts) and a captured Twilio API.
 *
 * Covers what the unit tables cannot: that the handler actually asks a
 * shared number who a message is about, holds and replays the message,
 * keeps each patient's conversation and transcript apart, routes replies to
 * the conversation that is waiting, drops a redelivered SID, and leaves a
 * single-patient number exactly as it was. Only deterministic paths are
 * exercised (greetings, acknowledgements, the check-in, emergencies) — no
 * model call, no network, no API keys.
 *
 * Run with:  npm run check:webhook
 */

process.env.TWILIO_ACCOUNT_SID ??= 'ACtest'
process.env.TWILIO_AUTH_TOKEN ??= 'token'
process.env.TWILIO_WHATSAPP_NUMBER ??= 'whatsapp:+14155238886'
process.env.WHATSAPP_USE_TEXT_FALLBACK ??= 'true'
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://fake.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'fake'

import { FakeDb } from './lib/fake-supabase'
import { handleInboundMessage } from '@/lib/whatsapp/webhook-handler'
import { withSenderLock, senderKey, pendingSenders } from '@/lib/whatsapp/sender-queue'
import { parseStatusCallback, applyStatusCallback, nextRowStatus } from '@/lib/whatsapp/status-callback'
import { rememberPatientIfShared } from '@/lib/whatsapp/number-session'
import { parseWebhookPayload } from '@/lib/whatsapp/webhook-handler'
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
      { id: 'ep-farzana', hospital_id: 'h1', patient_id: 'p-farzana', status: 'active', created_at: '2026-09-10T08:00:00Z' },
      { id: 'ep-umar', hospital_id: 'h1', patient_id: 'p-umar', status: 'active', created_at: '2026-09-15T08:00:00Z' },
      { id: 'ep-solo', hospital_id: 'h1', patient_id: 'p-solo', status: 'active', created_at: '2026-09-16T08:00:00Z' },
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
  includes('told by name that the episode has ended', sent[0]?.body ?? '', 'Hi Priya Nair')
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
  eq('failure with the Twilio reason', [secondOutbound.status, (secondOutbound.metadata as Record<string, unknown>).error], ['failed', 'Failed to send freeform message (63016)'])
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

  console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
  process.exit(fails ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
