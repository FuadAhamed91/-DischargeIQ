/**
 * Checks for lib/whatsapp/delivery.ts — what a Twilio status callback does
 * to the message row, and when it raises an alert. Runs on the in-memory
 * Supabase (scripts/lib/fake-supabase.ts); no keys, no network.
 *
 * Run with:  npm run check:delivery
 */
import { FakeDb } from './lib/fake-supabase'
import { applyDeliveryStatus, explainDeliveryError, normaliseTwilioStatus } from '@/lib/whatsapp/delivery'
import type { SupabaseClient } from '@supabase/supabase-js'

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

const db = new FakeDb({
  whatsapp_conversations: [{ id: 'c1', episode_id: 'ep1', hospital_id: 'h1', patient_id: 'p1', wa_phone: '+9715', conversation_state: { state: 'idle' } }],
  whatsapp_messages: [
    { id: 'plan', conversation_id: 'c1', hospital_id: 'h1', direction: 'outbound', message_type: 'text', wa_message_id: 'SMplan', content: 'care plan', status: 'sent', metadata: { kind: 'care_plan', summary_id: 's1' } },
    { id: 'chat', conversation_id: 'c1', hospital_id: 'h1', direction: 'outbound', message_type: 'text', wa_message_id: 'SMchat', content: 'hello', status: 'sent', metadata: {} },
  ],
})
const supabase = db as unknown as SupabaseClient
const row = (id: string) => db.rows('whatsapp_messages').find((m) => m.id === id)!
const meta = (id: string) => row(id).metadata as Record<string, unknown>
const apply = (messageSid: string, twilioStatus: string, errorCode?: number) => applyDeliveryStatus({ supabase, messageSid, twilioStatus, errorCode })

async function main() {
  eq('status mapping', ['queued', 'sending', 'sent', 'delivered', 'read', 'undelivered', 'failed', 'weird'].map(normaliseTwilioStatus),
    ['sent', 'sent', 'sent', 'delivered', 'read', 'failed', 'failed', null])
  eq('63016 explained', explainDeliveryError(63016).includes('24-hour window') && explainDeliveryError(63016).endsWith('(Twilio 63016)'), true)
  eq('unknown code still names it', explainDeliveryError(99999), 'Not delivered (Twilio error 99999)')
  eq('API message kept when no code', explainDeliveryError(null, 'boom'), 'boom')

  eq('unknown SID', (await apply('SMnope', 'delivered')).outcome, 'unknown_message')
  eq('"sent" again is a no-op', (await apply('SMplan', 'sent')).outcome, 'ignored')

  eq('delivered updates the row', (await apply('SMplan', 'delivered')).outcome, 'updated')
  eq('…status', [row('plan').status, (meta('plan').delivery as { status: string }).status], ['delivered', 'delivered'])
  eq('read after delivered', (await apply('SMplan', 'read')).outcome, 'updated')
  eq('late "delivered" cannot undo read', [(await apply('SMplan', 'delivered')).outcome, row('plan').status], ['ignored', 'read'])

  const failed = await apply('SMchat', 'failed', 63016)
  eq('failed updates + alerts once', [failed.outcome, (failed as { alerted?: boolean }).alerted, row('chat').status], ['updated', true, 'failed'])
  eq('…reason stored for the transcript', [meta('chat').error_code, String(meta('chat').error).includes('24-hour window')], [63016, true])
  eq('…alert on the episode', db.rows('alerts').map((a) => [a.episode_id, a.type, a.severity]), [['ep1', 'delivery_failed', 'low']])
  eq('…timeline carries the reason', db.rows('patient_timeline_events').map((e) => [e.event_type, (e.payload as { intent: string }).intent, (e.payload as { kind: string }).kind]), [['escalation_created', 'delivery_failed', 'message']])

  eq('a repeated failure callback is ignored', (await apply('SMchat', 'undelivered', 63016)).outcome, 'ignored')
  eq('…and raises no second alert', db.rows('alerts').length, 1)

  // A care plan that fails is a medium alert — the patient has no instructions.
  db.rows('whatsapp_messages').push({ id: 'plan2', conversation_id: 'c1', hospital_id: 'h1', direction: 'outbound', message_type: 'text', wa_message_id: 'SMplan2', content: 'care plan', status: 'sent', metadata: { kind: 'care_plan' } })
  await apply('SMplan2', 'failed', 63016)
  eq('care plan failure is medium + flagged for re-send', db.rows('alerts').slice(-1).map((a) => a.severity).concat(db.rows('patient_timeline_events').slice(-1).map((e) => (e.payload as { resend_on_reply: boolean }).resend_on_reply)), ['medium', true])

  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed')
  process.exit(fails ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
