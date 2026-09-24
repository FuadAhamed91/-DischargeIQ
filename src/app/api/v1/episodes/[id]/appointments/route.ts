import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError, requireRole } from '@/lib/utils/api'

export const dynamic = 'force-dynamic'

// GET /api/v1/episodes/:id/appointments
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { id: episodeId } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('appointments')
    .select('*')
    .eq('episode_id', episodeId)
    .order('scheduled_at', { ascending: true })

  if (error) return NextResponse.json(apiError('Failed to load appointments', error.message), { status: 500 })

  return NextResponse.json(apiSuccess(data))
}

// POST /api/v1/episodes/:id/appointments
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const roleError = requireRole(profile.role, 'nurse')
  if (roleError) return roleError

  const { id: episodeId } = await params
  const body = await request.json() as {
    specialty: string
    scheduled_at: string
    location?: string
    follow_up_id?: string
    external_id?: string
  }

  if (!body.specialty || !body.scheduled_at) {
    return NextResponse.json(apiError('specialty and scheduled_at are required'), { status: 400 })
  }

  const supabase = await createClient()

  // Verify episode belongs to same hospital
  const { data: episode } = await supabase
    .from('care_episodes')
    .select('hospital_id')
    .eq('id', episodeId)
    .single()

  if (!episode) return NextResponse.json(apiError('Episode not found'), { status: 404 })

  const { data, error } = await supabase
    .from('appointments')
    .insert({
      episode_id: episodeId,
      hospital_id: episode.hospital_id,
      specialty: body.specialty,
      scheduled_at: body.scheduled_at,
      location: body.location ?? null,
      follow_up_id: body.follow_up_id ?? null,
      external_id: body.external_id ?? null,
      status: 'scheduled',
    })
    .select()
    .single()

  if (error) return NextResponse.json(apiError('Failed to create appointment', error.message), { status: 500 })

  // Timeline event
  await (await createServiceClient()).from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    event_type: 'appointment_confirmed',
    payload: { appointment_id: data.id, action: 'created', specialty: data.specialty, scheduled_at: data.scheduled_at, created_by: profile.id },
    created_by: profile.id,
  })

  return NextResponse.json(apiSuccess(data), { status: 201 })
}
