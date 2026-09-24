import { NextResponse } from 'next/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { extractTextFromPdf, extractDischargeData, hasMeaningfulContent } from '@/lib/ai/extraction'
import { GeminiUnavailableError } from '@/lib/ai/gemini'
import { INTAKE_ROLES, validatePdfUpload } from '@/lib/intake/validate'

export const maxDuration = 60

/**
 * Document-first intake, step 1: read the discharge PDF and return everything
 * the form can be pre-filled with. Nothing is written yet — the nurse confirms
 * (and types the phone number) before /api/v1/intake/commit creates the
 * patient, episode, document and draft summary.
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

  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer())
    const pdfText = await extractTextFromPdf(buffer)

    const wordCount = pdfText.split(/\s+/).filter(Boolean).length
    if (wordCount < 30) {
      return NextResponse.json(
        apiError('This PDF has little or no readable text — it may be a scan. Please upload the text version of the discharge summary.'),
        { status: 422 },
      )
    }

    const extraction = await extractDischargeData(pdfText)

    if (!hasMeaningfulContent(extraction)) {
      return NextResponse.json(
        apiError('No discharge information could be found in this document. Please check it is the discharge summary.'),
        { status: 422 },
      )
    }

    return NextResponse.json(apiSuccess({ extraction, word_count: wordCount }))
  } catch (err) {
    console.error('[Intake extract]', err)
    if (err instanceof GeminiUnavailableError) {
      // Google's side, not the document. Nothing was saved; the same file can be tried again.
      return NextResponse.json(
        apiError(
          err.quotaReached
            ? 'The document reader has reached its usage limit with Google’s AI for now, so the letter could not be read. Nothing was saved. Try again later, or enter the details by hand.'
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
