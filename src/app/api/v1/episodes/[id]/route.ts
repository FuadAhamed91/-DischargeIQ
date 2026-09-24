import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { z } from 'zod'

// The risk colour is not changed here: POST /api/v1/episodes/[id]/risk asks
// why it is lowered and records who changed it.
const UpdateEpisodeSchema = z.object({
  status: z.enum(['draft', 'pending_review', 'active', 'completed', 'cancelled']).optional(),
  assigned_nurse_id: z.string().uuid().optional().nullable(),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('care_episodes')
    .select(`
      *,
      patients(*),
      profiles!care_episodes_assigned_nurse_id_fkey(id, full_name, role),
      discharge_summaries(
        *,
        medications(*),
        follow_up_requirements(*),
        discharge_summary_translations(*)
      ),
      discharge_documents(id, original_filename, extraction_status, created_at),
      appointments(*, follow_up_requirements(*)),
      alerts(id, type, severity, status, created_at)
    `)
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json(apiError('Episode not found'), { status: 404 })
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
  const { id } = await params

  if (!['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'].includes(profile.role)) {
    return NextResponse.json(apiError('Forbidden'), { status: 403 })
  }

  const body = await request.json()
  const parsed = UpdateEpisodeSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(apiError('Validation error', parsed.error.message), { status: 422 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('care_episodes')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json(apiError('Failed to update episode', error?.message), { status: 500 })
  }

  return NextResponse.json(apiSuccess(data))
}
