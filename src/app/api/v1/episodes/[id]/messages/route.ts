import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { sendAndLog } from '@/lib/whatsapp/outbound'
import { NURSE_ATTENDING_MS } from '@/lib/whatsapp/fsm'
import { rememberPatientIfShared } from '@/lib/whatsapp/number-session'
import { translateNurseMessage } from '@/lib/ai/translation'
import { GeminiUnavailableError } from '@/lib/ai/gemini'
import { SUPPORTED_LANGUAGES } from '@/types/enums'
import type { LanguageCode } from '@/types/enums'

export const dynamic = 'force-dynamic'
// Translation (Gemini, up to 15 s) comes before the Twilio send.
export const maxDuration = 30

const CLINICAL = new Set(['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse', 'case_manager'])

const SendSchema = z.object({
  text: z.string().trim().min(1, 'Message is empty').max(1000, 'Keep messages under 1000 characters'),
  /** Translate into the patient's language before sending (default). false sends the text exactly as typed. */
  translate: z.boolean().default(true),
})

type Params = { params: Promise<{ id: string }> }

async function loadEpisode(episodeId: string) {
  // User client: RLS decides whether this nurse may see the episode at all.
  const supabase = await createClient()
  const { data } = await supabase
    .from('care_episodes')
    .select('id, hospital_id, patient_id, status, patients(full_name, phone_e164, preferred_language), hospitals(whatsapp_phone_number_id)')
    .eq('id', episodeId)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id as string,
    hospital_id: data.hospital_id as string,
    patient_id: data.patient_id as string,
    status: data.status as string,
    patient: data.patients as unknown as { full_name: string; phone_e164: string; preferred_language: LanguageCode | null },
    hospital: data.hospitals as unknown as { whatsapp_phone_number_id: string | null },
  }
}

/**
 * POST — a nurse writes to the patient on WhatsApp from the Conversation tab.
 * Unless { translate: false }, the text is first translated into the
 * patient's language: the patient receives the translation, and the
 * transcript keeps what the nurse typed (metadata.original_text). When the
 * translation fails nothing is sent — the nurse decides whether to send it
 * as typed. The conversation then enters nurse_attending for 30 minutes so
 * the assistant does not answer the patient's replies over the nurse
 * (emergency keywords and voice-note triage still fire).
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

  const typed = parsed.data.text
  const language: LanguageCode = episode.patient.preferred_language ?? 'en'
  let body = typed
  if (parsed.data.translate && language !== 'en') {
    try {
      body = await translateNurseMessage(typed, language)
    } catch (err) {
      console.error(`[nurse message] translation into ${language} failed for episode ${episodeId}:`, err)
      const hint = !(err instanceof GeminiUnavailableError) ? 'Try again, or send it as typed.'
        : err.quotaReached ? 'The translation service has reached its usage limit for now. Send it as typed, or try again later.'
          : 'The translation service is busy. Try again in a minute, or send it as typed.'
      return NextResponse.json(
        apiError(`Could not translate into ${SUPPORTED_LANGUAGES[language]} — nothing was sent`, hint, 'translation_failed'),
        { status: 503 },
      )
    }
  }
  // Already in the patient's language: nothing to keep beside it.
  const translated = body !== typed

  const service = await createServiceClient()
  const result = await sendAndLog({
    supabase: service,
    phoneNumberId: episode.hospital.whatsapp_phone_number_id,
    message: { type: 'text', to: episode.patient.phone_e164, body },
    episodeId,
    hospitalId: episode.hospital_id,
    patientId: episode.patient_id,
    metadata: {
      sender: 'nurse',
      sender_id: profile.id,
      sender_name: profile.full_name,
      ...(translated ? { original_text: typed, translated_to: language } : {}),
    },
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

  // Shared number: the nurse just made this patient the topic. Replies land
  // here anyway while nurse_attending; this keeps them here afterwards too.
  await rememberPatientIfShared(service, {
    hospitalId: episode.hospital_id,
    phone: episode.patient.phone_e164,
    patientId: episode.patient_id,
    patientName: episode.patient.full_name,
    episodeId,
  })

  await service.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    event_type: 'whatsapp_outbound',
    payload: {
      kind: 'nurse_message',
      message_id: result.loggedMessageId,
      wa_message_id: result.messageId,
      sender_name: profile.full_name,
      ...(translated ? { translated_to: language } : {}),
    },
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
