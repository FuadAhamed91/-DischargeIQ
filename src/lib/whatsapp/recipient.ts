/**
 * Who is on the other end of an inbound WhatsApp message.
 *
 * One hospital number serves every patient of that hospital, so the sender's
 * phone number is the only thing that identifies them — and it is not unique.
 * A family shares one phone, a daughter writes for both parents, a tester
 * registers three demo patients on their own number. Resolution therefore
 * returns *every* open episode behind a number; the handler decides which
 * one a message is about.
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

/** One open episode reachable from a phone number, with the patient it belongs to. */
export interface OpenEpisodeCandidate {
  episode: InboundEpisode & { created_at: string }
  patient: InboundPatient
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

/** A patient registered with a number, whatever the state of their episodes. */
export interface PatientOnNumber {
  full_name: string
  preferred_language: LanguageCode
}

/** The patients registered with this number at this hospital (empty: an unknown number). */
export async function patientsOnNumber(
  supabase: ServiceClient,
  hospitalId: string,
  phone: string,
): Promise<PatientOnNumber[]> {
  const { data } = await supabase
    .from('patients')
    .select('full_name, preferred_language')
    .eq('hospital_id', hospitalId)
    .eq('phone_e164', phone)
    .order('full_name')
  return (data ?? []) as PatientOnNumber[]
}

interface OpenEpisodeRow {
  id: string
  status: string
  created_at: string
  patients: InboundPatient | InboundPatient[] | null
}

/**
 * Every open episode (active, or approved but not yet sent) whose patient is
 * registered with this number at this hospital — newest first. A patient has
 * at most one open episode, so each entry is a different patient.
 */
export async function findOpenEpisodesByPhone(
  supabase: ServiceClient,
  hospitalId: string,
  phone: string,
): Promise<OpenEpisodeCandidate[]> {
  const { data, error } = await supabase
    .from('care_episodes')
    .select('id, status, created_at, patients!inner(id, full_name, preferred_language, hospital_id)')
    .eq('hospital_id', hospitalId)
    .eq('patients.phone_e164', phone)
    .in('status', ['active', 'pending_review'])
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[WhatsApp] open-episode lookup failed:', error.message)
    return []
  }
  const rows = (data ?? []) as unknown as OpenEpisodeRow[]
  const candidates: OpenEpisodeCandidate[] = []
  for (const row of rows) {
    // patients is a many-to-one embed, but be tolerant of the array shape.
    const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients
    if (!patient) continue
    candidates.push({
      episode: { id: row.id, status: row.status, created_at: row.created_at },
      patient,
    })
  }
  return candidates
}

export interface InboundConversation {
  id: string
  conversation_state: unknown
}

/**
 * The conversation a message lands on — one per episode (UNIQUE). A single
 * upsert on episode_id replaces the old select-then-insert, which two
 * simultaneous first messages could both fail (the second insert hit the
 * unique index and the message was dropped). Only the identity columns are
 * written, so an existing row keeps its conversation_state; wa_phone is
 * refreshed to the number the patient is actually writing from.
 */
export async function getOrCreateConversation(
  supabase: ServiceClient,
  params: { episodeId: string; hospitalId: string; patientId: string; phone: string },
): Promise<InboundConversation | null> {
  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .upsert(
      {
        episode_id: params.episodeId,
        hospital_id: params.hospitalId,
        patient_id: params.patientId,
        wa_phone: params.phone,
      },
      { onConflict: 'episode_id' },
    )
    .select('id, conversation_state')
    .single()
  if (error || !data) {
    console.error('[WhatsApp] could not get or create conversation:', error?.message)
    return null
  }
  return data as InboundConversation
}
