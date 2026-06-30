import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { z } from 'zod'

const CreateEpisodeSchema = z.object({
  patient_id: z.string().uuid(),
  discharge_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  assigned_nurse_id: z.string().uuid().optional().nullable(),
})

export async function GET(request: Request) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const risk_level = searchParams.get('risk_level')
  const nurse_id = searchParams.get('nurse_id')
  const search = searchParams.get('search') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20'))
  const offset = (page - 1) * limit

  const supabase = await createClient()

  let query = supabase
    .from('care_episodes')
    .select(
      `
      *,
      patients(id, full_name, phone_e164, preferred_language, mrn),
      profiles!care_episodes_assigned_nurse_id_fkey(id, full_name),
      discharge_summaries(id, status, version)
    `,
      { count: 'exact' },
    )
    .eq('hospital_id', profile.hospital_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (risk_level) query = query.eq('current_risk_level', risk_level)
  if (nurse_id) query = query.eq('assigned_nurse_id', nurse_id)
  if (profile.role === 'nurse') query = query.eq('assigned_nurse_id', profile.id)

  if (search) {
    query = query.ilike('patients.full_name', `%${search}%`)
  }

  const { data, count, error } = await query

  if (error) {
    return NextResponse.json(apiError('Failed to fetch episodes', error.message), { status: 500 })
  }

  return NextResponse.json(
    apiSuccess(data, {
      page,
      limit,
      total: count ?? 0,
      has_more: offset + limit < (count ?? 0),
    }),
  )
}

export async function POST(request: Request) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth

  if (!['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'].includes(profile.role)) {
    return NextResponse.json(apiError('Forbidden'), { status: 403 })
  }

  const body = await request.json()
  const parsed = CreateEpisodeSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(apiError('Validation error', parsed.error.message), { status: 422 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('care_episodes')
    .insert({
      ...parsed.data,
      hospital_id: profile.hospital_id,
      assigned_nurse_id: parsed.data.assigned_nurse_id ?? profile.id,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        apiError('This patient already has an active episode'),
        { status: 409 },
      )
    }
    return NextResponse.json(apiError('Failed to create episode', error.message), { status: 500 })
  }

  return NextResponse.json(apiSuccess(data), { status: 201 })
}
