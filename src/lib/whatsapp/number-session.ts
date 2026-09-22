/**
 * Persistence for the per-number routing session (whatsapp_number_sessions,
 * migration 00011): which patient a shared number is writing about, and
 * whether the sender is being asked to say so.
 *
 * Only the webhook handler writes here. A number with a single open episode
 * never gets a row — the session is read but stays empty.
 */

import type { NumberSession, PendingChoice } from './routing'
import { EMPTY_SESSION } from './routing'
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

function isPendingChoice(value: unknown): value is PendingChoice {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<PendingChoice>
  return Array.isArray(v.options) && typeof v.askedAt === 'string'
}
