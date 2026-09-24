/**
 * "Reply 2 to change the date": the patient is offered times, answers with a
 * number (or types one of the dates), and the appointment moves there,
 * confirmed. The appointment row and an appointment_rescheduled timeline
 * event are what the dashboard shows, live. "None of these", or a date that
 * is not on the list, goes to a nurse with an alert. Anything else they
 * write meanwhile is answered by the assistant as usual (lib/whatsapp/fsm.ts)
 * and the times stay on offer.
 *
 * What was offered is kept in appointment_slots_cache (one row per episode),
 * so a reply is read against exactly the list the patient saw.
 */

import type { ServiceClient, InboundHospital } from './recipient'
import type { OutboundMessage } from './client'
import type { ConversationState } from './fsm'
import type { LanguageCode } from '@/types/enums'
import type { AppointmentSlot } from '@/types/database'
import { proposeSlots, resolveClinicDays, interpretSlotReply } from '@/lib/appointments/slots'
import {
  buildRescheduleOptions,
  buildRescheduleNurseReply,
  buildAppointmentConfirmedReply,
  buildNoPendingAppointmentReply,
} from './appointment-templates'

export interface RescheduleAppointment {
  id: string
  specialty: string
  scheduled_at: string
  location: string | null
}

export interface RescheduleContext {
  supabase: ServiceClient
  hospital: InboundHospital
  episodeId: string
  patient: { full_name: string; language: LanguageCode; to: string }
  reply: (outbound: OutboundMessage) => Promise<unknown>
  waMessageId: string
  now?: Date
}

/** A time chosen closer than this is treated as gone: fresh times are offered. */
const MIN_NOTICE_MS = 60 * 60 * 1000

const timezoneOf = (ctx: RescheduleContext) => ctx.hospital.timezone ?? 'Asia/Dubai'

async function clearOffer(supabase: ServiceClient, episodeId: string): Promise<void> {
  await supabase.from('appointment_slots_cache').delete().eq('episode_id', episodeId)
}

