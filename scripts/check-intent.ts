/**
 * Table-driven checks for the deterministic parts of inbound message handling:
 *   - lib/ai/intent.ts        pre-classification (acknowledgement / greeting / emergency)
 *   - lib/ai/chat.ts          deriveEscalation() — intent → escalate? + severity
 *   - lib/whatsapp/fsm.ts     transitions while awaiting a reminder response,
 *                             through the nightly check-in (Q1 meds, Q2 symptoms)
 *                             and through an appointment confirmation / reschedule
 *
 * No network or API keys needed. Run with:  npm run check:intent
 */
import { classifyPreIntent } from '@/lib/ai/intent'
import { deriveEscalation } from '@/lib/ai/chat'
import { transition, readConversationState } from '@/lib/whatsapp/fsm'
import type { ParsedInbound } from '@/lib/whatsapp/fsm'

let fails = 0

// Minimal inbound message for FSM checks
const inbound = (text?: string, type: ParsedInbound['type'] = 'text', extra: Partial<ParsedInbound> = {}): ParsedInbound =>
  ({ waMessageId: 'x', from: '+9715', type, text, timestamp: 0, ...extra })
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
  // Chest pain, breathing, fainting in every patient language: instant, no model
  ['ako ay nakakaramdam ng pananakit ng dibdib.', 'emergency'], ['hindi ako makahinga', 'emergency'], ['nahimatay si lolo', 'emergency'],
  ['எனக்கு நெஞ்சு வலி', 'emergency'], ['மூச்சு விட முடியவில்லை', 'emergency'],
  ['mujhe seene mein dard hai', 'emergency'], ['मुझे छाती में दर्द है', 'emergency'], ['لا أستطيع التنفس', 'emergency'],
  ['masakit ang ulo ko', 'unknown'], ['தலை வலி', 'unknown'],   // a headache is for the assistant, not an emergency
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
const t = (text: string) => transition('awaiting_reminder_response', inbound(text)).action
eq('"TAKEN"', t('TAKEN'), 'log_reminder_response')
eq('"done ✅"', t('done ✅'), 'log_reminder_response')
eq('"ok"', t('ok'), 'log_reminder_response')
eq('"1"', t('1'), 'log_reminder_response')
eq('"ले लिया"', t('ले लिया'), 'log_reminder_response')
eq('"no"', t('no'), 'route_to_triage')
eq('"not yet"', t('not yet'), 'route_to_triage')
eq('"I have chest pain"', t('I have chest pain'), 'route_to_ai')     // handler escalates as emergency
eq('"can I take it with milk?"', t('can I take it with milk?'), 'route_to_ai')
eq('idle + "thanks" → route_to_ai (handler answers instantly)', transition('idle', inbound('thanks')).action, 'route_to_ai')

console.log('— FSM: nightly check-in Q1 (awaiting_checkin_meds) —')
const q1 = (text: string) => {
  const r = transition('awaiting_checkin_meds', inbound(text))
  return r.action === 'log_checkin_meds' ? `${r.action}:${r.medsTaken}→${r.nextState}` : `${r.action}→${r.nextState}`
}
eq('"1"', q1('1'), 'log_checkin_meds:all→awaiting_checkin_symptoms')
eq('"Yes"', q1('Yes'), 'log_checkin_meds:all→awaiting_checkin_symptoms')
eq('"taken ✅"', q1('taken ✅'), 'log_checkin_meds:all→awaiting_checkin_symptoms')
eq('"all of them"', q1('all of them'), 'log_checkin_meds:all→awaiting_checkin_symptoms')
eq('"2"', q1('2'), 'log_checkin_meds:some→awaiting_checkin_symptoms')
eq('"some"', q1('some'), 'log_checkin_meds:some→awaiting_checkin_symptoms')
eq('"missed one"', q1('missed one'), 'log_checkin_meds:some→awaiting_checkin_symptoms')
eq('"3"', q1('3'), 'log_checkin_meds:none→awaiting_checkin_symptoms')
eq('"No"', q1('No'), 'log_checkin_meds:none→awaiting_checkin_symptoms')
eq('"not yet"', q1('not yet'), 'log_checkin_meds:none→awaiting_checkin_symptoms')
eq('"I forgot"', q1('I forgot'), 'log_checkin_meds:none→awaiting_checkin_symptoms')
eq('"نعم"', q1('نعم'), 'log_checkin_meds:all→awaiting_checkin_symptoms')
eq('"بعضها"', q1('بعضها'), 'log_checkin_meds:some→awaiting_checkin_symptoms')
eq('"नहीं"', q1('नहीं'), 'log_checkin_meds:none→awaiting_checkin_symptoms')
eq('"wala"', q1('wala'), 'log_checkin_meds:none→awaiting_checkin_symptoms')
eq('"my wound is red and swollen" (skipped Q1)', q1('my wound is red and swollen'), 'triage_text→idle')
eq('"I have chest pain" (emergency wins)', q1('I have chest pain'), 'route_to_ai→idle')
eq('sticker (no text) keeps Q1 pending', transition('awaiting_checkin_meds', inbound(undefined, 'unknown')).nextState, 'awaiting_checkin_meds')
eq('picture during Q1: told we cannot read it, Q1 still pending', transition('awaiting_checkin_meds', inbound(undefined, 'image')), { nextState: 'awaiting_checkin_meds', action: 'unsupported_media' })
eq('picture in idle: told, no model call', transition('idle', inbound(undefined, 'image')).action, 'unsupported_media')
eq('document in idle: told, no model call', transition('idle', inbound(undefined, 'document')).action, 'unsupported_media')
eq('sticker in idle: ignored, no model call', transition('idle', inbound(undefined, 'unknown')).action, 'noop')
eq('captioned picture arrives as text', transition('idle', inbound('is this normal?', 'text')).action, 'route_to_ai')

