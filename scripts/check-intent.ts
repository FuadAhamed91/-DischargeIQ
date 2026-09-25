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

console.log('— Arabic as patients write it: instant, no model (each line lists any that miss) —')
const missed = (texts: string[]) => texts.filter((t) => classifyPreIntent(t) !== 'emergency')
eq('the phrases the keyword list always had', missed([
  'ألم في الصدر', 'الم في الصدر', 'ألم بالصدر', 'صعوبة في التنفس', 'ضيق في التنفس', 'لا أستطيع التنفس', 'لا استطيع التنفس', 'فقدان الوعي', 'فقد الوعي',
]), [])
eq('chest pain: "my chest", Gulf, Egyptian, Levantine, Sudanese, a relative', missed([
  'عندي ألم في صدري', 'عندي الم بصدري', 'ألم شديد في الصدر', 'الم في منطقة الصدر', 'عندي وجع في صدري', 'عندي عوار في صدري',
  'صدري يوجعني', 'صدري يعورني وايد', 'صدري قاعد يعورني', 'يعورني صدري', 'صدري بيوجعني اوي', 'صدري عم يوجعني', 'صدري واجعني',
  'صدري بوجعني', 'يؤلمني صدري', 'صدري يؤلمني', 'يوجعني راسي وصدري', 'حاس بكتمة في صدري', 'عندي كتمة', 'ثقل على صدري', 'ضيقة صدر',
  'قلبي يعورني', 'عندي ألم في قلبي', 'أبوي صدره يعوره', 'امي تقول صدرها يوجعها', 'امس كان عندي الم في صدري', 'هل الم الصدر طبيعي؟',
]), [])
eq('breathing: can\'t breathe in every dialect, short of breath, choking', missed([
  'ما اقدر اتنفس', 'مااقدر اتنفس', 'مب قادر أتنفس', 'ماني قادر اتنفس', 'مش قادرة اتنفس', 'مقدرش اتنفس', 'مش عارف اتنفس',
  'ما عم بقدر اتنفس', 'ما فيني اتنفس', 'ما اكدر اتنفس', 'لا أقدر على التنفس', 'لا اقدر اتنفس', 'ولا اقدر اتنفس', 'ما اقدر اخذ نفس',
  'ابوي ما يقدر يتنفس', 'خالتي ما تقدر تتنفس', 'اختي تقول ما تقدر تاخذ نفس', 'عندي ضيق تنفس', 'ابوي عنده ضيق تنفس',
  'ضيق في النفس', 'صعوبة بالتنفس', 'نفسي مقطوع', 'أحس إني أختنق',
]), [])
eq('unconscious, fainted, not responding', missed([
  'أغمي عليه', 'انغمى علي', 'امي مغمى عليها', 'ابوي طاح واغمي عليه', 'فقدت الوعي', 'غاب عن الوعي', 'ما يستجيب',
]), [])
eq('heavy bleeding, stroke, heart attack, seizure, self-harm', missed([
  'نزيف شديد', 'نزيف ما يوقف', 'الدم ما يوقف', 'الجرح ينزف وايد', 'ينزف كثير',
  'جاته جلطة', 'جاتها جلطة', 'صارت له جلطة', 'صابته سكتة', 'سكتة دماغية', 'وجهه مايل', 'فمه صار معوج', 'نص جسمي منمل',
  'نوبة قلبية', 'ذبحة صدرية', 'قلبه وقف', 'قلبها وقف', 'جاته نوبة صرع', 'يتشنج', 'ابوي يتشنج', 'امي تتشنج',
  'ابي اموت', 'أبغى أموت', 'بدي موت', 'أفكر في الانتحار', 'افكر انتحر',
]), [])
eq('however it is typed: diacritics, tatweel, Persian letters, punctuation, stretched letters, beside English', missed([
  'ألمٌ في الصّدر', 'صـدري يـوجعني', 'صدری یعورنی', 'صدري، يوجعني!!', 'صدريييي يعورنيييي', 'I have ألم في صدري',
  'Iam fine but صدري يوجعني', 'السلام عليكم، صدري يعورني من الصبح', 'لا، صدري يوجعني', 'الم في الصدر مع تعرق',
]), [])
eq('not an emergency: negated, a treatment\'s name, an idiom, a cramp, "can\'t talk now" (each line lists any that fire)', [
  'الحمد لله ما في ألم في صدري', 'صدري ما يعورني', 'صدري مايعورني الحمد لله', 'ما يعورني صدري', 'ما حسيت بألم في صدري',
  'ولا ألم في الصدر', 'بدون ألم في الصدر', 'ما عندي ضيق في التنفس', 'لا يوجد ضيق تنفس', 'ما فيه ضيق تنفس', 'ما عنده كتمة',
  'لا، أقدر أتنفس عادي', 'ما اغمي عليه الحمد لله', 'مافي اغماء', 'الجرح ما ينزف', 'ما في نزيف', 'وجهه مو مايل الحمد لله',
  'نص جسمه مو مشلول',
  'متى اخذ بخاخ ضيق التنفس؟', 'اخذت دواء الم الصدر', 'عندي مرض ضيق التنفس من زمان',
  'قلبي يعورني عليك', 'قلبي وقف من الخوف', 'جاب لي جلطة من كثر ما يتكلم', 'بموت من الجوع', 'نفسي اروح البيت', 'الجو كتمة اليوم',
  'عندي تشنج في رجلي', 'رجلي تتشنج بالليل', 'ما اقدر اتكلم الحين', 'عندي صداع خفيف', 'صدري زين الحمد لله',
  'متى موعدي مع دكتور القلب؟', 'أخذت دواء الضغط', 'ما مصدر الألم؟', 'صدر التقرير', 'المستشفى صدرت الفاتورة', 'ضيق الوقت',
].filter((t) => classifyPreIntent(t) === 'emergency'), [])
eq('Hindi typed with the precomposed फ़ (U+095E) still matches', classifyPreIntent(`सांस लेने में तकली${String.fromCharCode(0x095e)} हो रही है`), 'emergency')

