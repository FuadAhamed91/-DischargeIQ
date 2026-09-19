import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { extractTextFromPdf, extractDischargeData, hasMeaningfulContent } from '@/lib/ai/extraction'
import { persistExtraction } from '@/lib/intake/persist-extraction'

export const maxDuration = 60

/**
 * Re-runs extraction for a document already attached to an episode (the
 * document-first intake flow extracts before the episode exists — see
 * /api/v1/intake). Replaces the episode's draft summary.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const { id: episodeId } = await params

  if (!['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'].includes(profile.role)) {
    return NextResponse.json(apiError('Forbidden'), { status: 403 })
  }

  const { document_id } = await request.json()

  if (!document_id) {
    return NextResponse.json(apiError('document_id is required'), { status: 400 })
  }

  const supabase = await createClient()
  const serviceClient = await createServiceClient()

  // Verify document belongs to this episode
  const { data: doc } = await supabase
    .from('discharge_documents')
    .select('id, extraction_status, storage_path')
    .eq('id', document_id)
    .eq('episode_id', episodeId)
    .single()

  if (!doc) {
    return NextResponse.json(apiError('Document not found'), { status: 404 })
  }

  if (doc.extraction_status === 'processing') {
    return NextResponse.json(apiError('Extraction already in progress'), { status: 409 })
  }

  const markFailed = () =>
    serviceClient.from('discharge_documents').update({ extraction_status: 'failed' }).eq('id', document_id)

  await serviceClient
    .from('discharge_documents')
    .update({ extraction_status: 'processing' })
    .eq('id', document_id)

  try {
    const { data: fileData, error: downloadError } = await serviceClient.storage
      .from('discharge-documents')
      .download(doc.storage_path)

    if (downloadError || !fileData) {
      await markFailed()
      return NextResponse.json(apiError('Failed to download document from storage'), { status: 500 })
    }

    const buffer = Buffer.from(await fileData.arrayBuffer())
    const pdfText = await extractTextFromPdf(buffer)

    const wordCount = pdfText.trim().split(/\s+/).filter(Boolean).length
    if (wordCount < 30) {
      await markFailed()
      return NextResponse.json(
        apiError('The uploaded PDF appears to be blank or contains too little text. Please upload the actual discharge summary document.'),
        { status: 422 },
      )
    }

    const extracted = await extractDischargeData(pdfText)

    if (!hasMeaningfulContent(extracted)) {
      await markFailed()
      return NextResponse.json(
        apiError('No discharge information could be extracted. Please check you uploaded the correct discharge summary document.'),
        { status: 422 },
      )
    }

    await serviceClient
      .from('discharge_documents')
      .update({ extraction_status: 'completed', raw_extraction: extracted as never })
      .eq('id', document_id)

    const { data: episode } = await serviceClient
      .from('care_episodes')
      .select('hospital_id, patients(preferred_language), hospitals(settings, timezone)')
      .eq('id', episodeId)
      .single()

    if (!episode) {
      await markFailed()
      return NextResponse.json(apiError('Episode not found'), { status: 404 })
    }

    const patientLang = (episode.patients as unknown as { preferred_language: string } | null)?.preferred_language
    const hospitalRow = episode.hospitals as unknown as { settings: { languages?: string[] }; timezone: string | null } | null
    const hospitalLangs = hospitalRow?.settings?.languages ?? ['en']

    const summaryId = await persistExtraction({
      serviceClient,
      episodeId,
      hospitalId: episode.hospital_id,
      documentId: document_id,
      extracted,
      targetLanguages: [patientLang, ...hospitalLangs],
      timezone: hospitalRow?.timezone ?? 'Asia/Dubai',
    })

    return NextResponse.json(apiSuccess({ summary_id: summaryId, extraction: extracted }))
  } catch (err) {
    console.error('[Extract]', err)
    await markFailed()
    return NextResponse.json(
      apiError('Extraction failed', err instanceof Error ? err.message : 'Unknown error'),
      { status: 500 },
    )
  }
}
