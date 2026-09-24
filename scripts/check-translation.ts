/**
 * Checks for the translations in lib/ai/translation.ts: a nurse's message
 * into the patient's language, the conversation into English for the nurse,
 * and the care plan, which must reach the patient as a translation of the
 * plan the nurse approved — never of the letter as it was first read. The
 * SDK's generateContent is stubbed (as in check-gemini.ts) and Twilio is
 * captured, on the in-memory Supabase (scripts/lib/fake-supabase.ts), so no
 * network or real key is needed. Run with:  npm run check:translation
 */
process.env.GEMINI_API_KEY = 'test-key' // imports are hoisted, so only settings read lazily can be set here
process.env.TWILIO_ACCOUNT_SID ??= 'ACtest'
process.env.TWILIO_AUTH_TOKEN ??= 'token'
process.env.TWILIO_WHATSAPP_NUMBER ??= 'whatsapp:+14155238886'
process.env.WHATSAPP_USE_TEXT_FALLBACK = 'true'

import { GenerativeModel, GoogleGenerativeAIFetchError } from '@google/generative-ai'
import type { GenerateContentRequest } from '@google/generative-ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import { FakeDb } from './lib/fake-supabase'
import { englishByText, keepByText, spreadEnglish, textsToTranslate } from '@/lib/ai/transcript-english'
import type { TranscriptRow } from '@/lib/ai/transcript-english'
import {
  translateNurseMessage,
  translateMessagesToEnglish,
  translateAndStoreSummary,
  dropStaleSummaryTranslations,
  summarySourceHash,
} from '@/lib/ai/translation'
import type { StoredSummaryTranslation } from '@/lib/ai/translation'
import type { ExtractionResult } from '@/lib/ai/extraction'
import { sendCarePlan } from '@/lib/whatsapp/care-plan'
import type { SendCarePlanParams } from '@/lib/whatsapp/care-plan'
import { buildDischargeSummaryMessage } from '@/lib/whatsapp/templates'
import type { DischargeSummary, Medication } from '@/types/database'

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

/** Every request the stub received: prompt text, the JSON flag, and the thinking budget asked for. */
const requests: Array<{ prompt: string; json: boolean; thinking: number | null }> = []

function promptOf(request: unknown): { prompt: string; json: boolean; thinking: number | null } {
  if (typeof request === 'string') return { prompt: request, json: false, thinking: null }
  const r = request as GenerateContentRequest & { generationConfig?: { thinkingConfig?: { thinkingBudget?: number } } }
  const prompt = r.contents.flatMap((c) => c.parts.map((p) => ('text' in p ? p.text ?? '' : ''))).join('\n')
  return { prompt, json: r.generationConfig?.responseMimeType === 'application/json', thinking: r.generationConfig?.thinkingConfig?.thinkingBudget ?? null }
}

/** The model's answer for one request; throw to make the call fail. */
let answer: (prompt: string) => string = () => ''
/** How long the model takes to answer. */
let answerAfterMs = 0
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

GenerativeModel.prototype.generateContent = async function (request: unknown) {
  const seen = promptOf(request)
  requests.push(seen)
  if (answerAfterMs) await sleep(answerAfterMs)
  const text = answer(seen.prompt)
  return { response: { text: () => text } } as unknown as ReturnType<GenerativeModel['generateContent']>
} as GenerativeModel['generateContent']

/** Every WhatsApp message body handed to Twilio. */
const outbox: string[] = []
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input)
  if (!url.includes('api.twilio.com')) throw new Error(`unexpected fetch: ${url}`)
  outbox.push(new URLSearchParams(String(init?.body ?? '')).get('Body') ?? '')
  return new Response(JSON.stringify({ sid: `SMout${outbox.length}` }), { status: 201, headers: { 'Content-Type': 'application/json' } })
}) as typeof fetch

/** The messages a transcript prompt carries (the JSON array at its end). */
const messagesIn = (prompt: string) => JSON.parse(prompt.slice(prompt.lastIndexOf('\n[') + 1)) as Array<{ id: string; text: string }>

/** A model that translates by prefixing "EN:" — and fails any batch containing "FAIL". */
const englishModel = (prompt: string) => {
  const msgs = messagesIn(prompt)
  if (msgs.some((m) => m.text.includes('FAIL'))) throw new GoogleGenerativeAIFetchError('[400] scripted', 400, 'scripted')
  return JSON.stringify(msgs.map((m) => ({ id: m.id, en: `EN:${m.text}` })))
}

