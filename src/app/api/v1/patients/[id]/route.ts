import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { z } from 'zod'

const UpdatePatientSchema = z.object({
  full_name: z.string().min(1).optional(),
  phone_e164: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  preferred_language: z.enum(['ar', 'en', 'hi', 'ta', 'tl']).optional(),
  date_of_birth: z.string().optional().nullable(),
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
    .from('patients')
    .select(`
      *,
      profiles!patients_assigned_nurse_id_fkey(id, full_name),
      care_episodes(id, status, discharge_date, current_risk_level, compliance_score, created_at)
    `)
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json(apiError('Patient not found'), { status: 404 })
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
  const parsed = UpdatePatientSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(apiError('Validation error', parsed.error.message), { status: 422 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('patients')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json(apiError('Failed to update patient', error?.message), { status: 500 })
  }

  return NextResponse.json(apiSuccess(data))
}
