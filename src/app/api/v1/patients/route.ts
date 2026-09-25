import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { z } from 'zod'

const CreatePatientSchema = z.object({
  mrn: z.string().min(1),
  full_name: z.string().min(1),
  phone_e164: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Must be E.164 format e.g. +971501234567'),
  preferred_language: z.enum(['ar', 'en', 'hi', 'ta', 'tl']).default('en'),
  date_of_birth: z.string().optional().nullable(),
  assigned_nurse_id: z.string().uuid().optional().nullable(),
})

export async function GET(request: Request) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const { searchParams } = new URL(request.url)
  const search = searchParams.get('search') ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = Math.min(100, parseInt(searchParams.get('limit') ?? '20'))
  const offset = (page - 1) * limit

  const supabase = await createClient()

  let query = supabase
    .from('patients')
    .select('*, profiles!patients_assigned_nurse_id_fkey(id, full_name)', { count: 'exact' })
    .eq('hospital_id', profile.hospital_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,mrn.ilike.%${search}%,phone_e164.ilike.%${search}%`)
  }

  // Nurses only see their assigned patients
  if (profile.role === 'nurse') {
    query = query.eq('assigned_nurse_id', profile.id)
  }

  const { data, count, error } = await query

  if (error) {
    return NextResponse.json(apiError('Failed to fetch patients', error.message), { status: 500 })
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
  const parsed = CreatePatientSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(apiError('Validation error', parsed.error.message), { status: 422 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('patients')
    .insert({
      ...parsed.data,
      hospital_id: profile.hospital_id,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(apiError('A patient with this MRN already exists'), { status: 409 })
    }
    return NextResponse.json(apiError('Failed to create patient', error.message), { status: 500 })
  }

  return NextResponse.json(apiSuccess(data), { status: 201 })
}
