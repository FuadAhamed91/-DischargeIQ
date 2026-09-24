/**
 * Groq — the provider asked when every Gemini model has refused.
 *
 * The free Gemini tier is the app's most common outage: a day of testing
 * exhausts gemini-2.5-flash's daily quota, the 3.x fallbacks answer 404 or
 * 503, and a nurse is told the letter cannot be read or the conversation
 * cannot be translated. Groq's free tier is generous and fast, and every
 * model call this app makes is text in, text out (the discharge PDF is turned
 * into text by unpdf first), so one more provider behind the chain removes
 * that whole class of failure.
 *
 * Set GROQ_API_KEY to switch it on; without it nothing changes. Models are
 * tried in order and can be replaced with GROQ_MODELS (comma-separated) when
 * Groq retires one — a model this key cannot use is skipped, and the names it
 * can use are logged once so the fix is obvious. The defaults are the chat
 * models the production key answered with on 2026-09-24; the first guess,
 * llama-3.3-70b-versatile, 404s ("does not exist or you do not have access").
 */

import type { GeminiContent } from './gemini'

const ENDPOINT = 'https://api.groq.com/openai/v1'

export const GROQ_MODELS: readonly string[] = (process.env.GROQ_MODELS ?? 'openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)

export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY?.trim())
}

export interface GroqResult {
  text: string
  /** Prefixed, so a log line says which provider answered: "groq:llama-3.3-70b-versatile". */
  model: string
  attempts: number
}

interface FlatPrompt {
  text: string
  json: boolean
}

/**
 * The single text turn Groq takes, from whatever shape the caller passed.
 * Null when the request carries something other than text (a voice note's
 * audio): that one stays with Gemini.
 */
export function flattenForGroq(content: GeminiContent): FlatPrompt | null {
  if (typeof content === 'string') return { text: content, json: false }

  if (Array.isArray(content)) {
    const texts: string[] = []
    for (const part of content) {
      if (typeof part === 'string') texts.push(part)
      else if (typeof part.text === 'string') texts.push(part.text)
      else return null
    }
    return { text: texts.join('\n'), json: false }
  }

  const texts: string[] = []
  for (const turn of content.contents ?? []) {
    for (const part of turn.parts ?? []) {
      if (typeof part.text !== 'string') return null
      texts.push(part.text)
    }
  }
  if (texts.length === 0) return null
  return { text: texts.join('\n'), json: content.generationConfig?.responseMimeType === 'application/json' }
}

/**
 * Asked for JSON, Groq is told so in words rather than with response_format:
 * that mode insists on a top-level object, and the transcript translation
 * wants an array. Every parser here reads the JSON out of the answer, so a
 * sentence around it costs nothing.
 */
function promptFor(flat: FlatPrompt): string {
  if (!flat.json || /\bjson\b/i.test(flat.text)) return flat.text
  return `${flat.text}\n\nAnswer with JSON only.`
}

/** Models this key cannot use, so a second call does not ask again. */
const unusable = new Set<string>()
let namesLogged = false

/** Forget what earlier calls learned (for the checks). */
export function resetGroqState(): void {
  unusable.clear()
  namesLogged = false
}

/** One line naming the models this key can actually use — logged once, after a model is refused. */
async function logUsableModels(key: string, label: string): Promise<void> {
  if (namesLogged) return
  namesLogged = true
  try {
    const res = await fetch(`${ENDPOINT}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5_000),
    })
    const json = (await res.json()) as { data?: Array<{ id?: string }> }
    const names = (json.data ?? []).map((m) => m.id).filter(Boolean)
    if (names.length > 0) console.warn(`[${label}] Groq models this key can use: ${names.join(', ')} — set GROQ_MODELS to choose`)
  } catch {
    // Only an aid to the log line; never worth failing the call for.
  }
}

export interface GroqOptions {
  /** Names the caller in logs, e.g. "translate-transcript". */
  label?: string
  /** How long one model may take before the next is asked. */
  timeoutMs?: number
}

/**
 * Asks each model in turn and returns the first answer. Throws when the key
 * is unset, the content is not plain text, or every model refused — the
 * caller (generate) is already on its last resort and reports its own error.
 */
export async function groqGenerate(content: GeminiContent, opts: GroqOptions = {}): Promise<GroqResult> {
  const key = process.env.GROQ_API_KEY?.trim()
  if (!key) throw new Error('GROQ_API_KEY is not set')

  const flat = flattenForGroq(content)
  if (!flat) throw new Error('Groq takes text only; this request carries other content')

  const label = opts.label ?? 'groq'
  const timeoutMs = opts.timeoutMs ?? 15_000
  const chain = GROQ_MODELS.filter((m) => !unusable.has(m))
  if (chain.length === 0) throw new Error(`no Groq model left to try (${GROQ_MODELS.join(', ')})`)

  let attempts = 0
  let lastError: unknown
  for (const model of chain) {
    attempts++
    try {
      const res = await fetch(`${ENDPOINT}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: promptFor(flat) }],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        // A name Groq has retired, or one this key cannot reach: never ask again.
        if ((res.status === 404 || res.status === 400) && /model|decommission|not.?found/i.test(body)) {
          unusable.add(model)
          await logUsableModels(key, label)
        }
        throw new Error(`[${res.status}] ${body.slice(0, 200) || res.statusText}`)
      }

      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const text = json.choices?.[0]?.message?.content?.trim() ?? ''
      if (!text) throw new Error('empty answer')

      console.info(`[${label}] answered by Groq ${model}`)
      return { text, model: `groq:${model}`, attempts }
    } catch (err) {
      lastError = err
      console.warn(`[${label}] Groq ${model} failed: ${err instanceof Error ? err.message.slice(0, 160) : String(err)}`)
    }
  }

  throw new Error(`every Groq model refused (${chain.join(', ')}): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}
