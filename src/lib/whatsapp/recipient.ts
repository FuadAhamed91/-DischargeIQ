/**
 * Who is on the other end of an inbound WhatsApp message.
 *
 * One hospital number serves every patient of that hospital, so the sender's
 * phone number is the only thing that identifies them. Resolution is kept
 * apart from the webhook handler so the lookups can be reasoned about (and
 * changed) without touching the message actions.
 */

import type { createServiceClient } from '@/lib/supabase/server'
import type { LanguageCode } from '@/types/enums'

export type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>

export interface InboundHospital {
  id: string
  name: string
  timezone: string | null
  settings: Record<string, unknown> | null
}

export interface InboundPatient {
  id: string
  full_name: string
  preferred_language: LanguageCode
  hospital_id: string
}

export interface InboundEpisode {
  id: string
  status: string
}

/** The hospital a message was sent to: Twilio's "To" number, E.164 without the whatsapp: prefix. */
export async function resolveHospital(
  supabase: ServiceClient,
  phoneNumberId: string,
): Promise<InboundHospital | null> {
  const { data } = await supabase
    .from('hospitals')
    .select('id, name, timezone, settings')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .single()
  return (data as InboundHospital | null) ?? null
}

/** The patient registered with this number at this hospital. */
export async function resolvePatient(
  supabase: ServiceClient,
  hospitalId: string,
  phone: string,
): Promise<InboundPatient | null> {
  const { data } = await supabase
    .from('patients')
    .select('id, full_name, preferred_language, hospital_id')
    .eq('hospital_id', hospitalId)
    .eq('phone_e164', phone)
    .single()
  return (data as InboundPatient | null) ?? null
}

/** The patient's open episode (active, or approved but not yet sent), newest first. */
export async function resolveOpenEpisode(
  supabase: ServiceClient,
  hospitalId: string,
  patientId: string,
): Promise<InboundEpisode | null> {
  const { data } = await supabase
    .from('care_episodes')
    .select('id, status')
    .eq('patient_id', patientId)
    .eq('hospital_id', hospitalId)
    .in('status', ['active', 'pending_review'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  return (data as InboundEpisode | null) ?? null
}
