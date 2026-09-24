/**
 * Checks for lib/ai/gemini.ts — the retry / model-fallback wrapper every AI
 * call goes through. The SDK's generateContent is stubbed, so no network or
 * real key is needed. Run with:  npm run check:gemini
 */
process.env.GEMINI_API_KEY = 'test-key' // imports are hoisted, so only the key (read lazily) can be set here

import { GenerativeModel, GoogleGenerativeAIFetchError } from '@google/generative-ai'
import { generate, GeminiUnavailableError, PRIMARY_MODEL, FALLBACK_MODELS, leastThinking, resetModelState } from '@/lib/ai/gemini'
import { flattenForGroq, resetGroqState, GROQ_MODELS } from '@/lib/ai/groq'

const [primary, flash, lite, pro] = [PRIMARY_MODEL, ...FALLBACK_MODELS]

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

type Step = { status: number; details?: unknown[] } | { text: string } | { networkError: true }

/** A daily free-tier quota refusal, as Google words it in error.details. */
const DAILY_QUOTA = [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }]

/**
 * Script the outcome of each successive generateContent call and record which
 * model was asked and with what. Starts from a clean slate (no resting models)
 * unless `keep` is set.
 */
function script(steps: Step[], opts: { keep?: boolean } = {}) {
  if (!opts.keep) resetModelState()
  const calls: string[] = []
  const requests: unknown[] = []
  let i = 0
  GenerativeModel.prototype.generateContent = async function (this: GenerativeModel, request: unknown) {
    calls.push(this.model.replace(/^models\//, ''))
    requests.push(request)
    const step = steps[i++] ?? { text: 'unscripted' }
    if ('status' in step) throw new GoogleGenerativeAIFetchError(`[${step.status}] scripted`, step.status, 'scripted', step.details as never)
    if ('networkError' in step) throw new Error('Error fetching from https://x: fetch failed')
    return { response: { text: () => step.text } } as unknown as ReturnType<GenerativeModel['generateContent']>
  } as GenerativeModel['generateContent']
  return Object.assign(calls, { requests })
}

type Sent = { contents?: Array<{ parts: Array<{ text?: string }> }>; generationConfig?: { responseMimeType?: string; thinkingConfig?: Record<string, unknown> } }
const thinkingOf = (request: unknown) => (typeof request === 'string' ? null : (request as Sent).generationConfig?.thinkingConfig ?? null)

const quick = { budgetMs: 10_000 } // real backoff (0.8–1.1 s) but nothing that makes the check slow

type GroqStep = { text: string } | { status: number; body: string } | { models: string[] }

/**
 * Script Groq's HTTP answers (it is called over plain fetch, not an SDK) and
 * record which model was asked with what. A { models } step answers the
 * /models listing the code makes after a model is refused.
 */
function groqScript(steps: GroqStep[]) {
  process.env.GROQ_API_KEY = 'groq-test-key'
  const models: string[] = []
  const prompts: string[] = []
  const bodies: unknown[] = []
  let i = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const step = steps[i++] ?? { status: 500, body: 'unscripted' }
    if (url.endsWith('/models')) {
      const listed = 'models' in step ? step.models : []
      return new Response(JSON.stringify({ data: listed.map((id) => ({ id })) }), { status: 200 })
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as { model: string; messages: Array<{ content: string }> }
    models.push(body.model)
    prompts.push(body.messages[0].content)
    bodies.push(body)
    if ('status' in step) return new Response(step.body, { status: step.status })
    if ('models' in step) return new Response('{}', { status: 500 })
    return new Response(JSON.stringify({ choices: [{ message: { content: step.text } }] }), { status: 200 })
  }) as typeof fetch
  return Object.assign(models, { models, prompts, bodies })
}

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

  // 4b. ...and the spent model rests: the next call does not open with another refusal.
  calls = script([{ status: 429, details: DAILY_QUOTA }, { text: 'first' }])
  await generate('p', quick)
  calls = script([{ text: 'second' }], { keep: true })
  r = await generate('p', quick)
  eq('after a daily-quota 429 the next call starts on the fallback', [r.text, r.model, calls], ['second', flash, [flash]])

  // 4c. A resting model is still asked when nothing else answers.
  calls = script([{ status: 404 }, { status: 404 }, { status: 404 }, { text: 'back' }], { keep: true })
  r = await generate('p', quick)
  eq('resting model tried last', [r.text, r.model, calls], ['back', primary, [flash, lite, pro, primary]])

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

  // 8. Everything busy → GeminiUnavailableError (status 503) after the whole chain; a fallback gets one try.
  calls = script(Array.from({ length: 5 }, () => ({ status: 503 })))
  thrown = undefined
  try { await generate('p', { budgetMs: 60_000 }) } catch (e) { thrown = e }
  eq('all busy → GeminiUnavailableError, not a quota', [thrown instanceof GeminiUnavailableError, (thrown as GeminiUnavailableError)?.status, (thrown as GeminiUnavailableError)?.quotaReached, calls],
    [true, 503, false, [primary, primary, flash, lite, pro]])

  // 8b. The 2026-09-24 incident: the primary's quota ran out and the old fallbacks were gone (404).
  //     Each model is asked once, and the error says "usage limit", not "busy".
  calls = script([{ status: 429 }, { status: 404 }, { status: 404 }, { status: 404 }])
  thrown = undefined
  try { await generate('p', quick) } catch (e) { thrown = e }
  eq('429 then 404s → usage limit reached', [(thrown as GeminiUnavailableError)?.quotaReached, /usage limit/.test((thrown as Error)?.message ?? ''), calls],
    [true, true, [primary, flash, lite, pro]])

  // 8c. Quota on one model, overload on another: that is "busy", and a minute may help.
  calls = script([{ status: 429 }, { status: 503 }, { status: 429 }, { status: 429 }])
  thrown = undefined
  try { await generate('p', { budgetMs: 60_000 }) } catch (e) { thrown = e }
  eq('429 and 503 mixed → busy', [(thrown as GeminiUnavailableError)?.quotaReached, calls], [false, [primary, flash, lite, pro]])

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

  // 11. noThinking: each model is asked for the least thinking it takes.
  eq('least thinking per model', ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-3.1-pro-preview'].map(leastThinking),
    [{ thinkingBudget: 0 }, { thinkingBudget: 0 }, null, { thinkingLevel: 'minimal' }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'minimal' }, { thinkingLevel: 'low' }, { thinkingLevel: 'low' }])

  calls = script([{ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { text: 'ok' }])
  await generate('translate this', { budgetMs: 60_000, noThinking: true })
  eq('noThinking → sent to each model in the chain', calls.map((m, i) => [m, thinkingOf(calls.requests[i])]),
    [[primary, { thinkingBudget: 0 }], [primary, { thinkingBudget: 0 }], [flash, { thinkingLevel: 'minimal' }], [lite, { thinkingLevel: 'minimal' }], [pro, { thinkingLevel: 'low' }]])

  // 11b. A model that turns the thinking setting down (400) is asked again without it, and not given it again.
  calls = script([{ status: 400 }, { text: 'plain' }])
  r = await generate('p', { ...quick, noThinking: true })
  eq('400 to the thinking setting → asked again without it', [r.text, r.model, calls, calls.requests.map(thinkingOf)],
    ['plain', primary, [primary, primary], [{ thinkingBudget: 0 }, null]])
  calls = script([{ text: 'again' }], { keep: true })
  await generate('p', { ...quick, noThinking: true })
  eq('...and it is not sent the setting again', calls.requests.map(thinkingOf), [null])

  // 11c. A 400 that is not about thinking still ends the call (after that one plain retry).
  calls = script([{ status: 400 }, { status: 400 }])
  thrown = undefined
  try { await generate('p', { ...quick, noThinking: true }) } catch (e) { thrown = e }
  eq('400 again without thinking → thrown', [thrown instanceof GoogleGenerativeAIFetchError, calls], [true, [primary, primary]])
  calls = script([{ text: 'ok' }], { keep: true })
  await generate('p', { ...quick, noThinking: true })
  eq('...and the setting is kept for next time (it was not the problem)', calls.requests.map(thinkingOf), [{ thinkingBudget: 0 }])

  calls = script([{ text: 'ok' }])
  await generate('plain prompt', { noThinking: true })
  eq('a string prompt is sent as contents', (calls.requests[0] as Sent).contents?.[0].parts[0].text, 'plain prompt')

  calls = script([{ text: 'ok' }])
  await generate({ contents: [{ role: 'user', parts: [{ text: 'x' }] }], generationConfig: { responseMimeType: 'application/json' } }, { noThinking: true })
  const config = (calls.requests[0] as Sent).generationConfig
  eq('the rest of generationConfig is kept', [config?.responseMimeType, config?.thinkingConfig], ['application/json', { thinkingBudget: 0 }])

  calls = script([{ text: 'ok' }])
  await generate('plain prompt')
  eq('without noThinking the request goes as given', calls.requests[0], 'plain prompt')

  // ------------------------------------
  // Groq, once Gemini has nothing left (lib/ai/groq.ts)
  // ------------------------------------
  console.log('— Groq —')
  const [groqFirst, groqSecond] = GROQ_MODELS
  const DEAD = [{ status: 429, details: DAILY_QUOTA }, { status: 503 }, { status: 503 }, { status: 503 }] as Step[]

  eq('text is flattened to one turn', [
    flattenForGroq('hello'),
    flattenForGroq({ contents: [{ role: 'user', parts: [{ text: 'a' }, { text: 'b' }] }], generationConfig: { responseMimeType: 'application/json' } }),
  ], [{ text: 'hello', json: false }, { text: 'a\nb', json: true }])
  eq('a voice note is not Groq’s to answer', flattenForGroq({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/ogg', data: 'x' } }] }] }), null)

  calls = script(DEAD)
  let groq = groqScript([{ text: 'from groq' }])
  r = await generate('p', quick)
  eq('every Gemini model spent → Groq answers', [r.text, r.model, r.attempts], ['from groq', `groq:${groqFirst}`, 5])
  eq('…asked once, with the prompt as sent', [groq.length, groq.prompts[0]], [1, 'p'])

  calls = script([{ text: 'gemini' }])
  groq = groqScript([{ text: 'groq' }])
  r = await generate('p', quick)
  eq('Gemini answering means Groq is never asked', [r.text, groq.length], ['gemini', 0])

  calls = script(DEAD)
  groq = groqScript([{ text: 'json please' }])
  await generate({ contents: [{ role: 'user', parts: [{ text: 'no shape word here' }] }], generationConfig: { responseMimeType: 'application/json' } }, quick)
  eq('asked for JSON, Groq is told so in words', groq.prompts[0], 'no shape word here\n\nAnswer with JSON only.')
  calls = script(DEAD)
  groq = groqScript([{ text: 'x' }])
  await generate({ contents: [{ role: 'user', parts: [{ text: 'Answer with ONLY a JSON array' }] }], generationConfig: { responseMimeType: 'application/json' } }, quick)
  eq('…and not told twice when the prompt already says it', groq.prompts[0], 'Answer with ONLY a JSON array')
  eq('…never with response_format, which would insist on an object', 'response_format' in (groq.bodies[0] as Record<string, unknown>), false)

  calls = script(DEAD)
  groq = groqScript([{ status: 404, body: '{"error":{"code":"model_not_found"}}' }, { models: [groqSecond] }, { text: 'second model' }])
  r = await generate('p', quick)
  eq('a retired model is skipped for the one behind it', [r.text, r.model], ['second model', `groq:${groqSecond}`])
  calls = script(DEAD)
  groq = groqScript([{ text: 'straight to the live one' }])
  r = await generate('p', quick)
  eq('…and never asked again', [r.model, groq.models], [`groq:${groqSecond}`, [groqSecond]])

  resetGroqState()
  calls = script(DEAD)
  groq = groqScript([{ status: 429, body: 'rate limited' }, { status: 429, body: 'rate limited' }, { status: 429, body: 'rate limited' }])
  let threw: GeminiUnavailableError | null = null
  try { await generate('p', quick) } catch (err) { threw = err as GeminiUnavailableError }
  eq('Groq refusing too still raises the Gemini answer', [threw instanceof GeminiUnavailableError, threw?.quotaReached, groq.length], [true, false, 3])

  calls = script(DEAD)
  groq = groqScript([{ text: 'unreachable' }])
  threw = null
  try { await generate({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/ogg', data: 'x' } }] }], generationConfig: {} }, quick) } catch (err) { threw = err as GeminiUnavailableError }
  eq('a voice note never goes to Groq', [threw instanceof GeminiUnavailableError, groq.length], [true, 0])

  calls = script([{ status: 503 }, { status: 503 }])
  groq = groqScript([{ text: 'unreachable' }])
  threw = null
  try { await generate('p', { ...quick, fallback: false }) } catch (err) { threw = err as GeminiUnavailableError }
  eq('fallback: false stays on the primary, Groq included', [calls, groq.length], [[primary, primary], 0])

  groq = groqScript([{ text: 'unreachable' }])   // sets the key; the point here is that it is gone
  delete process.env.GROQ_API_KEY
  resetGroqState()
  calls = script(DEAD)
  threw = null
  try { await generate('p', quick) } catch (err) { threw = err as GeminiUnavailableError }
  eq('no key: nothing changes', [threw?.quotaReached, groq.length], [false, 0])

  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed')
  process.exit(fails ? 1 : 0)
}

main()
