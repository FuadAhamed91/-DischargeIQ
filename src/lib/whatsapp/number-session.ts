/**
 * Persistence for the per-number routing session (whatsapp_number_sessions,
 * migration 00011): which patient a shared number is writing about, and
 * whether the sender is being asked to say so.
 *
 * Only the webhook handler writes here. A number with a single open episode
 * never gets a row — the session is read but stays empty.
 */

import type { NumberSession, PendingChoice } from './routing'
import { EMPTY_SESSION, CHOICE_TTL_MS, sessionAfterDelivery } from './routing'
import { findOpenEpisodesByPhone } from './recipient'
import type { ServiceClient } from './recipient'

interface SessionRow {
  active_patient_id: string | null
  active_until: string | null
  pending_choice: PendingChoice | null
}

export async function loadNumberSession(
  supabase: ServiceClient,
  hospitalId: string,
  phone: string,
): Promise<NumberSession> {
  const { data, error } = await supabase
    .from('whatsapp_number_sessions')
    .select('active_patient_id, active_until, pending_choice')
    .eq('hospital_id', hospitalId)
    .eq('wa_phone', phone)
    .maybeSingle()
  if (error) {
    // A missing table (migration not applied yet) must not break inbound
    // handling: behave as if nothing is remembered.
    console.error('[WhatsApp] number session read failed:', error.message)
    return EMPTY_SESSION
  }
  if (!data) return EMPTY_SESSION
  const row = data as SessionRow
  return {
    activePatientId: row.active_patient_id,
    activeUntil: row.active_until,
    pendingChoice: isPendingChoice(row.pending_choice) ? row.pending_choice : null,
  }
}

export async function saveNumberSession(
  supabase: ServiceClient,
  hospitalId: string,
  phone: string,
  session: NumberSession,
): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_number_sessions')
    .upsert(
      {
        hospital_id: hospitalId,
        wa_phone: phone,
        active_patient_id: session.activePatientId,
        active_until: session.activeUntil,
        pending_choice: session.pendingChoice,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'hospital_id,wa_phone' },
    )
  if (error) console.error('[WhatsApp] number session write failed:', error.message)
}

/**
 * The hospital just wrote to this patient (nurse chat, an appointment to
 * confirm): on a shared number they become the one the next unaddressed
 * reply is about. A number with one open episode gets no row.
 */
export async function rememberPatientIfShared(
  supabase: ServiceClient,
  params: { hospitalId: string; phone: string; patientId: string; patientName: string; episodeId: string },
): Promise<boolean> {
  const open = await findOpenEpisodesByPhone(supabase, params.hospitalId, params.phone)
  if (open.length < 2) return false
  await saveNumberSession(supabase, params.hospitalId, params.phone, sessionAfterDelivery({
    patientId: params.patientId,
    patientName: params.patientName,
    episodeId: params.episodeId,
    language: 'en',
    state: 'idle',
  }))
  return true
}

function isPendingChoice(value: unknown): value is PendingChoice {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<PendingChoice>
  return Array.isArray(v.options) && typeof v.askedAt === 'string'
}

/** Sessions untouched for this long are dropped by the nightly housekeeping. */
export const STALE_SESSION_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Forget sessions nobody has used for a week: the memory expired days ago
 * and any pending question with it. Called from the daily reminder
 * generator; returns how many rows went.
 */
export async function pruneStaleNumberSessions(supabase: ServiceClient, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_SESSION_MS).toISOString()
  const { data, error } = await supabase
    .from('whatsapp_number_sessions')
    .delete()
    .lt('updated_at', cutoff)
    .select('wa_phone')
  if (error) {
    console.error('[WhatsApp] number session housekeeping failed:', error.message)
    return 0
  }
  return (data ?? []).length
}

/** What the dashboard shows for a number: the remembered patient (expiry applied) and whether a question is open. */
export interface NumberSessionSummary {
  activePatientId: string | null
  choicePending: boolean
}

export function summariseNumberSession(
  row: { active_patient_id: string | null; active_until: string | null; pending_choice: unknown } | null,
  now: Date = new Date(),
): NumberSessionSummary | null {
  if (!row) return null
  const live = Boolean(row.active_until && Date.parse(row.active_until) > now.getTime())
  return {
    activePatientId: live ? row.active_patient_id : null,
    choicePending: isPendingChoice(row.pending_choice) && Date.parse(row.pending_choice.askedAt) + CHOICE_TTL_MS > now.getTime(),
  }
}
