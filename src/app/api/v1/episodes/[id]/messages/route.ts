import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { sendAndLog } from '@/lib/whatsapp/outbound'
import { NURSE_ATTENDING_MS } from '@/lib/whatsapp/fsm'

export const dynamic = 'force-dynamic'

const CLINICAL = new Set(['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse', 'case_manager'])

const SendSchema = z.object({
  text: z.string().trim().min(1, 'Message is empty').max(1000, 'Keep messages under 1000 characters'),
})

type Params = { params: Promise<{ id: string }> }

async function loadEpisode(episodeId: string) {
  // User client: RLS decides whether this nurse may see the episode at all.
  const supabase = await createClient()
  const { data } = await supabase
    .from('care_episodes')
    .select('id, hospital_id, patient_id, status, patients(full_name, phone_e164), hospitals(whatsapp_phone_number_id)')
    .eq('id', episodeId)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id as string,
    hospital_id: data.hospital_id as string,
    patient_id: data.patient_id as string,
    status: data.status as string,
    patient: data.patients as unknown as { full_name: string; phone_e164: string },
    hospital: data.hospitals as unknown as { whatsapp_phone_number_id: string | null },
  }
}

/**
 * POST — a nurse writes to the patient on WhatsApp from the Conversation tab.
 * The message is logged on the transcript with who sent it, and the
 * conversation enters nurse_attending for 30 minutes so the assistant does
 * not answer the patient's replies over the nurse (emergency keywords and
 * voice-note triage still fire).
 */
export async function POST(request: Request, { params }: Params) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response
  const { profile } = auth
  if (!CLINICAL.has(profile.role)) return NextResponse.json(apiError('Forbidden'), { status: 403 })

  const parsed = SendSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(apiError(parsed.error.issues[0]?.message ?? 'Validation error'), { status: 422 })
  }

  const { id: episodeId } = await params
  const episode = await loadEpisode(episodeId)
  if (!episode) return NextResponse.json(apiError('Episode not found'), { status: 404 })
  if (!['pending_review', 'active'].includes(episode.status)) {
    return NextResponse.json(apiError('This episode is closed — messages can only be sent on open episodes'), { status: 409 })
  }
  if (!episode.hospital.whatsapp_phone_number_id) {
    return NextResponse.json(apiError('Hospital WhatsApp number is not configured'), { status: 422 })
  }

  const service = await createServiceClient()
  const result = await sendAndLog({
    supabase: service,
    phoneNumberId: episode.hospital.whatsapp_phone_number_id,
    message: { type: 'text', to: episode.patient.phone_e164, body: parsed.data.text },
    episodeId,
    hospitalId: episode.hospital_id,
    patientId: episode.patient_id,
    metadata: { sender: 'nurse', sender_id: profile.id, sender_name: profile.full_name },
  })

  if (result.status === 'failed') {
    return NextResponse.json(apiError('WhatsApp could not deliver the message', result.error), { status: 502 })
  }

  const until = new Date(Date.now() + NURSE_ATTENDING_MS).toISOString()
  if (result.conversationId) {
    await service
      .from('whatsapp_conversations')
      .update({ conversation_state: { state: 'nurse_attending', until, by: profile.id }, updated_at: new Date().toISOString() })
      .eq('id', result.conversationId)
  }

  await service.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    event_type: 'whatsapp_outbound',
    payload: { kind: 'nurse_message', message_id: result.loggedMessageId, wa_message_id: result.messageId, sender_name: profile.full_name },
    created_by: profile.id,
  })

  const { data: logged } = result.loggedMessageId
    ? await service.from('whatsapp_messages').select('id, direction, message_type, content, status, metadata, created_at').eq('id', result.loggedMessageId).single()
    : { data: null }

  return NextResponse.json(apiSuccess({ message: logged, conversation_state: { state: 'nurse_attending', until } }), { status: 201 })
}

/** PATCH { attending: false } — hand the conversation back to the assistant now. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response
  if (!CLINICAL.has(auth.profile.role)) return NextResponse.json(apiError('Forbidden'), { status: 403 })

  const body = (await request.json().catch(() => ({}))) as { attending?: unknown }
  if (body.attending !== false) return NextResponse.json(apiError('Only { attending: false } is supported'), { status: 422 })

  const { id: episodeId } = await params
  const episode = await loadEpisode(episodeId)
  if (!episode) return NextResponse.json(apiError('Episode not found'), { status: 404 })

  const service = await createServiceClient()
  await service
    .from('whatsapp_conversations')
    .update({ conversation_state: 'idle', updated_at: new Date().toISOString() })
    .eq('episode_id', episodeId)

  return NextResponse.json(apiSuccess({ conversation_state: { state: 'idle' } }))
}
