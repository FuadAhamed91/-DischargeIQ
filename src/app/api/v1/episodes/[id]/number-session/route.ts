import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { saveNumberSession } from '@/lib/whatsapp/number-session'
import { EMPTY_SESSION } from '@/lib/whatsapp/routing'

export const dynamic = 'force-dynamic'

const CLINICAL = new Set(['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse', 'case_manager'])

type Params = { params: Promise<{ id: string }> }

/**
 * DELETE — forget what the patient's WhatsApp number is currently taken to
 * be writing about. The next message from that number is routed from
 * scratch: to the one conversation waiting for a reply, else the sender is
 * asked. For when a nurse can see the memory is wrong (the daughter wrote
 * about her mother once and every later message went to her too).
 */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response
  if (!CLINICAL.has(auth.profile.role)) return NextResponse.json(apiError('Forbidden'), { status: 403 })

  const { id: episodeId } = await params
  // User client: RLS decides whether this nurse may see the episode at all.
  const supabase = await createClient()
  const { data: episode } = await supabase
    .from('care_episodes')
    .select('id, hospital_id, patients(phone_e164)')
    .eq('id', episodeId)
    .maybeSingle()
  if (!episode) return NextResponse.json(apiError('Episode not found'), { status: 404 })

  const patient = (Array.isArray(episode.patients) ? episode.patients[0] : episode.patients) as { phone_e164: string } | null
  if (!patient) return NextResponse.json(apiError('Episode has no patient'), { status: 404 })

  const service = await createServiceClient()
  await saveNumberSession(service, episode.hospital_id as string, patient.phone_e164, EMPTY_SESSION)

  return NextResponse.json(apiSuccess({ phone: patient.phone_e164, session: { activePatientId: null, choicePending: false } }))
}
