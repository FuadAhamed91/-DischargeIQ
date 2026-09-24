/**
 * The one place that talks to Gemini. Extraction, translation, triage and
 * patient chat all call generate(), which
 *   - retries transient failures (500/503/504 "high demand", dropped
 *     connections) with a short backoff,
 *   - moves to the next model at once on 429 (this model's quota is spent;
 *     each model has its own) and on 404 (a model this key cannot use),
 *   - moves to a fallback model when the primary stays unavailable, and
 *   - throws GeminiUnavailableError once every option is spent, so a route can
 *     answer "busy" or "usage limit reached" instead of "could not read".
 *
 * A single un-retried 503 from gemini-2.5-flash once made a perfectly good
 * discharge PDF look unreadable to the nurse. On 2026-09-24 the key's
 * gemini-2.5-flash quota ran out (429) while both old fallbacks answered 404
 * ("no longer available to new users"), so nothing could read a letter.
 */

import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  type GenerateContentRequest,
  type GenerationConfig,
  type GenerativeModel,
  type Part,
} from '@google/generative-ai'

export const PRIMARY_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash'

/**
 * Tried in order after the primary. Override with GEMINI_FALLBACK_MODELS (comma-separated).
 * Google's named successors to the 2.5 models, which new keys cannot use
 * (ai.google.dev/gemini-api/docs/deprecations): 3.6 Flash for 2.5 Flash,
 * 3.1 Flash-Lite for 2.5 Flash-Lite, 3.1 Pro (preview) for 2.5 Pro.
 */
export const FALLBACK_MODELS: readonly string[] = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.6-flash,gemini-3.1-flash-lite,gemini-3.1-pro-preview')
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m && m !== PRIMARY_MODEL)

const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504])

export type GeminiContent = GenerateContentRequest | string | Array<string | Part>

export interface GenerateOptions {
  /** Attempts on each model before moving to the next (default 2). */
  attemptsPerModel?: number
  /** Wall-clock budget for all attempts together (default 30 s). Keep it under the route's maxDuration. */
  budgetMs?: number
  /** Set false to stay on the primary model (default true). */
  fallback?: boolean
  /** Names the caller in logs, e.g. "extraction". */
  label?: string
  /**
   * Skip the model's thinking step where the model allows it (the 2.5 Flash
   * family; other models are asked as usual, since a thinking budget of 0 is
   * a 400 for them). For work that needs no reasoning, such as translation,
   * thinking is most of the wait.
   */
  noThinking?: boolean
}

export interface GenerateResult {
  text: string
  /** The model that actually answered — not always the primary. */
  model: string
  attempts: number
}

/**
 * Every model was busy, out of quota or unreachable. Callers can surface this
 * as HTTP 503. `quotaReached` is true when the models that could answer all
 * said 429: waiting a minute will not help, the usage limit has to reset (or
 * the key needs a paid plan).
 */
export class GeminiUnavailableError extends Error {
  readonly status = 503
  constructor(message: string, readonly cause?: unknown, readonly quotaReached = false) {
    super(message)
    this.name = 'GeminiUnavailableError'
  }
}

let client: GoogleGenerativeAI | null = null
const models = new Map<string, GenerativeModel>()

function modelFor(name: string): GenerativeModel {
  if (!client) {
    const key = process.env.GEMINI_API_KEY
    if (!key) throw new Error('GEMINI_API_KEY is not set')
    client = new GoogleGenerativeAI(key)
  }
  let m = models.get(name)
  if (!m) {
    m = client.getGenerativeModel({ model: name })
    models.set(name, m)
  }
  return m
}

/** The REST API's thinkingConfig: not in this SDK's types, but passed through to the API as sent. */
type GenerationConfigWithThinking = GenerationConfig & { thinkingConfig?: { thinkingBudget?: number } }

function asRequest(content: GeminiContent): GenerateContentRequest {
  if (typeof content === 'string') return { contents: [{ role: 'user', parts: [{ text: content }] }] }
  if (Array.isArray(content)) return { contents: [{ role: 'user', parts: content.map((p) => (typeof p === 'string' ? { text: p } : p)) }] }
  return content
}

