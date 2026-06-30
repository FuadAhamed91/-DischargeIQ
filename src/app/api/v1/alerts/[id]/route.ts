import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError } from '@/lib/utils/api'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Params) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const { id } = await params
  const body = await request.json() as { status: 'acknowledged' | 'resolved' }

  if (!['acknowledged', 'resolved'].includes(body.status)) {
    return NextResponse.json(apiError('status must be acknowledged or resolved'), { status: 400 })
  }

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('alerts')
    .update({
      status: body.status,
      acknowledged_by: profile.id,
      acknowledged_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('hospital_id', profile.hospital_id)
    .select()
    .single()

  if (error || !data) {
    return NextResponse.json(apiError('Failed to update alert', error?.message), { status: 500 })
  }

  return NextResponse.json(apiSuccess(data))
}
