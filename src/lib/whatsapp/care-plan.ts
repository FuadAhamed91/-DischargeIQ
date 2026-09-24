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
import { savedSummaryContent, storeSummaryTranslation, summarySourceHash, translateSummary } from '@/lib/ai/translation'
import type { SavedSummary, StoredSummaryTranslation } from '@/lib/ai/translation'
import type { ExtractionResult } from '@/lib/ai/extraction'
import type { FollowUpRequirement, Medication } from '@/types/database'
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
  /**
   * How long the send may wait to translate the plan into the patient's
   * language when no stored translation was made from the content being sent
   * (a nurse edited it, or the letter's translation never finished). 0, the
   * default: do not translate now — a re-send triggered by the patient's own
   * message must not hold up the reply to it.
   */
  translateWithinMs?: number
}

/** Loads medications, appointments and the plan in the patient's language (translationOfPlan), builds the message, sends and logs it. */
export async function sendCarePlan(params: SendCarePlanParams): Promise<SendAndLogResult> {
  const { serviceClient, episodeId, summary, patient, hospital } = params
  const language = ((patient.preferred_language as LanguageCode | null) ?? 'en') as LanguageCode
  const translate = language !== (summary.source_language ?? 'en')

  const [{ data: medications }, { data: appointments }, { data: followUps }, { data: stored }] = await Promise.all([
    serviceClient.from('medications').select('*').eq('summary_id', summary.id).order('sort_order'),
    serviceClient
      .from('appointments')
      .select('specialty, scheduled_at, location, time_tbc, status')
      .eq('episode_id', episodeId)
      .in('status', ['scheduled', 'confirmation_pending', 'confirmed'])
      .order('scheduled_at', { ascending: true }),
    translate
      ? serviceClient.from('follow_up_requirements').select('specialty, deadline, instructions').eq('summary_id', summary.id)
      : Promise.resolve({ data: [] as FollowUpRequirement[] }),
    translate
      ? serviceClient.from('discharge_summary_translations').select('content').eq('summary_id', summary.id).eq('language', language).maybeSingle()
      : Promise.resolve({ data: null as { content: unknown } | null }),
  ])

  let translation: CarePlanTranslation | null = null
  if (translate) {
    const content = savedSummaryContent(summary as unknown as SavedSummary, (medications ?? []) as Medication[], (followUps ?? []) as FollowUpRequirement[])
    translation = await translationOfPlan({
      serviceClient,
      summaryId: summary.id,
      content,
      language,
      stored: stored?.content ?? null,
      withinMs: params.translateWithinMs ?? 0,
    })
  }

  const message = buildDischargeSummaryMessage({
    to: patient.phone,
    patientName: patient.full_name,
    hospitalName: hospital.name,
    language,
    summary: summary as unknown as Parameters<typeof buildDischargeSummaryMessage>[0]['summary'],
    medications: (medications ?? []) as Parameters<typeof buildDischargeSummaryMessage>[0]['medications'],
    appointments: (appointments ?? []) as CarePlanAppointment[],
    timezone: hospital.timezone ?? 'Asia/Dubai',
    translation,
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

/**
 * The plan in the patient's language, translated from exactly the content
 * being sent. A stored translation counts only when it was made from this
 * same text: a nurse may have corrected a dose or a warning sign since the
 * letter was read. Otherwise the plan is translated now, if the caller gave
 * it time, and stored for a resend. Null when there is no such translation:
 * the content then goes out as written under the patient's own headings,
 * never as a translation of something else.
 */
async function translationOfPlan(p: {
  serviceClient: SupabaseClient
  summaryId: string
  content: ExtractionResult
  language: LanguageCode
  stored: unknown
  withinMs: number
}): Promise<CarePlanTranslation | null> {
  const sourceHash = summarySourceHash(p.content)
  const stored = p.stored as Partial<StoredSummaryTranslation> | null
  if (stored?.source_hash === sourceHash) return stored
  if (p.withinMs <= 0) return null

  // The nurse is waiting: no thinking step, and a retry only while there is time for one.
  const work = translateSummary(p.content, p.language, p.content.source_language as LanguageCode, {
    budgetMs: Math.max(p.withinMs - 5_000, 1_000),
    noThinking: true,
  }).then(async (translated) => {
    // Kept for a resend, even when it arrives too late for this send.
    await storeSummaryTranslation(p.serviceClient, p.summaryId, p.language, { ...translated, source_hash: sourceHash })
      .catch((err) => console.error(`[care-plan] translation of summary ${p.summaryId} (${p.language}) could not be stored:`, err))
    return translated
  })
  try {
    return await within(p.withinMs, work)
  } catch (err) {
    console.warn(`[care-plan] no ${p.language} translation of summary ${p.summaryId}, sending the plan as written: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** `promise`, or a rejection once `ms` have passed (the work itself carries on). */
function within<T>(ms: number, promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`not ready within ${ms} ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
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

  // No translateWithinMs: the patient's own message (an emergency, perhaps) is waiting for its reply.
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
