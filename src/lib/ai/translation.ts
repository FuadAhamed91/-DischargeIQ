import { GoogleGenerativeAI } from '@google/generative-ai'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LanguageCode } from '@/types/enums'
import type { ExtractionResult } from './extraction'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

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

  const result = await model.generateContent(prompt)
  const text = result.response.text().trim()

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

/**
 * Translates a single text string for simple use cases.
 */
export async function translateText(
  text: string,
  targetLanguage: LanguageCode,
): Promise<string> {
  if (targetLanguage === 'en') return text

  const result = await model.generateContent(
    `Translate the following text to ${LANGUAGE_NAMES[targetLanguage]}. Return only the translated text, no explanation:\n\n${text}`,
  )
  return result.response.text().trim()
}
