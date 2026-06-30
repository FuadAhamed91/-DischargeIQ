import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

  // Update medications if provided
  if (medications) {
    await supabase.from('medications').delete().eq('summary_id', summary.id)
    if (medications.length > 0) {
      await supabase.from('medications').insert(
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

  // Update follow-up requirements if provided
  if (follow_up_requirements) {
    await supabase.from('follow_up_requirements').delete().eq('summary_id', summary.id)
    if (follow_up_requirements.length > 0) {
      await supabase.from('follow_up_requirements').insert(
        follow_up_requirements.map((f) => ({
          summary_id: summary.id,
          hospital_id: summary.hospital_id,
          specialty: f.specialty,
          deadline: f.deadline,
          instructions: f.instructions,
        })),
      )
    }
  }

  const { data: updated } = await supabase
    .from('discharge_summaries')
    .select('*, medications(*), follow_up_requirements(*)')
    .eq('id', summary.id)
    .single()

  return NextResponse.json(apiSuccess(updated))
}
