import { generate } from './gemini'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LanguageCode } from '@/types/enums'
import type { ExtractionResult } from './extraction'


const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English',
  ar: 'Arabic',
  hi: 'Hindi',
  ta: 'Tamil',
  tl: 'Tagalog',
}

interface TranslatedSummaryContent {
  medications: Array<{
    name: string
    dosage: string
    frequency: string
    instructions: string
  }>
  follow_up_requirements: Array<{
    specialty: string
    instructions: string | null
  }>
  emergency_symptoms: string[]
  lifestyle_instructions: string[]
  restrictions: string[]
  activities: string[]
}

/**
 * Translates the structured discharge summary fields into the target language.
 * Uses Gemini 1.5 Flash for speed and cost efficiency on translation tasks.
 */
export async function translateSummary(
  data: ExtractionResult,
  targetLanguage: LanguageCode,
  sourceLanguage: LanguageCode = 'en',
): Promise<TranslatedSummaryContent> {
  if (targetLanguage === sourceLanguage) {
    return {
      medications: data.medications.map((m) => ({
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        instructions: m.instructions,
      })),
      follow_up_requirements: data.follow_up_requirements.map((f) => ({
        specialty: f.specialty,
        instructions: f.instructions,
      })),
      emergency_symptoms: data.emergency_symptoms,
      lifestyle_instructions: data.lifestyle_instructions,
      restrictions: data.restrictions,
      activities: data.activities,
    }
  }

  const targetLangName = LANGUAGE_NAMES[targetLanguage]

  const prompt = `
You are a medical translator. Translate the following structured discharge summary data from ${LANGUAGE_NAMES[sourceLanguage]} to ${targetLangName}.

Rules:
- Translate ALL text fields.
- Keep medication names in their international non-proprietary name (INN) form — do NOT translate drug names.
- Keep specialty names recognizable (e.g. "Cardiology" → appropriate local term).
- Use simple, clear language appropriate for patients.
- Return ONLY valid JSON with the same structure as the input. No markdown, no explanation.

Input JSON:
${JSON.stringify(
  {
    medications: data.medications.map((m) => ({
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
      instructions: m.instructions,
    })),
    follow_up_requirements: data.follow_up_requirements.map((f) => ({
      specialty: f.specialty,
      instructions: f.instructions,
    })),
    emergency_symptoms: data.emergency_symptoms,
    lifestyle_instructions: data.lifestyle_instructions,
    restrictions: data.restrictions,
    activities: data.activities,
  },
  null,
  2,
)}

Return the translated JSON now:`

  const { text } = await generate(prompt, { label: 'translate-summary', budgetMs: 40_000 })

  // Strip markdown code fences if present
  const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(json) as TranslatedSummaryContent
}

/**
 * Translates an extracted summary into each target language and upserts the
 * results into discharge_summary_translations. Failures are per-language and
 * logged, never thrown — a failed translation must not fail the extraction.
 * Runs in-process (e.g. inside `after()`), not via a self-HTTP call, so it is
 * not subject to the auth proxy.
 */
export async function translateAndStoreSummary(
  supabase: SupabaseClient,
  summaryId: string,
  data: ExtractionResult,
  targetLanguages: LanguageCode[],
): Promise<Record<string, boolean>> {
  const sourceLanguage = (data.source_language as LanguageCode) ?? 'en'
  const results: Record<string, boolean> = {}

  for (const lang of targetLanguages) {
    try {
      const translated = await translateSummary(data, lang, sourceLanguage)

      const { error } = await supabase.from('discharge_summary_translations').upsert(
        { summary_id: summaryId, language: lang, content: translated as never },
        { onConflict: 'summary_id,language' },
      )
      if (error) throw error

      results[lang] = true
    } catch (err) {
      console.error(`[AI Translate] Failed for summary ${summaryId} → ${lang}:`, err)
      results[lang] = false
    }
  }

  return results
}

// ------------------------------------
// Nurse chat (episode page → Conversation tab)
// ------------------------------------

/** Named where the model might otherwise answer in Latin letters. */
const SCRIPT: Partial<Record<LanguageCode, string>> = {
  ar: 'Arabic script',
  hi: 'Devanagari script',
  ta: 'Tamil script',
}

