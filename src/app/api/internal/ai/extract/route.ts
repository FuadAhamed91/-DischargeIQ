import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { extractTextFromPdf, extractDischargeData } from '@/lib/ai/extraction'
import { apiSuccess, apiError } from '@/types/api'

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    const { document_id, episode_id } = await request.json()

    if (!document_id || !episode_id) {
      return NextResponse.json(apiError('document_id and episode_id are required'), { status: 400 })
    }

    const supabase = await createServiceClient()

    // Mark as processing
    await supabase
      .from('discharge_documents')
      .update({ extraction_status: 'processing' })
      .eq('id', document_id)

    // Fetch document metadata
    const { data: doc } = await supabase
      .from('discharge_documents')
      .select('storage_path')
      .eq('id', document_id)
      .single()

    if (!doc) {
      return NextResponse.json(apiError('Document not found'), { status: 404 })
    }

    // Download PDF from Supabase Storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('discharge-documents')
      .download(doc.storage_path)

    if (downloadError || !fileData) {
      await supabase
        .from('discharge_documents')
        .update({ extraction_status: 'failed' })
        .eq('id', document_id)
      return NextResponse.json(apiError('Failed to download document'), { status: 500 })
    }

    // Extract text
    const buffer = Buffer.from(await fileData.arrayBuffer())
    const pdfText = await extractTextFromPdf(buffer)

    // Reject blank or near-empty PDFs before wasting an AI call
    const wordCount = pdfText.trim().split(/\s+/).filter(Boolean).length
    if (wordCount < 30) {
      await supabase
        .from('discharge_documents')
        .update({ extraction_status: 'failed' })
        .eq('id', document_id)
      return NextResponse.json(
        apiError('The uploaded PDF appears to be blank or contains too little text to extract discharge data. Please upload the actual discharge summary document.'),
        { status: 422 },
      )
    }

    // AI extraction
    const extracted = await extractDischargeData(pdfText)

    // Reject if AI found nothing meaningful
    const hasMeaningfulContent =
      extracted.medications.length > 0 ||
      extracted.emergency_symptoms.length > 0 ||
      extracted.lifestyle_instructions.length > 0 ||
      extracted.restrictions.length > 0

    if (!hasMeaningfulContent) {
      await supabase
        .from('discharge_documents')
        .update({ extraction_status: 'failed' })
        .eq('id', document_id)
      return NextResponse.json(
        apiError('No discharge information could be extracted from this document. Please check that you uploaded the correct file — it should contain medications, instructions, or emergency warning signs.'),
        { status: 422 },
      )
    }

    // Store raw extraction on document
    await supabase
      .from('discharge_documents')
      .update({ extraction_status: 'completed', raw_extraction: extracted as never })
      .eq('id', document_id)

    // Upsert discharge summary (draft)
    const { data: existingSummary } = await supabase
      .from('discharge_summaries')
      .select('id, version')
      .eq('episode_id', episode_id)
      .single()

    const summaryPayload = {
      episode_id,
      hospital_id: (
        await supabase
          .from('care_episodes')
          .select('hospital_id')
          .eq('id', episode_id)
          .single()
      ).data?.hospital_id,
      status: 'draft' as const,
      source_language: (extracted.source_language as 'en' | 'ar' | 'hi' | 'ta' | 'tl') ?? 'en',
      emergency_symptoms: extracted.emergency_symptoms,
      lifestyle_instructions: extracted.lifestyle_instructions,
      restrictions: extracted.restrictions,
      activities: extracted.activities,
      version: existingSummary ? existingSummary.version + 1 : 1,
    }

    let summaryId: string

    if (existingSummary) {
      await supabase
        .from('discharge_summaries')
        .update({ ...summaryPayload, approved_by: null, approved_at: null })
        .eq('id', existingSummary.id)
      summaryId = existingSummary.id
    } else {
      const { data: newSummary } = await supabase
        .from('discharge_summaries')
        .insert(summaryPayload)
        .select('id')
        .single()
      summaryId = newSummary!.id
    }

    // Insert medications (clear old ones first on re-extraction)
    await supabase.from('medications').delete().eq('summary_id', summaryId)

    if (extracted.medications.length > 0) {
      const { data: episode } = await supabase
        .from('care_episodes')
        .select('hospital_id')
        .eq('id', episode_id)
        .single()

      await supabase.from('medications').insert(
        extracted.medications.map((med, i) => ({
          summary_id: summaryId,
          hospital_id: episode!.hospital_id,
          name: med.name,
          dosage: med.dosage,
          frequency: med.frequency,
          instructions: med.instructions,
          reminder_times: med.reminder_times,
          sort_order: i,
        })),
      )
    }

    // Insert follow-up requirements
    await supabase.from('follow_up_requirements').delete().eq('summary_id', summaryId)

    if (extracted.follow_up_requirements.length > 0) {
      const { data: episode } = await supabase
        .from('care_episodes')
        .select('hospital_id')
        .eq('id', episode_id)
        .single()

      await supabase.from('follow_up_requirements').insert(
        extracted.follow_up_requirements.map((fu) => ({
          summary_id: summaryId,
          hospital_id: episode!.hospital_id,
          specialty: fu.specialty,
          deadline: fu.deadline,
          instructions: fu.instructions,
        })),
      )
    }

    // Log timeline event
    await supabase.from('patient_timeline_events').insert({
      episode_id,
      hospital_id: summaryPayload.hospital_id,
      event_type: 'extraction_completed',
      payload: { document_id, summary_id: summaryId, medication_count: extracted.medications.length },
    })

    return NextResponse.json(
      apiSuccess({ summary_id: summaryId, extraction: extracted }),
    )
  } catch (err) {
    console.error('[AI Extract]', err)
    return NextResponse.json(
      apiError('Extraction failed', err instanceof Error ? err.message : 'Unknown error'),
      { status: 500 },
    )
  }
}
