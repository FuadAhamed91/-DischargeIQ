import { NextResponse } from 'next/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { extractTextFromPdf, extractDischargeData, hasMeaningfulContent } from '@/lib/ai/extraction'
import type { ExtractionResult } from '@/lib/ai/extraction'
import { GeminiUnavailableError } from '@/lib/ai/gemini'
import { INTAKE_ROLES, validatePdfUpload } from '@/lib/intake/validate'
import { recogniseSampleLetter, sampleExtraction } from '@/lib/intake/sample-letters'
import type { SampleLetterMatch } from '@/lib/intake/sample-letters'

export const maxDuration = 60

/**
 * How long the AI reader gets on a sample letter before its built-in reading
 * is used instead: a demo should not sit on "Reading…" while Google is busy.
 */
const SAMPLE_LETTER_BUDGET_MS = 20_000

/**
 * Document-first intake, step 1: read the discharge PDF and return everything
 * the form can be pre-filled with. Nothing is written yet — the nurse confirms
 * (and types the phone number) before /api/v1/intake/commit creates the
 * patient, episode, document and draft summary.
 *
 * `read_by` says who read it: "ai", or "sample" when the AI reader failed on
 * one of the sample letters (lib/intake/sample-letters.ts) and its built-in
 * reading was used, so a demo never stops at "Couldn't read that letter".
 */
export async function POST(request: Request) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  if (!INTAKE_ROLES.has(auth.profile.role)) {
    return NextResponse.json(apiError('Forbidden'), { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  const invalid = validatePdfUpload(file)
  if (invalid) return NextResponse.json(apiError(invalid), { status: 422 })

  let wordCount = 0
  const read = (extraction: ExtractionResult, readBy: 'ai' | 'sample') =>
    NextResponse.json(apiSuccess({ extraction, word_count: wordCount, read_by: readBy }))
  const readSample = (match: SampleLetterMatch, reason: unknown) => {
    console.warn(`[Intake extract] AI reader unavailable for sample letter ${match.letter.id}, using its built-in reading:`, reason instanceof Error ? reason.message : reason)
    return read(sampleExtraction(match.letter, match.discharge), 'sample')
  }

  let sample: SampleLetterMatch | null = null
  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer())
    const pdfText = await extractTextFromPdf(buffer)
    sample = recogniseSampleLetter(pdfText)

    wordCount = pdfText.split(/\s+/).filter(Boolean).length
    if (wordCount < 30) {
      return NextResponse.json(
        apiError('This PDF has little or no readable text — it may be a scan. Please upload the text version of the discharge summary.'),
        { status: 422 },
      )
    }

    const extraction = await extractDischargeData(pdfText, sample ? { budgetMs: SAMPLE_LETTER_BUDGET_MS } : {})

    if (!hasMeaningfulContent(extraction)) {
      if (sample) return readSample(sample, 'the reading had no medicines or instructions')
      return NextResponse.json(
        apiError('No discharge information could be found in this document. Please check it is the discharge summary.'),
        { status: 422 },
      )
    }

    return read(extraction, 'ai')
  } catch (err) {
    if (sample) return readSample(sample, err)
    console.error('[Intake extract]', err)
    if (err instanceof GeminiUnavailableError) {
      // Google's side, not the document. Nothing was saved; the same file can be tried again.
      return NextResponse.json(
        apiError(
          err.quotaReached
            ? 'The document reader has reached its usage limit with Google’s AI for now, so the letter could not be read. Nothing was saved. Try again later, or drag in one of the demo letters.'
            : 'The document reader is busy right now (Google’s AI reported high demand). Nothing was saved. Try again in a minute.',
          err.message,
        ),
        { status: 503, headers: { 'Retry-After': '60' } },
      )
    }
    return NextResponse.json(
      apiError('Could not read the document', err instanceof Error ? err.message : 'Unknown error'),
      { status: 500 },
    )
  }
}
