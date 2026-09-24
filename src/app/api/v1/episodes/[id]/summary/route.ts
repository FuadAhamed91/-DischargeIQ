import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { syncFollowUpAppointments } from '@/lib/appointments/sync-follow-ups'
import { dropStaleSummaryTranslations } from '@/lib/ai/translation'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { z } from 'zod'

const UpdateSummarySchema = z.object({
  nurse_notes: z.string().optional().nullable(),
  emergency_symptoms: z.array(z.string()).optional(),
  lifestyle_instructions: z.array(z.string()).optional(),
  restrictions: z.array(z.string()).optional(),
  activities: z.array(z.string()).optional(),
  medications: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string(),
        dosage: z.string(),
        frequency: z.string(),
        instructions: z.string().optional().nullable(),
        reminder_times: z.array(z.string()).default([]),
        sort_order: z.number().default(0),
      }),
    )
    .optional(),
  follow_up_requirements: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        specialty: z.string(),
        deadline: z.string().optional().nullable(),
        instructions: z.string().optional().nullable(),
      }),
    )
    .optional(),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { id: episodeId } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('discharge_summaries')
    .select(`
      *,
      medications(*),
      follow_up_requirements(*),
      discharge_summary_translations(*),
      profiles!discharge_summaries_approved_by_fkey(id, full_name)
    `)
    .eq('episode_id', episodeId)
    .single()

  if (error || !data) {
    return NextResponse.json(apiError('Summary not found'), { status: 404 })
  }

  return NextResponse.json(apiSuccess(data))
}

export async function PATCH(
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

  const body = await request.json()
  const parsed = UpdateSummarySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(apiError('Validation error', parsed.error.message), { status: 422 })
  }

  const supabase = await createClient()

  // Get current summary
  const { data: summary } = await supabase
    .from('discharge_summaries')
    .select('id, hospital_id')
    .eq('episode_id', episodeId)
    .single()

  if (!summary) {
    return NextResponse.json(apiError('Summary not found'), { status: 404 })
  }

  const { medications, follow_up_requirements, ...summaryFields } = parsed.data

  // Update summary fields
  if (Object.keys(summaryFields).length > 0) {
    await supabase
      .from('discharge_summaries')
      .update({ ...summaryFields, status: 'pending_review' })
      .eq('id', summary.id)
  }

  // Medications and follow-ups are replaced wholesale. The service client does
  // it: the caller has already been authorised against the summary above, and
  // follow_up_requirements has no DELETE policy for users, so a nurse-level
  // delete silently removed nothing and every save duplicated the rows.
  const serviceClient = await createServiceClient()

  // Update medications if provided
  if (medications) {
    await serviceClient.from('medications').delete().eq('summary_id', summary.id)
    if (medications.length > 0) {
      await serviceClient.from('medications').insert(
        medications.map((m, i) => ({
          summary_id: summary.id,
          hospital_id: summary.hospital_id,
          name: m.name,
          dosage: m.dosage,
          frequency: m.frequency,
          instructions: m.instructions,
          reminder_times: m.reminder_times,
          sort_order: m.sort_order ?? i,
        })),
      )
    }
  }

  // Update follow-up requirements if provided, then keep the provisional
  // appointments derived from them in step (nurse may have fixed a date or
  // removed a follow-up in review).
  if (follow_up_requirements) {
    await serviceClient.from('follow_up_requirements').delete().eq('summary_id', summary.id)
    if (follow_up_requirements.length > 0) {
      await serviceClient.from('follow_up_requirements').insert(
        follow_up_requirements.map((f) => ({
          summary_id: summary.id,
          hospital_id: summary.hospital_id,
          specialty: f.specialty,
          deadline: f.deadline,
          instructions: f.instructions,
        })),
      )
    }
    const { data: hospitalRow } = await serviceClient.from('hospitals').select('timezone').eq('id', summary.hospital_id).single()
    try {
      await syncFollowUpAppointments({
        serviceClient,
        episodeId,
        hospitalId: summary.hospital_id,
        summaryId: summary.id,
        timezone: (hospitalRow?.timezone as string | null) ?? 'Asia/Dubai',
      })
    } catch (err) {
      console.error('[summary PATCH] follow-up appointment sync failed:', err)
    }
  }

  // Stored translations were made from the text as it stood; any that no
  // longer match it must not reach the patient (sending translates afresh).
  try {
    await dropStaleSummaryTranslations(serviceClient, summary.id)
  } catch (err) {
    console.error('[summary PATCH] dropping out-of-date translations failed:', err)
  }

  const { data: updated } = await supabase
    .from('discharge_summaries')
    .select('*, medications(*), follow_up_requirements(*)')
    .eq('id', summary.id)
    .single()

  return NextResponse.json(apiSuccess(updated))
}