/** The summary a care-plan translation prompt carries (its "Input JSON"). */
const summaryIn = (prompt: string): unknown =>
  JSON.parse(prompt.slice(prompt.indexOf('Input JSON:') + 'Input JSON:'.length, prompt.lastIndexOf('Return the translated JSON now:')))

/** "Hindi": every string of the input comes back marked हि:, in the same structure. */
const toHindi = (value: unknown): unknown =>
  typeof value === 'string' ? `हि:${value}`
    : Array.isArray(value) ? value.map(toHindi)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toHindi(v)]))
        : value
const hindiModel = (prompt: string) => JSON.stringify(toHindi(summaryIn(prompt)))

// ------------------------------------
// The care plan: Priya reads Hindi; her discharge letter was in English
// ------------------------------------

/** The letter as it was read. */
const letter: ExtractionResult = {
  medications: [
    { name: 'Aspirin', dosage: '75 mg', frequency: 'once daily', instructions: 'after food', reminder_times: ['08:00'] },
    { name: 'Atorvastatin', dosage: '40 mg', frequency: 'at night', instructions: '', reminder_times: ['21:00'] },
  ],
  follow_up_requirements: [{ specialty: 'Cardiology', deadline: '2026-10-08', instructions: null }],
  emergency_symptoms: ['Chest pain', 'Shortness of breath'],
  lifestyle_instructions: ['Rest for two weeks'],
  restrictions: ['No driving'],
  activities: [],
  source_language: 'en',
}

/** Her summary as persistExtraction saves that letter. */
const db = new FakeDb({
  discharge_summaries: [{
    id: 's1', episode_id: 'ep1', hospital_id: 'h1', status: 'approved', source_language: 'en', nurse_notes: null,
    emergency_symptoms: [...letter.emergency_symptoms], lifestyle_instructions: [...letter.lifestyle_instructions],
    restrictions: [...letter.restrictions], activities: [...letter.activities],
  }],
  medications: letter.medications.map((m, i) => ({ id: `med${i}`, summary_id: 's1', hospital_id: 'h1', ...m, sort_order: i })),
  follow_up_requirements: letter.follow_up_requirements.map((f, i) => ({ id: `fu${i}`, summary_id: 's1', hospital_id: 'h1', ...f })),
})
const client = db as unknown as SupabaseClient
const summaryRow = () => db.rows('discharge_summaries')[0]
const storedIn = (language: string) =>
  db.rows('discharge_summary_translations').find((t) => t.summary_id === 's1' && t.language === language)?.content as StoredSummaryTranslation | undefined

/**
 * Sends Priya's plan and returns what she received — as the nurse's Send
 * button does (the send route allows 25 s to translate), or with 0 as the
 * webhook's automatic re-send does.
 */
async function sendPlan(translateWithinMs = 25_000): Promise<string> {
  const sentBefore = outbox.length
  const result = await sendCarePlan({
    serviceClient: client,
    episodeId: 'ep1',
    summary: { ...summaryRow() } as SendCarePlanParams['summary'],
    patient: { id: 'p1', full_name: 'Priya Nair', phone: '+971500000002', preferred_language: 'hi' },
    hospital: { id: 'h1', name: 'Demo Hospital', whatsapp_phone_number_id: '+14155238886', timezone: 'Asia/Dubai' },
    translateWithinMs,
  })
  if (result.status !== 'success' || outbox.length !== sentBefore + 1) throw new Error(`the plan was not sent: ${result.error}`)
  return outbox[outbox.length - 1]
}

