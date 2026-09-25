/**
 * POST /api/v1/episodes/[id]/simulate-reply — the demo's "Reply as the patient".
 *
 * A judge cannot hold a demo patient's phone, so a demo patient's page lets
 * them write as the patient. The text is handled by
 * handleSimulatedPatientMessage: the same logging, answers, triage and alerts
 * as a WhatsApp message from the patient's phone, and the replies go out on
 * WhatsApp as usual. Only the demo patients (the sample letters' MRNs) can be
 * written for; a real patient's words are never made up.
 */
import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthContext, apiSuccess, apiError, requireRole } from '@/lib/utils/api'
import { handleSimulatedPatientMessage } from '@/lib/whatsapp/webhook-handler'
import { isSampleMrn } from '@/lib/intake/sample-letters'

export const dynamic = 'force-dynamic'
// The reply can include AI triage and a Twilio send, after the response.
export const maxDuration = 60

const Body = z.object({ text: z.string().trim().min(1, 'Write a message first').max(500, 'Keep it under 500 characters') })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response
  const roleError = requireRole(auth.profile.role, 'nurse')
  if (roleError) return roleError

  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(apiError('Invalid message', parsed.error.issues[0]?.message), { status: 400 })
  }

  const { id: episodeId } = await params
  const supabase = await createClient()
  const { data: episode } = await supabase
    .from('care_episodes')
    .select('id, status, patients(mrn)')
    .eq('id', episodeId)
    .eq('hospital_id', auth.profile.hospital_id)
    .single()
  if (!episode) return NextResponse.json(apiError('Episode not found'), { status: 404 })

  const patient = (Array.isArray(episode.patients) ? episode.patients[0] : episode.patients) as { mrn: string } | null
  if (!patient || !isSampleMrn(patient.mrn)) {
    return NextResponse.json(apiError('Only the demo patients can be replied for'), { status: 403 })
  }
  if (!['active', 'pending_review'].includes(episode.status as string)) {
    return NextResponse.json(apiError('This care plan has ended', 'Add the demo patient again to start a new one'), { status: 409 })
  }

  after(async () => {
    try {
      await handleSimulatedPatientMessage({ episodeId, text: parsed.data.text })
    } catch (err) {
      console.error('[simulate-reply] failed:', err)
    }
  })

  return NextResponse.json(apiSuccess({ queued: true }), { status: 202 })
}
