/**
 * The one place that talks to a model. Extraction, translation, triage and
 * patient chat all call generate(), which
 *   - retries a transient failure of the primary (500/503/504 "high demand",
 *     dropped connections) once with a short backoff; a fallback gets one try,
 *   - moves to the next model at once on 429 (this model's quota is spent;
 *     each model has its own) and on 404 (a model this key cannot use), and
 *     lets a 429'd model rest at the back of the queue for a while,
 *   - moves to a fallback model when the primary stays unavailable,
 *   - asks Groq once Gemini has nothing left, if GROQ_API_KEY is set and the
 *     request is plain text (lib/ai/groq.ts), and
 *   - throws GeminiUnavailableError once every option is spent, so a route can
 *     answer "busy" or "usage limit reached" instead of "could not read".
 *
 * A single un-retried 503 from gemini-2.5-flash once made a perfectly good
 * discharge PDF look unreadable to the nurse. On 2026-09-24 the key's
 * gemini-2.5-flash quota ran out (429) while both old fallbacks answered 404
 * ("no longer available to new users"), so nothing could read a letter — and
 * later that day a nurse was told the conversation could not be translated.
 * A second provider is the answer to a free tier running dry, not more retries.
 */

import { groqConfigured, groqGenerate } from './groq'
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

/**
 * What Groq is given once Gemini is spent: at least this long even when the
 * budget has run out (it usually answers in under a second), and never more
 * than this, so a route stays inside its maxDuration.
 */
const GROQ_LEAST_MS = 8_000
const GROQ_MOST_MS = 20_000

export type GeminiContent = GenerateContentRequest | string | Array<string | Part>

export interface GenerateOptions {
  /** Attempts on the primary model before moving on (default 2). Each fallback gets one: the next model is quicker than a retry. */
  attemptsPerModel?: number
  /** Wall-clock budget for all attempts together (default 30 s). Keep it under the route's maxDuration. */
  budgetMs?: number
  /** Set false to stay on the primary model (default true). */
  fallback?: boolean
  /** Names the caller in logs, e.g. "extraction". */
  label?: string
  /**
   * Ask for the least thinking the model allows (leastThinking: off on 2.5
   * Flash, "minimal" or "low" on 3.x). For work that needs no reasoning, such
   * as reading a letter into fields, translating, or following an explicit
   * rubric, thinking is most of the wait.
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
export interface ThinkingConfig {
  thinkingBudget?: number
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high'
}
type GenerationConfigWithThinking = GenerationConfig & { thinkingConfig?: ThinkingConfig }

function asRequest(content: GeminiContent): GenerateContentRequest {
  if (typeof content === 'string') return { contents: [{ role: 'user', parts: [{ text: content }] }] }
  if (Array.isArray(content)) return { contents: [{ role: 'user', parts: content.map((p) => (typeof p === 'string' ? { text: p } : p)) }] }
  return content
}

/**
 * The least thinking this model can be asked for (ai.google.dev/gemini-api/docs/thinking).
 * 2.5 Flash and Flash-Lite turn it off with a budget of 0. The 3.x models always
 * think a little: "minimal" on 3 Flash, 3.6 Flash and the Flash-Lites, "low" on
 * the rest. Anything else (2.5 Pro answers a budget of 0 with a 400) is asked as usual.
 */
export function leastThinking(model: string): ThinkingConfig | null {
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 }
  if (/^gemini-3[\d.]*-flash-lite/.test(model) || /^gemini-3(\.6)?-flash/.test(model)) return { thinkingLevel: 'minimal' }
  if (/^gemini-3/.test(model)) return { thinkingLevel: 'low' }
  return null
}

/** Models that turned a thinking setting down with a 400: from then on (in this server instance) they are asked without one. */
const plainOnly = new Set<string>()

/** What to send to this model: with noThinking, the request plus the least thinking it takes. */
function requestFor(model: string, content: GeminiContent, opts: GenerateOptions): GeminiContent {
  const thinking = opts.noThinking && !plainOnly.has(model) ? leastThinking(model) : null
  if (!thinking) return content
  const request = asRequest(content)
  const generationConfig: GenerationConfigWithThinking = { ...request.generationConfig, thinkingConfig: thinking }
  return { ...request, generationConfig }
}

/**
 * Models whose quota ran out (429), and until when they rest. A resting model is
 * asked last instead of first, so every call does not open with a refusal (per
 * server instance; a warm instance serves many calls).
 */
const restingUntil = new Map<string, number>()

/** How long a 429'd model rests: half an hour for a daily limit, its RetryInfo delay for a per-minute one, else a minute. */
function restFor(err: GoogleGenerativeAIFetchError): number {
  const details = JSON.stringify(err.errorDetails ?? [])
  if (/PerDay/i.test(details)) return 30 * 60_000
  const delay = details.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/)
  if (delay) return Math.min(Number(delay[1]) * 1_000, 5 * 60_000)
  return 60_000
}

