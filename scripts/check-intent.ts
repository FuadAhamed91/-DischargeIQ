/**
 * Table-driven checks for the deterministic parts of inbound message handling:
 *   - lib/ai/intent.ts        pre-classification (acknowledgement / greeting / emergency)
 *   - lib/ai/chat.ts          deriveEscalation() — intent → escalate? + severity
 *   - lib/whatsapp/fsm.ts     transitions while awaiting a reminder response
 *
 * No network or API keys needed. Run with:  npm run check:intent
 */
import { classifyPreIntent } from '@/lib/ai/intent'
import { deriveEscalation } from '@/lib/ai/chat'
import { transition } from '@/lib/whatsapp/fsm'

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

console.log('— pre-intent (deterministic) —')
const pre: Array<[string, string]> = [
  ['TAKEN', 'acknowledgement'], ['Taken ✅', 'acknowledgement'], ['taken.', 'acknowledgement'], ['ok thanks', 'acknowledgement'], ['taken thank you', 'acknowledgement'], ['yes done', 'acknowledgement'], ['ok what about food', 'unknown'], ['thanks doctor', 'unknown'],
  ['thank you so much', 'acknowledgement'], ['👍', 'acknowledgement'], ['🙏🙏', 'acknowledgement'],
  ['شكراً', 'acknowledgement'], ['تم', 'acknowledgement'], ['ले लिया', 'acknowledgement'], ['நன்றி', 'acknowledgement'], ['salamat po', 'acknowledgement'],
  ['hi', 'greeting'], ['Good morning!', 'greeting'], ['السلام عليكم', 'greeting'], ['kumusta po', 'greeting'],
  ['I have taken the paracetamol', 'unknown'],                       // sentence → model decides (should be acknowledgement there)
  ['Can I take my metformin after dinner?', 'unknown'],
  ['ok but I have chest pain', 'emergency'], ['I can’t breathe properly', 'emergency'], ['cant breathe', 'emergency'],
  ['my father collapsed', 'emergency'], ['', 'unknown'],
]
for (const [input, want] of pre) eq(JSON.stringify(input), classifyPreIntent(input), want)

console.log('— escalation derived from model intent —')
eq('acknowledgement never escalates', deriveEscalation({ intent: 'acknowledgement', confidence: 'low' }).shouldEscalate, false)
eq('greeting never escalates', deriveEscalation({ intent: 'greeting', confidence: 'low' }).shouldEscalate, false)
eq('in-scope high → no', deriveEscalation({ intent: 'question_in_scope', confidence: 'high' }).shouldEscalate, false)
eq('in-scope low → low', deriveEscalation({ intent: 'question_in_scope', confidence: 'low' }).severity, 'low')
eq('out-of-scope → low', deriveEscalation({ intent: 'question_out_of_scope', confidence: 'high' }).severity, 'low')
eq('concern → medium', deriveEscalation({ intent: 'concern', confidence: 'high' }).severity, 'medium')
eq('concern + emergency symptom → high', deriveEscalation({ intent: 'concern', confidence: 'high', matchesEmergencySymptom: true }).severity, 'high')
eq('garbage intent → fail closed (out_of_scope, low)', deriveEscalation({ intent: 'banana' }).severity, 'low')

console.log('— FSM in awaiting_reminder_response —')
const t = (text: string) => transition('awaiting_reminder_response', { type: 'text', text, from: '+9715', waMessageId: 'x' } as any).action
eq('"TAKEN"', t('TAKEN'), 'log_reminder_response')
eq('"done ✅"', t('done ✅'), 'log_reminder_response')
eq('"ok"', t('ok'), 'log_reminder_response')
eq('"1"', t('1'), 'log_reminder_response')
eq('"ले लिया"', t('ले लिया'), 'log_reminder_response')
eq('"no"', t('no'), 'route_to_triage')
eq('"not yet"', t('not yet'), 'route_to_triage')
eq('"I have chest pain"', t('I have chest pain'), 'route_to_ai')     // handler escalates as emergency
eq('"can I take it with milk?"', t('can I take it with milk?'), 'route_to_ai')
eq('idle + "thanks" → route_to_ai (handler answers instantly)', transition('idle', { type: 'text', text: 'thanks', from: '+9715', waMessageId: 'x' } as any).action, 'route_to_ai')

console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
