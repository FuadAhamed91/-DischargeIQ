/**
 * Turns an ExtractionResult into the episode's draft discharge summary
 * (summary row + medications + follow-ups + timeline event) and kicks off the
 * translations. Shared by the two places a document gets extracted:
 *   - document-first intake (POST /api/v1/intake/commit), and
 *   - re-extraction on an existing episode (POST /api/v1/episodes/[id]/extract).
 */

import { after } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ExtractionResult } from '@/lib/ai/extraction'
import { translateAndStoreSummary } from '@/lib/ai/translation'
import { syncFollowUpAppointments } from '@/lib/appointments/sync-follow-ups'
import type { LanguageCode } from '@/types/enums'

const SUPPORTED = new Set<LanguageCode>(['ar', 'en', 'hi', 'ta', 'tl'])

export function asLanguageCode(value: string | null | undefined, fallback: LanguageCode = 'en'): LanguageCode {
  return value && SUPPORTED.has(value as LanguageCode) ? (value as LanguageCode) : fallback
}

export interface PersistExtractionParams {
  serviceClient: SupabaseClient
  episodeId: string
  hospitalId: string
  documentId: string
  extracted: ExtractionResult
  /** Languages to translate the summary into (patient's + hospital's). Deduped here. */
  targetLanguages: (string | null | undefined)[]
  /** Hospital timezone: provisional appointments land at 09:00 local on the follow-up's "by" date. */
  timezone: string
}

/** Creates or replaces the draft summary for the episode; returns its id. */
export async function persistExtraction(params: PersistExtractionParams): Promise<string> {
  const { serviceClient, episodeId, hospitalId, documentId, extracted } = params

  const { data: existingSummary } = await serviceClient
    .from('discharge_summaries')
    .select('id, version')
    .eq('episode_id', episodeId)
    .maybeSingle()

  const summaryPayload = {
    episode_id: episodeId,
    hospital_id: hospitalId,
    status: 'draft' as const,
    source_language: asLanguageCode(extracted.source_language),
    emergency_symptoms: extracted.emergency_symptoms,
    lifestyle_instructions: extracted.lifestyle_instructions,
    restrictions: extracted.restrictions,
    activities: extracted.activities,
    version: existingSummary ? existingSummary.version + 1 : 1,
  }

  let summaryId: string
  if (existingSummary) {
    const { error } = await serviceClient
      .from('discharge_summaries')
      .update({ ...summaryPayload, approved_by: null, approved_at: null })
      .eq('id', existingSummary.id)
    if (error) throw new Error(`Failed to update discharge summary: ${error.message}`)
    summaryId = existingSummary.id
  } else {
    const { data: created, error } = await serviceClient
      .from('discharge_summaries')
      .insert(summaryPayload)
      .select('id')
      .single()
    if (error || !created) throw new Error(`Failed to create discharge summary: ${error?.message ?? 'no row'}`)
    summaryId = created.id
  }

  // Replace medications
  await serviceClient.from('medications').delete().eq('summary_id', summaryId)
  if (extracted.medications.length > 0) {
    const { error } = await serviceClient.from('medications').insert(
      extracted.medications.map((med, i) => ({
        summary_id: summaryId,
        hospital_id: hospitalId,
        name: med.name,
        dosage: med.dosage,
        frequency: med.frequency,
        instructions: med.instructions,
        reminder_times: med.reminder_times,
        sort_order: i,
      })),
    )
    if (error) throw new Error(`Failed to save medications: ${error.message}`)
  }

  // Replace follow-up requirements
  await serviceClient.from('follow_up_requirements').delete().eq('summary_id', summaryId)
  if (extracted.follow_up_requirements.length > 0) {
    const { error } = await serviceClient.from('follow_up_requirements').insert(
      extracted.follow_up_requirements.map((fu) => ({
        summary_id: summaryId,
        hospital_id: hospitalId,
        specialty: fu.specialty,
        deadline: fu.deadline,
        instructions: fu.instructions,
      })),
    )
    if (error) throw new Error(`Failed to save follow-up requirements: ${error.message}`)
  }

  // Dated follow-ups show up on the Appointments screen straight away.
  await syncFollowUpAppointments({ serviceClient, episodeId, hospitalId, summaryId, timezone: params.timezone })

  await serviceClient.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: hospitalId,
    event_type: 'extraction_completed',
    payload: { document_id: documentId, summary_id: summaryId, medication_count: extracted.medications.length },
  })

  // Translate after the response is sent so the nurse isn't blocked on it.
  // With the source language as saved: the translation's fingerprint has to
  // match the summary row's for the send to use it (see summarySourceHash).
  const targetLanguages = [...new Set(params.targetLanguages.filter(Boolean).map((l) => asLanguageCode(l)))]
  if (targetLanguages.length > 0) {
    const saved = { ...extracted, source_language: summaryPayload.source_language }
    after(() => translateAndStoreSummary(serviceClient, summaryId, saved, targetLanguages))
  }

  return summaryId
}
