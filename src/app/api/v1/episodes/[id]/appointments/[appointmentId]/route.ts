import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError, requireRole } from '@/lib/utils/api'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; appointmentId: string }> }

// GET /api/v1/episodes/:id/appointments/:appointmentId
export async function GET(_request: Request, { params }: Params) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { appointmentId } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('id', appointmentId)
    .single()

  if (error || !data) return NextResponse.json(apiError('Appointment not found'), { status: 404 })

  return NextResponse.json(apiSuccess(data))
}

// PATCH /api/v1/episodes/:id/appointments/:appointmentId
export async function PATCH(request: Request, { params }: Params) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const roleError = requireRole(profile.role, 'nurse')
  if (roleError) return roleError

  const { id: episodeId, appointmentId } = await params
  const body = await request.json() as {
    specialty?: string
    scheduled_at?: string
    location?: string
    status?: string
  }

  const supabase = await createClient()

  const changes: Record<string, unknown> = {}
  if (body.specialty !== undefined) changes.specialty = body.specialty
  if (body.location !== undefined) changes.location = body.location
  if (body.status !== undefined) changes.status = body.status
  if (body.scheduled_at !== undefined) {
    changes.scheduled_at = body.scheduled_at
    // A nurse setting the time turns a provisional (from-the-letter) slot into a real one
    changes.time_tbc = false
  }

  const { data, error } = await supabase
    .from('appointments')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .select()
    .single()

  if (error) return NextResponse.json(apiError('Failed to update appointment', error.message), { status: 500 })

  await (await createServiceClient()).from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: data.hospital_id,
    event_type: 'appointment_rescheduled',
    payload: { appointment_id: appointmentId, changes: body, updated_by: profile.id },
    created_by: profile.id,
  })

  return NextResponse.json(apiSuccess(data))
}

// DELETE /api/v1/episodes/:id/appointments/:appointmentId
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const roleError = requireRole(profile.role, 'discharge_coordinator')
  if (roleError) return roleError

  const { appointmentId } = await params
  const supabase = await createClient()

  const { error } = await supabase
    .from('appointments')
    .delete()
    .eq('id', appointmentId)

  if (error) return NextResponse.json(apiError('Failed to delete appointment', error.message), { status: 500 })

  return NextResponse.json(apiSuccess({ deleted: true }))
}
