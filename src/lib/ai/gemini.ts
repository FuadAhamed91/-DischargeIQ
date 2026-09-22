/**
 * The one place that talks to Gemini. Extraction, translation, triage and
 * patient chat all call generate(), which
 *   - retries transient failures (429 rate limit, 500/503/504 "high demand",
 *     dropped connections) with a short backoff,
 *   - moves to a fallback model when the primary stays unavailable, and
 *   - throws GeminiUnavailableError once every option is spent, so a route can
 *     answer "busy, try again in a minute" instead of "could not read".
 *
 * A single un-retried 503 from gemini-2.5-flash once made a perfectly good
 * discharge PDF look unreadable to the nurse.
 */

import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
  type GenerateContentRequest,
  type GenerativeModel,
  type Part,
} from '@google/generative-ai'

export const PRIMARY_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash'

/** Tried in order after the primary. Override with GEMINI_FALLBACK_MODELS (comma-separated). */
export const FALLBACK_MODELS: readonly string[] = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-2.5-flash-lite,gemini-2.5-pro')
  .split(',')
  .map((m) => m.trim())
  .filter((m) => m && m !== PRIMARY_MODEL)

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

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
}

export interface GenerateResult {
  text: string
  /** The model that actually answered — not always the primary. */
  model: string
  attempts: number
}

/** Every model was busy or unreachable. Callers can surface this as HTTP 503. */
export class GeminiUnavailableError extends Error {
  readonly status = 503
  constructor(message: string, readonly cause?: unknown) {
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

type Failure = 'retry' | 'next_model' | 'fatal'

/** Decide what a failed call means: wait and retry, try the next model, or give up. */
function classify(err: unknown): Failure {
  if (err instanceof GoogleGenerativeAIFetchError) {
    const status = err.status ?? 0
    if (RETRYABLE_STATUS.has(status)) return 'retry'
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

  for (const model of chain) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      attempts++
      try {
        const result = await modelFor(model).generateContent(content)
        const text = result.response.text().trim()
        if (attempts > 1 || model !== PRIMARY_MODEL) {
          console.info(`[${label}] answered by ${model} on attempt ${attempts}`)
        }
        return { text, model, attempts }
      } catch (err) {
        lastError = err
        const what = classify(err)
        const status = err instanceof GoogleGenerativeAIFetchError ? err.status : undefined
        console.warn(`[${label}] ${model} attempt ${attempt} failed (${status ?? 'no status'}): ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`)

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
  throw new GeminiUnavailableError(
    `The AI service is busy or unreachable (${chain.join(', ')} after ${attempts} attempt${attempts === 1 ? '' : 's'}). ${detail}`,
    lastError,
  )
}