console.log('— FSM: nightly check-in Q2 (awaiting_checkin_symptoms) —')
const q2 = (text: string) => {
  const r = transition('awaiting_checkin_symptoms', inbound(text))
  return `${r.action}→${r.nextState}`
}
eq('"OK"', q2('OK'), 'checkin_ok→idle')
eq('"fine thanks"', q2('fine thanks'), 'checkin_ok→idle')
eq('"no symptoms"', q2('no symptoms'), 'checkin_ok→idle')
eq('"👍"', q2('👍'), 'checkin_ok→idle')
eq('"الحمد لله"', q2('الحمد لله'), 'checkin_ok→idle')
eq('"ठीक हूँ"', q2('ठीक हूँ'), 'checkin_ok→idle')
eq('"ayos lang"', q2('ayos lang'), 'checkin_ok→idle')
eq('"a bit dizzy and my ankle is swollen"', q2('a bit dizzy and my ankle is swollen'), 'triage_text→idle')
eq('"pain 8/10 in my stomach"', q2('pain 8/10 in my stomach'), 'triage_text→idle')
eq('"cant breathe" (emergency wins)', q2('cant breathe'), 'route_to_ai→idle')
eq('voice note', transition('awaiting_checkin_symptoms', inbound(undefined, 'audio', { audioUrl: 'https://x' })).action, 'route_to_triage')

console.log('— FSM: appointment confirmation and the times offered —')
const confirm = (text: string) => {
  const r = transition('awaiting_appointment_confirm', inbound(text))
  return `${r.action}→${r.nextState}`
}
eq('"1" confirms', confirm('1'), 'confirm_appointment→idle')
eq('"2" asks for other times', confirm('2'), 'start_reschedule→awaiting_slot_selection')
const pickSlot = (text: string, extra: Partial<ParsedInbound> = {}) => {
  const r = transition('awaiting_slot_selection', inbound(text, 'text', extra))
  return r.action === 'choose_slot' ? `choose_slot "${r.slotReply}"→${r.nextState}` : `${r.action}→${r.nextState}`
}
eq('"2" is read against the times offered', pickSlot('2'), 'choose_slot "2"→idle')
eq('"6th October" too', pickSlot('6th October'), 'choose_slot "6th October"→idle')
eq('"none of these" too', pickSlot('none of these'), 'choose_slot "none of these"→idle')
eq('list row slot_3', pickSlot('Thursday, 8 October', { interactiveId: 'slot_3' }), 'choose_slot "3"→idle')
eq('"ok" answered at once, the times stay on offer', pickSlot('ok'), 'route_to_ai→awaiting_slot_selection')
eq('a question goes to the assistant, the times stay on offer', pickSlot('can we do it after Eid?'), 'route_to_ai→awaiting_slot_selection')
eq('a symptom goes to the assistant (it checks warning signs)', pickSlot('I gained 3 kg since yesterday'), 'route_to_ai→awaiting_slot_selection')
eq('…even with a date in it', pickSlot("can't make the 6th, my leg is swollen"), 'route_to_ai→awaiting_slot_selection')
eq('"I have chest pain" (emergency wins)', pickSlot('I have chest pain'), 'route_to_ai→idle')

console.log('— FSM: nurse attending (dashboard chat) —')
const att = (text: string) => {
  const r = transition('nurse_attending', inbound(text))
  return `${r.action}→${r.nextState}`
}
eq('"the wound looks fine today" → logged only', att('the wound looks fine today'), 'noop→nurse_attending')
eq('"thanks nurse" → logged only', att('thanks nurse'), 'noop→nurse_attending')
eq('"I have chest pain" → emergency still wins', att('I have chest pain'), 'route_to_ai→idle')
eq('voice note → still triaged', transition('nurse_attending', inbound(undefined, 'audio', { audioUrl: 'https://x' })).action, 'route_to_triage')

console.log('— conversation_state parsing —')
const now = new Date('2026-09-19T12:00:00Z')
eq('bare string', readConversationState('awaiting_checkin_meds', now).state, 'awaiting_checkin_meds')
eq('trigger object', readConversationState({ state: 'idle' }, now).state, 'idle')
eq('unknown → idle', readConversationState('banana', now).state, 'idle')
eq('null → idle', readConversationState(null, now).state, 'idle')
eq('attending, live', readConversationState({ state: 'nurse_attending', until: '2026-09-19T12:29:00Z', by: 'n1' }, now), { state: 'nurse_attending', until: '2026-09-19T12:29:00Z', by: 'n1' })
eq('attending, expired → idle', readConversationState({ state: 'nurse_attending', until: '2026-09-19T11:59:00Z', by: 'n1' }, now).state, 'idle')
eq('attending without expiry → idle', readConversationState({ state: 'nurse_attending' }, now).state, 'idle')

console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
