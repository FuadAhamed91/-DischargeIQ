import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { translateSummary } from '@/lib/ai/translation'
import { apiSuccess, apiError } from '@/types/api'
import type { LanguageCode } from '@/types/enums'
import type { ExtractionResult } from '@/lib/ai/extraction'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { summary_id, target_languages } = await request.json() as {
      summary_id: string
      target_languages: LanguageCode[]
    }

    if (!summary_id || !target_languages?.length) {
      return NextResponse.json(apiError('summary_id and target_languages are required'), { status: 400 })
    }

    const supabase = await createServiceClient()

    // Fetch summary + medications + follow-ups
    const { data: summary } = await supabase
      .from('discharge_summaries')
      .select('*, medications(*), follow_up_requirements(*)')
      .eq('id', summary_id)
      .single()

    if (!summary) {
      return NextResponse.json(apiError('Summary not found'), { status: 404 })
    }

    const extractionData: ExtractionResult = {
      medications: (summary.medications ?? []).map((m: { name: string; dosage: string; frequency: string; instructions: string | null; reminder_times: string[] }) => ({
        name: m.name,
        dosage: m.dosage,
        frequency: m.frequency,
        instructions: m.instructions ?? '',
        reminder_times: m.reminder_times ?? [],
      })),
      follow_up_requirements: (summary.follow_up_requirements ?? []).map((f: { specialty: string; deadline: string | null; instructions: string | null }) => ({
        specialty: f.specialty,
        deadline: f.deadline,
        instructions: f.instructions,
      })),
      emergency_symptoms: summary.emergency_symptoms as string[],
      lifestyle_instructions: summary.lifestyle_instructions as string[],
      restrictions: summary.restrictions as string[],
      activities: summary.activities as string[],
      source_language: summary.source_language,
    }

    const results: Record<string, boolean> = {}

    for (const lang of target_languages) {
      try {
        const translated = await translateSummary(
          extractionData,
          lang,
          summary.source_language as LanguageCode,
        )

        await supabase.from('discharge_summary_translations').upsert(
          {
            summary_id,
            language: lang,
            content: translated as never,
          },
          { onConflict: 'summary_id,language' },
        )

        results[lang] = true
      } catch (err) {
        console.error(`[AI Translate] Failed for ${lang}:`, err)
        results[lang] = false
      }
    }

    return NextResponse.json(apiSuccess({ results }))
  } catch (err) {
    console.error('[AI Translate]', err)
    return NextResponse.json(
      apiError('Translation failed', err instanceof Error ? err.message : 'Unknown error'),
      { status: 500 },
    )
  }
}