async function loadOffer(supabase: ServiceClient, episodeId: string): Promise<{ appointmentId: string; slots: string[] } | null> {
  const { data } = await supabase
    .from('appointment_slots_cache')
    .select('slots')
    .eq('episode_id', episodeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const slots = ((data?.slots ?? []) as AppointmentSlot[]).filter((s) => typeof s?.datetime === 'string')
  const appointmentId = slots[0]?.appointment_id
  if (!appointmentId) return null
  return { appointmentId, slots: slots.map((s) => s.datetime) }
}

async function loadAppointment(supabase: ServiceClient, id: string): Promise<(RescheduleAppointment & { status: string }) | null> {
  const { data } = await supabase
    .from('appointments')
    .select('id, specialty, scheduled_at, location, status')
    .eq('id', id)
    .maybeSingle()
  return (data as (RescheduleAppointment & { status: string }) | null) ?? null
}

/** The patient is told a nurse will arrange a time; one open alert per episode, as the nightly unconfirmed-appointment job does. */
async function handToNurse(ctx: RescheduleContext, appointment: RescheduleAppointment): Promise<void> {
  const { supabase, hospital, episodeId, patient } = ctx
  await ctx.reply(buildRescheduleNurseReply({ to: patient.to, patientName: patient.full_name, language: patient.language, specialty: appointment.specialty }))
  const { count } = await supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('episode_id', episodeId)
    .eq('type', 'unconfirmed_appointment')
    .eq('status', 'open')
  if (!count) {
    await supabase.from('alerts').insert({ episode_id: episodeId, hospital_id: hospital.id, type: 'unconfirmed_appointment', severity: 'medium', status: 'open' })
  }
}

/**
 * Offers the next clinic days and remembers them; returns the state to wait
 * in. On a first offer ('offer') the appointment is marked as waiting for a
 * new time and the request goes on the timeline; 'passed' re-offers after
 * the chosen time has gone by. If the offer cannot be stored there is
 * nothing to read an answer against, so the patient goes to a nurse rather
 * than being asked for a number that could never be used.
 */
export async function offerNewTimes(
  ctx: RescheduleContext,
  appointment: RescheduleAppointment,
  intro: 'offer' | 'passed' = 'offer',
): Promise<ConversationState> {
  const { supabase, hospital, episodeId, patient } = ctx
  const timezone = timezoneOf(ctx)
  const slots = proposeSlots({
    current: appointment.scheduled_at,
    now: ctx.now ?? new Date(),
    timezone,
    clinicDays: resolveClinicDays(hospital.settings),
  })

  await clearOffer(supabase, episodeId)
  const { error } = await supabase.from('appointment_slots_cache').insert({
    hospital_id: hospital.id,
    episode_id: episodeId,
    slots: slots.map((datetime, i): AppointmentSlot => ({ id: String(i + 1), datetime, specialty: appointment.specialty, appointment_id: appointment.id })),
    expires_at: slots[slots.length - 1],
  })
  if (error) {
    console.error('[reschedule] could not store the times offered; handing to a nurse:', error.message)
    await handToNurse(ctx, appointment)
  } else {
    await ctx.reply(buildRescheduleOptions({
      to: patient.to,
      patientName: patient.full_name,
      language: patient.language,
      specialty: appointment.specialty,
      slots,
      timezone,
      intro,
    }))
  }

  if (intro === 'offer') {
    await supabase
      .from('appointments')
      .update({ status: 'reschedule_pending', updated_at: new Date().toISOString() })
      .eq('id', appointment.id)
    await supabase.from('patient_timeline_events').insert({
      episode_id: episodeId,
      hospital_id: hospital.id,
      event_type: 'appointment_rescheduled',
      payload: { appointment_id: appointment.id, specialty: appointment.specialty, requested_by: 'patient', offered: error ? null : slots, wa_message_id: ctx.waMessageId },
    })
  }
  return error ? 'idle' : 'awaiting_slot_selection'
}

/** The answer to the times offered. Returns the conversation state to move to. */
export async function handleSlotReply(ctx: RescheduleContext, text: string): Promise<ConversationState> {
  const { supabase, hospital, episodeId, patient } = ctx
  const now = ctx.now ?? new Date()
  const timezone = timezoneOf(ctx)
  const noPending = async () => {
    await clearOffer(supabase, episodeId)
    await ctx.reply(buildNoPendingAppointmentReply({ to: patient.to, patientName: patient.full_name, language: patient.language }))
    return 'idle' as const
  }

  const offer = await loadOffer(supabase, episodeId)
  if (!offer) {
    // Asked to change it before times were offered by message (or the offer
    // was lost): offer them now and read the next reply against them.
    const { data: waiting } = await supabase
      .from('appointments')
      .select('id, specialty, scheduled_at, location')
      .eq('episode_id', episodeId)
      .eq('status', 'reschedule_pending')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!waiting) return noPending()
    return offerNewTimes(ctx, waiting as RescheduleAppointment)
  }

  // A nurse confirmed, moved or cancelled it in the meantime.
  const appointment = await loadAppointment(supabase, offer.appointmentId)
  if (!appointment || appointment.status !== 'reschedule_pending') return noPending()

  const choice = interpretSlotReply(text, offer.slots, timezone)
  switch (choice.kind) {
    case 'invalid': {
      await ctx.reply(buildRescheduleOptions({
        to: patient.to,
        patientName: patient.full_name,
        language: patient.language,
        specialty: appointment.specialty,
        slots: offer.slots,
        timezone,
        intro: 'again',
      }))
      return 'awaiting_slot_selection'
    }

    case 'slot': {
      const at = offer.slots[choice.index]
      if (Date.parse(at) - now.getTime() < MIN_NOTICE_MS) return offerNewTimes(ctx, appointment, 'passed')
      const stamp = now.toISOString()
      await supabase
        .from('appointments')
        .update({ scheduled_at: at, status: 'confirmed', confirmed_at: stamp, updated_at: stamp })
        .eq('id', appointment.id)
      await clearOffer(supabase, episodeId)
      await ctx.reply(buildAppointmentConfirmedReply({
        to: patient.to,
        patientName: patient.full_name,
        language: patient.language,
        appointment: { ...appointment, scheduled_at: at },
        timezone,
      }))
      await supabase.from('patient_timeline_events').insert({
        episode_id: episodeId,
        hospital_id: hospital.id,
        event_type: 'appointment_rescheduled',
        payload: { appointment_id: appointment.id, specialty: appointment.specialty, from: appointment.scheduled_at, to: at, chosen_by: 'patient', wa_message_id: ctx.waMessageId },
      })
      return 'idle'
    }

    case 'none':
    case 'preference': {
      await clearOffer(supabase, episodeId)
      await handToNurse(ctx, appointment)
      await supabase.from('patient_timeline_events').insert({
        episode_id: episodeId,
        hospital_id: hospital.id,
        event_type: 'appointment_rescheduled',
        payload: {
          appointment_id: appointment.id,
          specialty: appointment.specialty,
          requested_by: 'patient',
          none_suit: true,
          preference: choice.kind === 'preference' ? choice.text : null,
          wa_message_id: ctx.waMessageId,
        },
      })
      return 'idle'
    }
  }
}