async function main() {
  console.log('— a nurse writes in English to a Hindi-speaking patient —')
  answer = () => '"रात के खाने के बाद एक गोली लें।"'
  requests.length = 0
  eq('translation, quotation marks removed', await translateNurseMessage('Take one tablet after dinner.', 'hi'), 'रात के खाने के बाद एक गोली लें।')
  eq('asked for Hindi in Devanagari, with the nurse\'s words', [
    requests[0].prompt.includes('into Hindi'),
    requests[0].prompt.includes('Devanagari'),
    requests[0].prompt.includes('Take one tablet after dinner.'),
    requests[0].prompt.includes('exactly as written'),
  ], [true, true, true, true])
  eq('…without the model\'s thinking step (speed)', requests[0].thinking, 0)

  answer = () => '```\nكل يوم مرة واحدة\n```'
  eq('a code fence around the answer is removed', await translateNurseMessage('Once a day', 'ar'), 'كل يوم مرة واحدة')

  answer = () => '"Uminom ng isang tableta"'
  eq('quotes the nurse typed are kept', await translateNurseMessage('"Take one tablet"', 'tl'), '"Uminom ng isang tableta"')

  answer = () => '  '
  let threw = false
  try { await translateNurseMessage('Hello', 'ta') } catch { threw = true }
  eq('an empty answer throws — nothing untranslated goes out silently', threw, true)

  console.log('— the conversation in English for the nurse —')
  answer = englishModel
  requests.length = 0
  let got = await translateMessagesToEnglish([
    { id: 'm1', text: 'मेरे सीने में दर्द हो रहा है।' },
    { id: 'm2', text: 'mujhe chakkar aa raha hai' },
  ])
  eq('each message comes back under its own id', got, { m1: 'EN:मेरे सीने में दर्द हो रहा है।', m2: 'EN:mujhe chakkar aa raha hai' })
  eq('one call, JSON requested, no thinking step', [requests.length, requests[0].json, requests[0].thinking], [1, true, 0])
  eq('faithful, not interpreted', requests[0].prompt.includes('stays vague'), true)

  answer = () => 'Here you go:\n[{"id":"m1","en":"I have chest pain."},{"id":"zz","en":"invented"},{"id":"m2","en":"  "},{"id":"m3"}]\nHope it helps.'
  got = await translateMessagesToEnglish([{ id: 'm1', text: 'a' }, { id: 'm2', text: 'b' }, { id: 'm3', text: 'c' }])
  eq('text around the array is ignored; unknown ids, blanks and missing fields dropped', got, { m1: 'I have chest pain.' })

  answer = () => 'not json at all'
  eq('an answer that is not JSON translates nothing (no throw)', await translateMessagesToEnglish([{ id: 'm1', text: 'a' }]), {})

  eq('nothing to translate → no call', [await translateMessagesToEnglish([]), requests.length], [{}, 3])

  console.log('— batching —')
  answer = englishModel
  requests.length = 0
  const many = Array.from({ length: 25 }, (_, i) => ({ id: `n${i}`, text: `message ${i}` }))
  got = await translateMessagesToEnglish(many)
  eq('25 short messages → 2 calls (20 + 5), all translated', [requests.length, Object.keys(got).length], [2, 25])

  requests.length = 0
  const long = 'x'.repeat(4_000)
  got = await translateMessagesToEnglish([{ id: 'a', text: long }, { id: 'b', text: long }, { id: 'c', text: 'short' }])
  eq('two long messages are not batched together (the short one rides along)', [requests.length, Object.keys(got).sort()], [2, ['a', 'b', 'c']])

  console.log('— failures —')
  requests.length = 0
  got = await translateMessagesToEnglish([...Array.from({ length: 20 }, (_, i) => ({ id: `ok${i}`, text: 'fine' })), { id: 'bad', text: 'FAIL' }])
  // The failing batch is asked twice: a 400 is first taken as the thinking setting, and retried without it.
  eq('one batch fails, the other still comes back', [requests.length, Object.keys(got).length, 'bad' in got], [3, 20, false])

  threw = false
  try { await translateMessagesToEnglish([{ id: 'bad', text: 'FAIL' }]) } catch { threw = true }
  eq('every batch failed → throws, so the route can say so', threw, true)

  console.log('— the care plan while nothing has changed: the letter\'s translation —')
  answer = hindiModel
  await translateAndStoreSummary(client, 's1', letter, ['hi', 'en'])   // as persistExtraction does, in after()
  eq('stored for her language and the hospital\'s, stamped with the text it was made from',
    [storedIn('hi')?.medications[0].dosage, storedIn('hi')?.source_hash === summarySourceHash(letter), storedIn('en')?.medications[0].dosage],
    ['हि:75 mg', true, '75 mg'])
  requests.length = 0
  let plan = await sendPlan()
  includes('sent in Hindi from the stored translation', plan, '• हि:Aspirin हि:75 mg — हि:once daily')
  eq('…with no model call at send', requests.length, 0)
  summaryRow().nurse_notes = 'Her daughter collects the medicines'
  eq('a save that changes nothing she reads keeps the translations', await dropStaleSummaryTranslations(client, 's1'), [])

  console.log('— the nurse corrects the dose, adds a warning sign and removes an instruction —')
  // What PATCH /summary saves…
  db.rows('medications')[0].dosage = '150 mg'
  summaryRow().emergency_symptoms = ['Chest pain', 'Shortness of breath', 'Fainting']
  summaryRow().lifestyle_instructions = []
  // …and then drops the translations of the old text.
  eq('the save drops every translation of the old text', (await dropStaleSummaryTranslations(client, 's1')).sort(), ['en', 'hi'])
  eq('…none left', db.rows('discharge_summary_translations').length, 0)

  requests.length = 0
  plan = await sendPlan()
  eq('the send translates the plan as edited, once, without the thinking step', [requests.length, requests[0]?.thinking], [1, 0])
  eq('…from the edited text', ['150 mg', 'Fainting', '75 mg', 'Rest for two weeks'].map((t) => requests[0]?.prompt.includes(t)), [true, true, false, false])
  includes('the corrected dose reaches her in Hindi', plan, '• हि:Aspirin हि:150 mg — हि:once daily')
  includes('…and the new warning sign', plan, '• हि:Fainting')
  eq('…and nothing stale: not the old dose, not the removed instruction', [plan.includes('75 mg'), plan.includes('Rest for two weeks')], [false, false])
  requests.length = 0
  plan = await sendPlan()
  eq('a resend uses the translation that send stored', [requests.length, plan.includes('• हि:Aspirin हि:150 mg')], [0, true])

  console.log('— the letter\'s translation lands after the edit (it runs in the background) —')
  await translateAndStoreSummary(client, 's1', letter, ['hi'])
  eq('(the stale translation is back in the table)', storedIn('hi')?.medications[0].dosage, 'हि:75 mg')
  requests.length = 0
  plan = await sendPlan()
  eq('the send sees it was made from other text and translates the plan again', [requests.length, plan.includes('• हि:Aspirin हि:150 mg'), plan.includes('75 mg')], [1, true, false])

  console.log('— re-sent when she writes (no time to translate), with a stale translation stored —')
  await translateAndStoreSummary(client, 's1', letter, ['hi'])
  requests.length = 0
  plan = await sendPlan(0)
  eq('no model call', requests.length, 0)
  includes('the plan as edited, as written', plan, '• Aspirin 150 mg — once daily')
  includes('…under her own headings', plan, 'डिस्चार्ज निर्देश')
  eq('…and nothing of the stale translation', [plan.includes('हि:'), plan.includes('75 mg')], [false, false])

  console.log('— the translation cannot be made —')
  answer = () => { throw new GoogleGenerativeAIFetchError('[400] scripted', 400, 'scripted') }
  plan = await sendPlan()
  includes('the model refuses: the plan still goes, as edited, as written', plan, '• Aspirin 150 mg — once daily')
  includes('…with the new warning sign', plan, '• Fainting')
  eq('…under her own headings, nothing stale', [plan.includes('डिस्चार्ज निर्देश'), plan.includes('हि:'), plan.includes('75 mg')], [true, false, false])

  answer = hindiModel
  answerAfterMs = 600
  const startedAt = Date.now()
  plan = await sendPlan(150)
  eq('the model is too slow: the plan goes as written, on time', [Date.now() - startedAt < 500, plan.includes('• Aspirin 150 mg — once daily'), plan.includes('हि:')], [true, true, false])
  await sleep(700)
  answerAfterMs = 0
  requests.length = 0
  plan = await sendPlan()
  eq('…and the translation, when it comes, is kept for a resend', [requests.length, plan.includes('• हि:Aspirin हि:150 mg')], [0, true])

  console.log('— a translation that lost or gained a line —')
  const built = buildDischargeSummaryMessage({
    to: '+971500000002', patientName: 'Priya Nair', hospitalName: 'Demo Hospital', language: 'hi',
    summary: { emergency_symptoms: ['Chest pain', 'Fainting'], lifestyle_instructions: [] } as unknown as DischargeSummary,
    medications: [{ name: 'Aspirin', dosage: '150 mg', frequency: 'once daily' }] as Medication[],
    translation: {
      medications: [{ name: 'हि:Aspirin', dosage: 'हि:150 mg', frequency: 'हि:once daily' }],
      emergency_symptoms: ['हि:Chest pain'],
      lifestyle_instructions: ['हि:Rest for two weeks'],
    },
  })
  plan = built.type === 'text' ? built.body : ''
  includes('medicines item for item: translated', plan, '• हि:Aspirin हि:150 mg — हि:once daily')
  includes('warning signs one short: all of them, as written', plan, '• Chest pain\n• Fainting')
  eq('an instruction she no longer has is not sent', plan.includes('Rest for two weeks'), false)

  console.log('— the same sentence is read once, not once per message —')
  // A real Tamil episode: 44 messages, 8 distinct texts — the nightly
  // check-in nine times over, "1", "I am fine". Asking per message id asked
  // for the same sentence nine times, and on a busy key left the nurse with a
  // red banner over English the episode had already been told.
  const CHECKIN = 'மாலை வணக்கம் Karthik 🌙'
  const CHECKIN_EN = 'Good evening Karthik 🌙'
  const FINE = 'நலமாக இருக்கிறேன்'
  const msg = (id: string, content: string | null, en?: string): TranscriptRow =>
    ({ id, content, metadata: en ? { translation_en: en, kind: 'checkin' } : {} })

  // Newest first, as the route reads them.
  const transcript: TranscriptRow[] = [
    msg('m6', CHECKIN), msg('m5', FINE), msg('m4', '1'),
    msg('m3', CHECKIN, CHECKIN_EN), msg('m2', FINE, 'I am fine'), msg('m1', 'வணக்கம் 👋', 'Hello 👋'),
  ]
  let known = englishByText(transcript)
  eq('what the episode knows is keyed by text', [...known.values()].sort(), [CHECKIN_EN, 'Hello 👋', 'I am fine'])
  eq('tonight’s check-in needs no model call at all', textsToTranslate(transcript, ['m6', 'm5', 'm4'], known), [])

  let spread = spreadEnglish(transcript, known)
  eq('every copy shows English, including ones nobody asked about', Object.keys(spread.translations).sort(), ['m1', 'm2', 'm3', 'm5', 'm6'])
  eq('…the copy the nurse is looking at', spread.translations.m6, CHECKIN_EN)
  eq('"1" is never sent: it is the answer in any language', textsToTranslate(transcript, ['m4'], new Map()), [])
  eq('"1" has nothing to show', 'm4' in spread.translations, false)
  eq('only the copies missing it are written back', spread.writes.map((w) => w.id).sort(), ['m5', 'm6'])

  const fresh: TranscriptRow[] = [msg('n4', CHECKIN), msg('n3', CHECKIN), msg('n2', CHECKIN), msg('n1', FINE)]
  known = englishByText(fresh)
  const todo = textsToTranslate(fresh, ['n4', 'n3', 'n2', 'n1'], known)
  eq('a transcript with no English yet: one entry per distinct text', [todo.map((t) => t.text), todo.map((t) => t.id)], [[CHECKIN, FINE], ['n4', 'n1']])
  answer = englishModel
  requests.length = 0
  keepByText(todo, await translateMessagesToEnglish(todo), known)
  eq('the model is asked for the two texts, not the four messages', [requests.length, JSON.parse(requests[0].prompt.slice(requests[0].prompt.indexOf('['))).length], [1, 2])
  spread = spreadEnglish(fresh, known)
  eq('one answer covers all three copies', [spread.translations.n4, spread.translations.n3, spread.translations.n2].map((en) => en?.startsWith('EN:')), [true, true, true])
  eq('…and all four are stored', spread.writes.length, 4)

  known = englishByText([msg('x1', CHECKIN)])
  keepByText([{ id: 'x1', text: CHECKIN }], {}, known)
  eq('a text the model left out stays untranslated', spreadEnglish([msg('x1', CHECKIN)], known).translations, {})
  eq('blank messages are never sent', textsToTranslate([msg('b1', '   '), msg('b2', null)], ['b1', 'b2'], new Map()), [])
  eq('an empty stored translation does not count as known', englishByText([msg('e1', FINE, '  ')]).size, 0)
  eq('the same text is matched past its spacing', textsToTranslate([msg('s1', ` ${FINE} `)], ['s1'], englishByText([msg('s0', FINE, 'I am fine')])), [])

  console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
  process.exit(fails ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