/** Models sometimes wrap a bare answer in a code fence, or in quotation marks the input did not have. */
function unwrap(output: string, input: string): string {
  let text = output.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  if (/^["“][\s\S]*["”]$/.test(text) && !/^["“]/.test(input.trim())) text = text.slice(1, -1).trim()
  return text
}

/**
 * A nurse's chat message in the patient's language. The patient reads only
 * this text, so the meaning has to survive exactly: nothing added, softened
 * or dropped, and medicine names, doses, numbers, dates and times as written.
 * A message already in the target language comes back as it is. Throws when
 * the model is unavailable or answers with nothing — the caller must not then
 * send the untranslated text unless the nurse says so.
 */
export async function translateNurseMessage(text: string, targetLanguage: LanguageCode): Promise<string> {
  const language = LANGUAGE_NAMES[targetLanguage]
  const script = SCRIPT[targetLanguage]
  const prompt = `You translate the messages a hospital nurse writes to a patient on WhatsApp after the patient has gone home.

Translate the message below into ${language}.

Rules:
- Keep the meaning exactly. Do not add, remove, soften or explain anything, and do not add a greeting or a sign-off.
- Keep medicine names, doses, numbers, dates, times and phone numbers exactly as written.
- Write simple, warm, everyday ${language} that an older patient understands${script ? `, in ${script}` : ''}, and address the patient respectfully.
- Keep emoji, line breaks and WhatsApp formatting (*bold*, _italic_).
- If the message is already in ${language}, return it unchanged.

Return only the translated message: no quotation marks, notes or explanations.

Message:
"""
${text}
"""`

  const { text: output } = await generate(prompt, { label: 'translate-nurse-message', budgetMs: 15_000 })
  const translated = unwrap(output, text)
  if (!translated) throw new Error('The translation came back empty')
  return translated
}

export interface MessageToTranslate {
  id: string
  text: string
}

// Small batches run side by side, and one long care plan does not hold up the rest.
const BATCH_MESSAGES = 20
const BATCH_CHARS = 6_000

function batches(messages: MessageToTranslate[]): MessageToTranslate[][] {
  const out: MessageToTranslate[][] = []
  let current: MessageToTranslate[] = []
  let chars = 0
  for (const m of messages) {
    if (current.length > 0 && (current.length >= BATCH_MESSAGES || chars + m.text.length > BATCH_CHARS)) {
      out.push(current)
      current = []
      chars = 0
    }
    current.push(m)
    chars += m.text.length
  }
  if (current.length > 0) out.push(current)
  return out
}

function parseJsonArray(text: string): unknown[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end < start) return []
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function translateBatchToEnglish(messages: MessageToTranslate[]): Promise<Record<string, string>> {
  const prompt = `You translate a WhatsApp conversation between a hospital's after-discharge service and a patient into English, so that a nurse can read it.

Rules:
- Translate faithfully. Keep the meaning, tone and any uncertainty exactly; do not add, remove, correct or interpret anything. A vaguely described symptom stays vague.
- Keep medicine names, doses, numbers, dates and times exactly as written.
- Keep emoji, line breaks and WhatsApp formatting (*bold*, _italic_).
- Arabic, Hindi, Tamil or Tagalog written in Latin letters is translated too.
- A message that is already in English comes back unchanged.

The messages are a JSON array of {"id", "text"} objects. Answer with ONLY a JSON array holding one {"id", "en"} object per message, with the same ids.

${JSON.stringify(messages)}`

  const { text } = await generate(
    { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } },
    { label: 'translate-transcript', budgetMs: 40_000 },
  )

  const wanted = new Set(messages.map((m) => m.id))
  const out: Record<string, string> = {}
  for (const row of parseJsonArray(text)) {
    if (!row || typeof row !== 'object') continue
    const { id, en } = row as { id?: unknown; en?: unknown }
    if (typeof id === 'string' && wanted.has(id) && typeof en === 'string' && en.trim()) out[id] = en.trim()
  }
  return out
}

/**
 * English for a nurse who does not read the patient's language ("Show
 * English" on the Conversation tab). Faithful rather than polished. A message
 * the model leaves out, or one in a batch that failed, simply comes back
 * without a translation; this throws only when nothing could be translated.
 */
export async function translateMessagesToEnglish(messages: MessageToTranslate[]): Promise<Record<string, string>> {
  if (messages.length === 0) return {}
  const results = await Promise.allSettled(batches(messages).map(translateBatchToEnglish))
  const out: Record<string, string> = {}
  let failure: unknown = null
  for (const r of results) {
    if (r.status === 'fulfilled') Object.assign(out, r.value)
    else failure ??= r.reason
  }
  if (failure && Object.keys(out).length === 0) throw failure
  return out
}

/**
 * Translates a single text string for simple use cases.
 */
export async function translateText(
  text: string,
  targetLanguage: LanguageCode,
): Promise<string> {
  if (targetLanguage === 'en') return text

  const { text: translated } = await generate(
    `Translate the following text to ${LANGUAGE_NAMES[targetLanguage]}. Return only the translated text, no explanation:\n\n${text}`,
    { label: 'translate-text', budgetMs: 20_000 },
  )
  return translated
}
