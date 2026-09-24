/**
 * Checks for lib/ai/gemini.ts — the retry / model-fallback wrapper every AI
 * call goes through. The SDK's generateContent is stubbed, so no network or
 * real key is needed. Run with:  npm run check:gemini
 */
process.env.GEMINI_API_KEY = 'test-key' // imports are hoisted, so only the key (read lazily) can be set here

import { GenerativeModel, GoogleGenerativeAIFetchError } from '@google/generative-ai'
import { generate, GeminiUnavailableError, PRIMARY_MODEL, FALLBACK_MODELS } from '@/lib/ai/gemini'

const [primary, flash, lite, pro] = [PRIMARY_MODEL, ...FALLBACK_MODELS]

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

type Step = { status: number } | { text: string } | { networkError: true }

/** Script the outcome of each successive generateContent call and record which model was asked. */
function script(steps: Step[]) {
  const calls: string[] = []
  let i = 0
  GenerativeModel.prototype.generateContent = async function (this: GenerativeModel) {
    calls.push(this.model.replace(/^models\//, ''))
    const step = steps[i++] ?? { text: 'unscripted' }
    if ('status' in step) throw new GoogleGenerativeAIFetchError(`[${step.status}] scripted`, step.status, 'scripted')
    if ('networkError' in step) throw new Error('Error fetching from https://x: fetch failed')
    return { response: { text: () => step.text } } as unknown as ReturnType<GenerativeModel['generateContent']>
  } as GenerativeModel['generateContent']
  return calls
}

const quick = { budgetMs: 10_000 } // real backoff (0.8–1.1 s) but nothing that makes the check slow

async function main() {
  eq('default chain', [primary, flash, lite, pro], ['gemini-2.5-flash', 'gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'])

  // 1. Happy path: one call, primary answers.
  let calls = script([{ text: 'hello' }])
  let r = await generate('p', quick)
  eq('primary answers first time', [r.text, r.model, r.attempts, calls], ['hello', primary, 1, [primary]])

  // 2. Transient 503 then success on the same model.
  calls = script([{ status: 503 }, { text: 'ok' }])
  r = await generate('p', quick)
  eq('503 once → retried on primary', [r.model, r.attempts, calls], [primary, 2, [primary, primary]])

  // 3. Primary stays busy → fallback answers (the production incident).
  calls = script([{ status: 503 }, { status: 503 }, { text: 'from fallback' }])
  r = await generate('p', quick)
  eq('503 twice → the first fallback answers', [r.text, r.model, r.attempts, calls], ['from fallback', flash, 3, [primary, primary, flash]])

  // 4. 429: this model's quota is spent, and retrying it will not refill it. The next model has its own.
  calls = script([{ status: 429 }, { text: 'ok' }])
  r = await generate('p', quick)
  eq('429 → next model at once', [r.model, r.attempts, calls], [flash, 2, [primary, flash]])

  // 5. Dropped connection is retried.
  calls = script([{ networkError: true }, { text: 'ok' }])
  r = await generate('p', quick)
  eq('network error → retried', [r.attempts], [2])

  // 6. Unknown model (404) skips straight to the next one, no backoff wasted.
  calls = script([{ status: 404 }, { text: 'ok' }])
  r = await generate('p', quick)
  eq('404 → next model immediately', [r.model, r.attempts, calls], [flash, 2, [primary, flash]])

  // 7. Auth / bad-request problems are not retried and not passed to another model.
  calls = script([{ status: 403 }])
  let thrown: unknown
  try { await generate('p', quick) } catch (e) { thrown = e }
  eq('403 → thrown at once', [thrown instanceof GoogleGenerativeAIFetchError, calls], [true, [primary]])

  // 8. Everything busy → GeminiUnavailableError (status 503) after the whole chain.
  calls = script(Array.from({ length: 8 }, () => ({ status: 503 })))
  thrown = undefined
  try { await generate('p', { budgetMs: 60_000 }) } catch (e) { thrown = e }
  eq('all busy → GeminiUnavailableError, not a quota', [thrown instanceof GeminiUnavailableError, (thrown as GeminiUnavailableError)?.status, (thrown as GeminiUnavailableError)?.quotaReached, calls],
    [true, 503, false, [primary, primary, flash, flash, lite, lite, pro, pro]])

  // 8b. The 2026-09-24 incident: the primary's quota ran out and the old fallbacks were gone (404).
  //     Each model is asked once, and the error says "usage limit", not "busy".
  calls = script([{ status: 429 }, { status: 404 }, { status: 404 }, { status: 404 }])
  thrown = undefined
  try { await generate('p', quick) } catch (e) { thrown = e }
  eq('429 then 404s → usage limit reached', [(thrown as GeminiUnavailableError)?.quotaReached, /usage limit/.test((thrown as Error)?.message ?? ''), calls],
    [true, true, [primary, flash, lite, pro]])

  // 8c. Quota on one model, overload on another: that is "busy", and a minute may help.
  calls = script([{ status: 429 }, { status: 503 }, { status: 503 }, { status: 429 }, { status: 429 }])
  thrown = undefined
  try { await generate('p', { budgetMs: 60_000 }) } catch (e) { thrown = e }
  eq('429 and 503 mixed → busy', [(thrown as GeminiUnavailableError)?.quotaReached, calls], [false, [primary, flash, flash, lite, pro]])

  // 9. fallback:false stays on the primary.
  calls = script([{ status: 503 }, { status: 503 }])
  thrown = undefined
  try { await generate('p', { ...quick, fallback: false }) } catch (e) { thrown = e }
  eq('fallback:false → primary only', [thrown instanceof GeminiUnavailableError, calls], [true, [primary, primary]])

  // 10. A tiny budget never sleeps past it: one try per model at most, and it gives up fast.
  calls = script([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }])
  const t0 = Date.now()
  thrown = undefined
  try { await generate('p', { budgetMs: 1_000 }) } catch (e) { thrown = e }
  eq('budget exhausted → stops without waiting', [thrown instanceof GeminiUnavailableError, Date.now() - t0 < 900, calls],
    [true, true, [primary, flash, lite, pro]])

  // 11. noThinking: 2.5 Flash is asked to skip thinking; the 3.x fallbacks are asked as usual (a budget of 0 is a 400 for them).
  const sent: Array<{ model: string; request: unknown }> = []
  let busy = 0
  GenerativeModel.prototype.generateContent = async function (this: GenerativeModel, request: unknown) {
    sent.push({ model: this.model.replace(/^models\//, ''), request })
    if (busy-- > 0) throw new GoogleGenerativeAIFetchError('[503] scripted', 503, 'scripted')
    return { response: { text: () => 'ok' } } as unknown as ReturnType<GenerativeModel['generateContent']>
  } as GenerativeModel['generateContent']
  type Sent = { contents?: Array<{ parts: Array<{ text?: string }> }>; generationConfig?: { responseMimeType?: string; thinkingConfig?: { thinkingBudget?: number } } }
  const budgetOf = (request: unknown) => (typeof request === 'string' ? null : (request as Sent).generationConfig?.thinkingConfig?.thinkingBudget ?? null)

  busy = 4
  await generate('translate this', { budgetMs: 60_000, noThinking: true })
  eq('noThinking → budget 0 on 2.5 Flash only', sent.map((s) => [s.model, budgetOf(s.request)]),
    [[primary, 0], [primary, 0], [flash, null], [flash, null], [lite, null]])

  sent.length = 0
  await generate('plain prompt', { noThinking: true })
  eq('a string prompt is sent as contents', (sent[0].request as Sent).contents?.[0].parts[0].text, 'plain prompt')

  sent.length = 0
  await generate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }], generationConfig: { responseMimeType: 'application/json' } }, { noThinking: true })
  const config = (sent[0].request as Sent).generationConfig
  eq('the rest of generationConfig is kept', [config?.responseMimeType, config?.thinkingConfig?.thinkingBudget], ['application/json', 0])

  sent.length = 0
  await generate('plain prompt')
  eq('without noThinking the request goes as given', sent[0].request, 'plain prompt')

  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed')
  process.exit(fails ? 1 : 0)
}

main()
