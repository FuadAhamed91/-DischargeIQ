/**
 * Checks for the nurse-chat translations in lib/ai/translation.ts: a nurse's
 * message into the patient's language, and the conversation into English for
 * the nurse. The SDK's generateContent is stubbed (as in check-gemini.ts), so
 * no network or real key is needed. Run with:  npm run check:translation
 */
process.env.GEMINI_API_KEY = 'test-key' // imports are hoisted, so only the key (read lazily) can be set here

import { GenerativeModel, GoogleGenerativeAIFetchError } from '@google/generative-ai'
import type { GenerateContentRequest } from '@google/generative-ai'
import { translateNurseMessage, translateMessagesToEnglish } from '@/lib/ai/translation'

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

/** Every request the stub received, as prompt text plus the JSON flag. */
const requests: Array<{ prompt: string; json: boolean }> = []

function promptOf(request: unknown): { prompt: string; json: boolean } {
  if (typeof request === 'string') return { prompt: request, json: false }
  const r = request as GenerateContentRequest
  const prompt = r.contents.flatMap((c) => c.parts.map((p) => ('text' in p ? p.text ?? '' : ''))).join('\n')
  return { prompt, json: r.generationConfig?.responseMimeType === 'application/json' }
}

/** The model's answer for one request; throw to make the call fail. */
let answer: (prompt: string) => string = () => ''

GenerativeModel.prototype.generateContent = async function (request: unknown) {
  const seen = promptOf(request)
  requests.push(seen)
  const text = answer(seen.prompt)
  return { response: { text: () => text } } as unknown as ReturnType<GenerativeModel['generateContent']>
} as GenerativeModel['generateContent']

/** The messages a transcript prompt carries (the JSON array at its end). */
const messagesIn = (prompt: string) => JSON.parse(prompt.slice(prompt.lastIndexOf('\n[') + 1)) as Array<{ id: string; text: string }>

/** A model that translates by prefixing "EN:" — and fails any batch containing "FAIL". */
const englishModel = (prompt: string) => {
  const msgs = messagesIn(prompt)
  if (msgs.some((m) => m.text.includes('FAIL'))) throw new GoogleGenerativeAIFetchError('[400] scripted', 400, 'scripted')
  return JSON.stringify(msgs.map((m) => ({ id: m.id, en: `EN:${m.text}` })))
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
  eq('one call, JSON requested', [requests.length, requests[0].json], [1, true])
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
  eq('one batch fails, the other still comes back', [requests.length, Object.keys(got).length, 'bad' in got], [2, 20, false])

  threw = false
  try { await translateMessagesToEnglish([{ id: 'bad', text: 'FAIL' }]) } catch { threw = true }
  eq('every batch failed → throws, so the route can say so', threw, true)

  console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
  process.exit(fails ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