/** For the log: which quota a 429 says ran out, e.g. GenerateRequestsPerDayPerProjectPerModel-FreeTier. */
function quotaName(err: GoogleGenerativeAIFetchError): string | null {
  return JSON.stringify(err.errorDetails ?? []).match(/"quotaId":"([^"]+)"/)?.[1] ?? null
}

/** Forget resting models and thinking refusals (for the checks). */
export function resetModelState() {
  restingUntil.clear()
  plainOnly.clear()
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
  const startedAt = Date.now()
  const remaining = () => budgetMs - (Date.now() - startedAt)

  // Models resting after a 429 go to the back: still tried when nothing else answers.
  const all = opts.fallback === false ? [PRIMARY_MODEL] : [PRIMARY_MODEL, ...FALLBACK_MODELS]
  const resting = (m: string) => (restingUntil.get(m) ?? 0) > startedAt
  const chain = [...all.filter((m) => !resting(m)), ...all.filter(resting)]

  let attempts = 0
  let lastError: unknown
  // What the models said, to tell "usage limit reached" from "busy".
  let quotaRefusals = 0
  let otherFailures = 0
  // The model being asked again without its thinking setting after a 400.
  let plainTrial: string | null = null

  for (const model of chain) {
    // The primary is worth a second try after a blip; a fallback is not, the next model is quicker.
    const tries = model === PRIMARY_MODEL ? attemptsPerModel : 1
    let attempt = 0
    while (attempt < tries) {
      attempt++
      attempts++
      const request = requestFor(model, content, opts)
      try {
        const result = await modelFor(model).generateContent(request)
        const text = result.response.text().trim()
        if (attempts > 1 || model !== PRIMARY_MODEL) {
          console.info(`[${label}] answered by ${model} on attempt ${attempts}`)
        }
        return { text, model, attempts }
      } catch (err) {
        lastError = err
        const fetchError = err instanceof GoogleGenerativeAIFetchError ? err : null
        const status = fetchError?.status

        // A thinking setting this model does not take comes back as a 400:
        // ask once more without it rather than end the chain. The setting stays
        // off for this model only if the plain request then works.
        if (status === 400 && request !== content && !plainOnly.has(model)) {
          plainOnly.add(model)
          plainTrial = model
          console.warn(`[${label}] ${model} turned down the thinking setting (400); asking again without it`)
          attempt--
          continue
        }
        if (plainTrial === model) {
          plainOnly.delete(model) // failed without it too: the setting was not the problem
          plainTrial = null
        }

        const what = classify(err)
        if (status === 429 && fetchError) {
          quotaRefusals++
          restingUntil.set(model, Date.now() + restFor(fetchError))
        } else if (status !== 404) {
          otherFailures++
        }
        // A 429 says which quota ran out (per minute or per day) past the first 160 characters: keep it.
        const quota = status === 429 && fetchError ? quotaName(fetchError) : null
        console.warn(`[${label}] ${model} attempt ${attempt} failed (${status ?? 'no status'})${quota ? ` [${quota}]` : ''}: ${err instanceof Error ? err.message.slice(0, status === 429 ? 1_000 : 160) : String(err)}`)

        if (what === 'fatal') throw err
        if (what === 'next_model') break

        // Retrying the same model when there is no time left would only burn the
        // budget; moving on to the next model is still worth one immediate try.
        if (attempt < tries) {
          const delay = backoff(attempt)
          if (remaining() < delay + 2_000) break
          await sleep(delay)
        }
      }
    }
    if (remaining() <= 0) break
  }

  // Gemini has nothing left. Groq is asked whatever the reason — quota, an
  // overloaded model, a name this key cannot use — and gets its own slice of
  // time: the budget is spent, and the alternative is certainly failing.
  if (opts.fallback !== false && groqConfigured()) {
    try {
      const answer = await groqGenerate(content, {
        label,
        timeoutMs: Math.min(Math.max(remaining(), GROQ_LEAST_MS), GROQ_MOST_MS),
      })
      return { text: answer.text, model: answer.model, attempts: attempts + answer.attempts }
    } catch (err) {
      console.warn(`[${label}] Groq could not answer either: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`)
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  const quotaReached = quotaRefusals > 0 && otherFailures === 0
  throw new GeminiUnavailableError(
    `${quotaReached ? 'The AI usage limit is reached' : 'The AI service is busy or unreachable'} (${chain.join(', ')} after ${attempts} attempt${attempts === 1 ? '' : 's'}). ${detail}`,
    lastError,
    quotaReached,
  )
}
