import { createHash } from 'node:crypto'
import { generate } from './gemini'
import type { GenerateOptions } from './gemini'
import { parseModelJson } from './json'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LanguageCode } from '@/types/enums'
import type { DischargeSummary, FollowUpRequirement, Medication } from '@/types/database'
import type { ExtractionResult } from './extraction'


const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: 'English',
  ar: 'Arabic',
  hi: 'Hindi',
  ta: 'Tamil',
  tl: 'Tagalog',
}

export interface TranslatedSummaryContent {
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

/** discharge_summary_translations.content: the translation, and the fingerprint of the text it was made from. */
export interface StoredSummaryTranslation extends TranslatedSummaryContent {
  source_hash: string
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The patient-facing text of a summary, as the translator is given it. The
 * same content always comes out the same here (follow-ups have no saved
 * order, so they are given one), which summarySourceHash relies on.
 */
function translatable(data: ExtractionResult): TranslatedSummaryContent {
  return {
    medications: data.medications.map((m) => ({
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
      instructions: m.instructions ?? '',
    })),
    follow_up_requirements: data.follow_up_requirements
      .map((f) => ({ specialty: f.specialty, instructions: f.instructions ?? null }))
      .sort((a, b) => byText(a.specialty, b.specialty) || byText(a.instructions ?? '', b.instructions ?? '')),
    emergency_symptoms: data.emergency_symptoms ?? [],
    lifestyle_instructions: data.lifestyle_instructions ?? [],
    restrictions: data.restrictions ?? [],
    activities: data.activities ?? [],
  }
}

/**
 * Fingerprint of the text a translation is made from, stored with it as
 * content.source_hash. A stored translation is only good for content with the
 * same fingerprint: once a nurse corrects a dose or a warning sign, the
 * translation of the letter as first read no longer matches and is not sent.
 */
export function summarySourceHash(data: ExtractionResult): string {
  const source = { source_language: data.source_language ?? 'en', ...translatable(data) }
  return createHash('sha256').update(JSON.stringify(source)).digest('hex')
}

/**
 * Translates the structured discharge summary fields into the target language.
 * Uses Gemini 1.5 Flash for speed and cost efficiency on translation tasks.
 * `opts` is for a caller that is waiting on it (a care plan being sent).
 */
export async function translateSummary(
  data: ExtractionResult,
  targetLanguage: LanguageCode,
  sourceLanguage: LanguageCode = 'en',
  opts: Pick<GenerateOptions, 'budgetMs' | 'noThinking'> = {},
): Promise<TranslatedSummaryContent> {
  const source = translatable(data)
  if (targetLanguage === sourceLanguage) return source

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
${JSON.stringify(source, null, 2)}

Return the translated JSON now:`

  // Translation needs no reasoning step: without it the care plan is ready in its language sooner.
  const { text } = await generate(
    { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } },
    { label: 'translate-summary', budgetMs: opts.budgetMs ?? 40_000, noThinking: opts.noThinking ?? true },
  )

  // Strip markdown code fences if present
  const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const parsed: unknown = parseModelJson(json)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('The summary translation is not a JSON object')
  return parsed as TranslatedSummaryContent
}

/** Upserts one language's translation (one row per summary and language). */
export async function storeSummaryTranslation(
  supabase: SupabaseClient,
  summaryId: string,
  language: LanguageCode,
  content: StoredSummaryTranslation,
): Promise<void> {
  const { error } = await supabase.from('discharge_summary_translations').upsert(
    { summary_id: summaryId, language, content: content as never },
    { onConflict: 'summary_id,language' },
  )
  if (error) throw error
}

/**
 * Translates an extracted summary into each target language and upserts the
 * results into discharge_summary_translations, each with the fingerprint of
 * the text it was made from. Failures are per-language and
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
  const source_hash = summarySourceHash(data)
  const results: Record<string, boolean> = {}

  for (const lang of targetLanguages) {
    try {
      const translated = await translateSummary(data, lang, sourceLanguage)
      await storeSummaryTranslation(supabase, summaryId, lang, { ...translated, source_hash })
      results[lang] = true
    } catch (err) {
      console.error(`[AI Translate] Failed for summary ${summaryId} → ${lang}:`, err)
      results[lang] = false
    }
  }

  return results
}

export type SavedSummary = Pick<DischargeSummary, 'source_language' | 'emergency_symptoms' | 'lifestyle_instructions' | 'restrictions' | 'activities'>

/**
 * A summary as it is saved now (row, medicines in their saved order,
 * follow-ups) in the shape the translator takes: what the nurse approved,
 * which may no longer be the letter as it was first read.
 */
export function savedSummaryContent(
  summary: SavedSummary,
  medications: Array<Pick<Medication, 'name' | 'dosage' | 'frequency' | 'instructions'> & { reminder_times?: string[] }>,
  followUps: Array<Pick<FollowUpRequirement, 'specialty' | 'deadline' | 'instructions'>>,
): ExtractionResult {
  return {
    source_language: summary.source_language ?? 'en',
    medications: medications.map((m) => ({
      name: m.name,
      dosage: m.dosage,
      frequency: m.frequency,
      instructions: m.instructions ?? '',
      reminder_times: m.reminder_times ?? [],
    })),
    follow_up_requirements: followUps.map((f) => ({ specialty: f.specialty, deadline: f.deadline, instructions: f.instructions })),
    emergency_symptoms: summary.emergency_symptoms ?? [],
    lifestyle_instructions: summary.lifestyle_instructions ?? [],
    restrictions: summary.restrictions ?? [],
    activities: summary.activities ?? [],
  }
}

/**
 * After a nurse saves the summary: deletes its stored translations that were
 * made from other text, so a corrected dose or warning sign cannot go out in
 * the old wording. A save that changes nothing the patient reads keeps them.
 * The care plan is translated afresh when it is sent. Needs the service
 * client (users have no DELETE policy on translations). Returns the
 * languages dropped.
 */
export async function dropStaleSummaryTranslations(supabase: SupabaseClient, summaryId: string): Promise<string[]> {
  const reads = await Promise.all([
    supabase.from('discharge_summaries').select('source_language, emergency_symptoms, lifestyle_instructions, restrictions, activities').eq('id', summaryId).maybeSingle(),
    supabase.from('medications').select('name, dosage, frequency, instructions, reminder_times').eq('summary_id', summaryId).order('sort_order'),
    supabase.from('follow_up_requirements').select('specialty, deadline, instructions').eq('summary_id', summaryId),
    supabase.from('discharge_summary_translations').select('id, language, content').eq('summary_id', summaryId),
  ])
  const failed = reads.find((r) => r.error)
  if (failed) throw failed.error
  const [{ data: summary }, { data: medications }, { data: followUps }, { data: stored }] = reads
  if (!summary) return []

  const hash = summarySourceHash(savedSummaryContent(summary as SavedSummary, medications ?? [], followUps ?? []))
  const stale = ((stored ?? []) as Array<{ id: string; language: string; content: { source_hash?: unknown } | null }>)
    .filter((t) => t.content?.source_hash !== hash)
  if (stale.length === 0) return []

  const { error } = await supabase.from('discharge_summary_translations').delete().in('id', stale.map((t) => t.id))
  if (error) throw error
  return stale.map((t) => t.language)
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

  // No thinking: a straight translation needs none, and the nurse is waiting to send.
  const { text: output } = await generate(prompt, { label: 'translate-nurse-message', budgetMs: 15_000, noThinking: true })
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
    const parsed: unknown = parseModelJson(text.slice(start, end + 1))
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
    { label: 'translate-transcript', budgetMs: 40_000, noThinking: true },
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
    { label: 'translate-text', budgetMs: 20_000, noThinking: true },
  )
  return translated
}