/**
 * What to send to this model. With noThinking, the 2.5 Flash models get a
 * thinking budget of 0; any other model gets the request unchanged (2.5 Pro
 * answers a budget of 0 with a 400, which would end the fallback chain).
 */
function requestFor(model: string, content: GeminiContent, opts: GenerateOptions): GeminiContent {
  if (!opts.noThinking || !/^gemini-2\.5-flash/.test(model)) return content
  const request = asRequest(content)
  const generationConfig: GenerationConfigWithThinking = { ...request.generationConfig, thinkingConfig: { thinkingBudget: 0 } }
  return { ...request, generationConfig }
}

type Failure = 'retry' | 'next_model' | 'fatal'

/** Decide what a failed call means: wait and retry, try the next model, or give up. */
function classify(err: unknown): Failure {
  if (err instanceof GoogleGenerativeAIFetchError) {
    const status = err.status ?? 0
    if (RETRYABLE_STATUS.has(status)) return 'retry'
    if (status === 429) return 'next_model' // this model's quota is spent; the next has its own
    if (status === 404) return 'next_model' // model name unknown to this key/region
    if (status === 0 && /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket|network/i.test(err.message)) return 'retry'
    return 'fatal' // 400 bad request, 401/403 key problems: no other model will help
  }
  if (err instanceof Error && /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|network/i.test(err.message)) return 'retry'
  return 'fatal' // safety blocks, empty candidates, our own bugs
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 800 ms, 1.6 s, 3.2 s … plus jitter so concurrent requests don't retry in lockstep. */
const backoff = (attempt: number) => 800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 300)

export async function generate(content: GeminiContent, opts: GenerateOptions = {}): Promise<GenerateResult> {
  const attemptsPerModel = Math.max(1, opts.attemptsPerModel ?? 2)
  const budgetMs = opts.budgetMs ?? 30_000
  const label = opts.label ?? 'gemini'
  const chain = opts.fallback === false ? [PRIMARY_MODEL] : [PRIMARY_MODEL, ...FALLBACK_MODELS]

  const startedAt = Date.now()
  const remaining = () => budgetMs - (Date.now() - startedAt)

  let attempts = 0
  let lastError: unknown
  // What the models said, to tell "usage limit reached" from "busy".
  let quotaRefusals = 0
  let otherFailures = 0

  for (const model of chain) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      attempts++
      try {
        const result = await modelFor(model).generateContent(requestFor(model, content, opts))
        const text = result.response.text().trim()
        if (attempts > 1 || model !== PRIMARY_MODEL) {
          console.info(`[${label}] answered by ${model} on attempt ${attempts}`)
        }
        return { text, model, attempts }
      } catch (err) {
        lastError = err
        const what = classify(err)
        const status = err instanceof GoogleGenerativeAIFetchError ? err.status : undefined
        if (status === 429) quotaRefusals++
        else if (status !== 404) otherFailures++
        // A 429 says which quota ran out (per minute or per day) past the first 160 characters: keep it.
        console.warn(`[${label}] ${model} attempt ${attempt} failed (${status ?? 'no status'}): ${err instanceof Error ? err.message.slice(0, status === 429 ? 1_000 : 160) : String(err)}`)

        if (what === 'fatal') throw err
        if (what === 'next_model') break

        const delay = backoff(attempt)
        const lastAttemptOnThisModel = attempt === attemptsPerModel
        // Retrying the same model when there is no time left would only burn the
        // budget; moving on to the next model is still worth one immediate try.
        if (!lastAttemptOnThisModel) {
          if (remaining() < delay + 2_000) break
          await sleep(delay)
        }
      }
    }
    if (remaining() <= 0) break
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  const quotaReached = quotaRefusals > 0 && otherFailures === 0
  throw new GeminiUnavailableError(
    `${quotaReached ? 'The AI usage limit is reached' : 'The AI service is busy or unreachable'} (${chain.join(', ')} after ${attempts} attempt${attempts === 1 ? '' : 's'}). ${detail}`,
    lastError,
    quotaReached,
  )
}
