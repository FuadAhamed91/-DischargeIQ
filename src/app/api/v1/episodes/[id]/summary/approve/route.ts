import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const { id: episodeId } = await params

  if (!['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'].includes(profile.role)) {
    return NextResponse.json(apiError('Forbidden'), { status: 403 })
  }

  const supabase = await createClient()

  const { data: summary } = await supabase
    .from('discharge_summaries')
    .select('id, status, hospital_id, emergency_symptoms, lifestyle_instructions, restrictions, activities')
    .eq('episode_id', episodeId)
    .single()

  if (!summary) {
    return NextResponse.json(apiError('Summary not found'), { status: 404 })
  }

  if (summary.status === 'sent') {
    return NextResponse.json(apiError('Summary has already been sent to the patient'), { status: 409 })
  }

  // Verify the summary has meaningful content before approving
  const { count: medicationCount } = await supabase
    .from('medications')
    .select('*', { count: 'exact', head: true })
    .eq('summary_id', summary.id)

  const symptoms = (summary.emergency_symptoms ?? []) as string[]
  const instructions = (summary.lifestyle_instructions ?? []) as string[]
  const restrictions = (summary.restrictions ?? []) as string[]
  const activities = (summary.activities ?? []) as string[]

  const hasContent =
    (medicationCount ?? 0) > 0 ||
    symptoms.length > 0 ||
    instructions.length > 0 ||
    restrictions.length > 0 ||
    activities.length > 0

  if (!hasContent) {
    return NextResponse.json(
      apiError('This summary has no content. Please add at least one medication, emergency symptom, or instruction before approving.'),
      { status: 422 },
    )
  }

  const { data: approved, error } = await supabase
    .from('discharge_summaries')
    .update({
      status: 'approved',
      approved_by: profile.id,
      approved_at: new Date().toISOString(),
    })
    .eq('id', summary.id)
    .select()
    .single()

  if (error) {
    return NextResponse.json(apiError('Failed to approve summary', error.message), { status: 500 })
  }

  // Log timeline event
  await (await createServiceClient()).from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: summary.hospital_id,
    event_type: 'summary_approved',
    payload: { summary_id: summary.id, approved_by: profile.id },
    created_by: profile.id,
  })

  // Update episode to pending_review if still draft
  await supabase
    .from('care_episodes')
    .update({ status: 'pending_review' })
    .eq('id', episodeId)
    .eq('status', 'draft')

  return NextResponse.json(apiSuccess(approved))
}
