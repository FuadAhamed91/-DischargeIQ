/**
 * The care plan on WhatsApp: the one message that carries the discharge
 * instructions (medications, follow-up appointments, warning signs). Built and
 * sent from here whether a nurse pressed "Send to patient", pressed "Resend",
 * or the patient's own message just re-opened a window that an earlier send
 * had missed (see redeliverFailedCarePlan).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendAndLog } from './outbound'
import type { SendAndLogResult } from './outbound'
import { buildDischargeSummaryMessage } from './templates'
import type { CarePlanAppointment, CarePlanTranslation } from './templates'
import type { LanguageCode } from '@/types/enums'

/** metadata.kind on the logged message, so the transcript and delivery receipts know which message is the care plan. */
export const CARE_PLAN_KIND = 'care_plan'

export interface CarePlanPatient {
  id: string
  full_name: string
  /** E.164 (or whatsapp:E.164) — the number the plan is sent to. */
  phone: string
  preferred_language: LanguageCode | string | null
}

export interface CarePlanHospital {
  id: string
  name: string
  whatsapp_phone_number_id: string
  timezone: string | null
}

export interface SendCarePlanParams {
  serviceClient: SupabaseClient
  episodeId: string
  /** The discharge_summaries row (id, source_language and the instruction arrays). */
  summary: { id: string; source_language: string | null } & Record<string, unknown>
  patient: CarePlanPatient
  hospital: CarePlanHospital
  /** True when this is not the first attempt for this summary. */
  resend?: boolean
  /** Why it is being (re)sent — stored on the message for the transcript. */
  trigger?: 'nurse' | 'patient_message'
}

/** Loads medications, appointments and the patient-language translation, builds the message, sends and logs it. */
export async function sendCarePlan(params: SendCarePlanParams): Promise<SendAndLogResult> {
  const { serviceClient, episodeId, summary, patient, hospital } = params
  const language = ((patient.preferred_language as LanguageCode | null) ?? 'en') as LanguageCode

  const [{ data: medications }, { data: appointments }, { data: translation }] = await Promise.all([
    serviceClient.from('medications').select('*').eq('summary_id', summary.id).order('sort_order'),
    serviceClient
      .from('appointments')
      .select('specialty, scheduled_at, location, time_tbc, status')
      .eq('episode_id', episodeId)
      .in('status', ['scheduled', 'confirmation_pending', 'confirmed'])
      .order('scheduled_at', { ascending: true }),
    language !== (summary.source_language ?? 'en')
      ? serviceClient.from('discharge_summary_translations').select('content').eq('summary_id', summary.id).eq('language', language).maybeSingle()
      : Promise.resolve({ data: null as { content: unknown } | null }),
  ])

  const message = buildDischargeSummaryMessage({
    to: patient.phone,
    patientName: patient.full_name,
    hospitalName: hospital.name,
    language,
    summary: summary as unknown as Parameters<typeof buildDischargeSummaryMessage>[0]['summary'],
    medications: (medications ?? []) as Parameters<typeof buildDischargeSummaryMessage>[0]['medications'],
    appointments: (appointments ?? []) as CarePlanAppointment[],
    timezone: hospital.timezone ?? 'Asia/Dubai',
    translation: (translation?.content as CarePlanTranslation | null) ?? null,
  })

  // The plan asks nothing of the patient, so the conversation state is left alone.
  return sendAndLog({
    supabase: serviceClient,
    phoneNumberId: hospital.whatsapp_phone_number_id,
    message,
    episodeId,
    hospitalId: hospital.id,
    patientId: patient.id,
    metadata: {
      kind: CARE_PLAN_KIND,
      summary_id: summary.id,
      ...(params.resend ? { resend: true, trigger: params.trigger ?? 'nurse' } : {}),
    },
  })
}

export interface CarePlanDelivery {
  messageId: string
  status: string
  error: string | null
  errorCode: number | null
  createdAt: string
  resend: boolean
}

/** The most recent care-plan message on a conversation, as logged — null when none was ever sent. */
export async function latestCarePlanMessage(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<CarePlanDelivery | null> {
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id, status, metadata, created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'outbound')
    .eq('metadata->>kind', CARE_PLAN_KIND)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return summariseCarePlanMessage(data as { id: string; status: string; metadata: Record<string, unknown> | null; created_at: string })
}

/** Same shape from a transcript row already in hand (the episode page has them loaded). */
export function summariseCarePlanMessage(m: { id: string; status: string; metadata: Record<string, unknown> | null; created_at: string }): CarePlanDelivery {
  const meta = m.metadata ?? {}
  return {
    messageId: m.id,
    status: m.status,
    error: typeof meta.error === 'string' ? meta.error : null,
    errorCode: typeof meta.error_code === 'number' ? meta.error_code : null,
    createdAt: m.created_at,
    resend: meta.resend === true,
  }
}

export interface RedeliverParams {
  supabase: SupabaseClient
  conversationId: string
  episodeId: string
  hospital: CarePlanHospital
  patient: CarePlanPatient
}

/**
 * Called when a patient's message arrives. If the last care plan we sent them
 * never got through (WhatsApp's 24-hour window, sandbox not joined, …), that
 * message has just made delivery possible — so the plan goes out again now,
 * without a nurse having to notice. At most one attempt per inbound message.
 */
export async function redeliverFailedCarePlan(params: RedeliverParams): Promise<boolean> {
  const { supabase, conversationId, episodeId, hospital, patient } = params

  const last = await latestCarePlanMessage(supabase, conversationId)
  if (!last || last.status !== 'failed') return false

  const { data: summary } = await supabase
    .from('discharge_summaries')
    .select('*')
    .eq('episode_id', episodeId)
    .in('status', ['approved', 'sent'])
    .maybeSingle()
  if (!summary) return false

  const result = await sendCarePlan({
    serviceClient: supabase,
    episodeId,
    summary: summary as SendCarePlanParams['summary'],
    patient,
    hospital,
    resend: true,
    trigger: 'patient_message',
  })

  if (result.status !== 'success') {
    console.warn(`[care-plan] automatic re-send failed for episode ${episodeId}: ${result.error}`)
    return false
  }

  await supabase.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: hospital.id,
    event_type: 'summary_sent',
    payload: { summary_id: summary.id, wa_message_id: result.messageId, resend: true, trigger: 'patient_message', previous_message_id: last.messageId },
  })
  // The nurse no longer needs to chase this one. (Only the dedicated alert
  // type: an 'escalation' raised for a symptom in the meantime must stay open.)
  await supabase
    .from('alerts')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('episode_id', episodeId)
    .eq('status', 'open')
    .eq('type', 'delivery_failed')
  console.info(`[care-plan] re-sent to ${patient.full_name} after their message (episode ${episodeId})`)
  return true
}