console.log('— English: "no chest pain" is not a report —')
eq('not an emergency: a negation just before it (each line lists any that fire)', [
  'no chest pain', 'No chest pain today', 'no chest pain, just tired', 'I don’t have chest pain', 'I dont have any chest pain',
  'I do not have chest pain', 'I’m not having any chest pain', 'no more chest pain', 'no longer have chest pain',
  'not short of breath', 'I am not short of breath at all', 'no shortness of breath', 'not a heart attack', 'he hasn’t collapsed',
  'no fever and no chest pain', 'neither chest pain nor fever', 'I didn’t have a seizure', 'no severe bleeding', 'feeling ok\nno chest pain',
].filter((t) => classifyPreIntent(t) === 'emergency'), [])
eq('still an emergency: a report beside a negation, or a negation that is not about it (each line lists any that miss)', missed([
  'No I have chest pain', 'no, chest pain', 'No. Chest pain', 'no\nchest pain', 'no fever but chest pain', 'no fever and chest pain',
  'no chest pain but I can’t breathe', 'no chest pain, just chest tightness', 'I’ve never had chest pain like this',
  'I can’t walk without chest pain', 'not much chest pain', 'I don’t think it’s a heart attack', 'not sure if it’s chest pain',
  'chest pain doesn’t stop', 'the medicine didn’t help my chest pain', 'no have chest pain', 'I dont know why I have chest pain',
  'I can’t breathe', 'he is not responding', 'I cannot breathe', 'no chest pain yesterday. today chest pain',
]), [])
eq('Hindi, Tamil and Tagalog still alert when negated (the negation can belong to another verb)', [
  'सीने में दर्द नहीं है', 'सीने में दर्द नहीं रुक रहा', 'நெஞ்சு வலி இல்லை', 'walang sakit sa dibdib',
].map((t) => classifyPreIntent(t)), ['emergency', 'emergency', 'emergency', 'emergency'])

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
eq('"ما اقدر اتنفس" (emergency wins, in Gulf Arabic)', q2('ما اقدر اتنفس'), 'route_to_ai→idle')
eq('"الحمد لله صدري ما يعورني" → a symptom answer for triage, not an emergency', q2('الحمد لله صدري ما يعورني'), 'triage_text→idle')
eq('"no chest pain, just tired" → a symptom answer for triage, not an emergency', q2('no chest pain, just tired'), 'triage_text→idle')
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
