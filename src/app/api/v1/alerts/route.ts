import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError } from '@/lib/utils/api'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') ?? 'open'
  const severity = searchParams.get('severity')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 100)

  const supabase = await createClient()

  let query = supabase
    .from('alerts')
    .select(`
      id, type, severity, status, created_at, acknowledged_at,
      episode_id,
      care_episodes(
        id, current_risk_level,
        patients(full_name, mrn)
      )
    `)
    .eq('hospital_id', profile.hospital_id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status !== 'all') query = query.eq('status', status)
  if (severity) query = query.eq('severity', severity)

  const { data, error } = await query
  if (error) return NextResponse.json(apiError('Failed to load alerts', error.message), { status: 500 })

  return NextResponse.json(apiSuccess(data))
}
