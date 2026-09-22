/**
 * Reminder dispatcher.
 *
 * Runs every 5 minutes (via cron) to send all due `reminder_jobs`
 * that have `status = 'pending'` and `fire_at <= now`.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { sendAndLog } from '@/lib/whatsapp/outbound'
import {
  buildMedicationReminder,
  buildGeneralReminder,
} from '@/lib/whatsapp/templates'
import { buildNightlyCheckinMessage } from '@/lib/whatsapp/checkin-templates'
import type { ConversationState } from '@/lib/whatsapp/fsm'
import type { LanguageCode } from '@/types/enums'
import { holdReason } from './stagger'
import type { PhoneConversation } from './stagger'
import { rememberPatientIfShared } from '@/lib/whatsapp/number-session'

interface DispatchResult {
  sent: number
  failed: number
  /** Left pending for a later tick: another patient on the same number is still being asked something. */
  held: number
  errors: string[]
}

export async function dispatchDueReminders(): Promise<DispatchResult> {
  const supabase = await createServiceClient()
  const result: DispatchResult = { sent: 0, failed: 0, held: 0, errors: [] }

  // Fetch all pending jobs that are due
  const { data: jobs, error } = await supabase
    .from('reminder_jobs')
    .select(`
      id,
      schedule_id,
      episode_id,
      hospital_id,
      fire_at,
      reminder_schedules!inner(
        type,
        medication_id,
        medications(name, dosage, instructions)
      ),
      care_episodes!inner(
        patient_id,
        status,
        patients!inner(full_name, phone_e164, preferred_language),
        hospitals!inner(whatsapp_phone_number_id, name)
      )
    `)
    .eq('status', 'pending')
    .lte('fire_at', new Date().toISOString())
    .limit(100)  // Process max 100 per run to avoid timeout

  if (error) {
    result.errors.push(`Failed to load jobs: ${error.message}`)
    return result
  }

  if (!jobs || jobs.length === 0) return result

  // Shared numbers: one open question per phone. Every conversation on the
  // numbers in this batch, in one query, so a job can be held while another
  // patient on the same phone is still answering (see stagger.ts).
  const phones = [...new Set(jobs.map((j) => (j.care_episodes as unknown as { patients: { phone_e164: string } }).patients.phone_e164))]
  const { data: phoneConversations } = await supabase
    .from('whatsapp_conversations')
    .select('episode_id, wa_phone, conversation_state')
    .in('wa_phone', phones)
  const conversations = (phoneConversations ?? []) as PhoneConversation[]
  const sentThisRun = new Set<string>()

  for (const job of jobs) {
    try {
      const episode = job.care_episodes as unknown as {
        patient_id: string
        status: string
        patients: { full_name: string; phone_e164: string; preferred_language: string }
        hospitals: { whatsapp_phone_number_id: string | null; name: string }
      }

      const schedule = job.reminder_schedules as unknown as {
        type: string
        medication_id: string | null
        medications: { name: string; dosage: string; instructions: string | null } | null
      }

      const patient = episode.patients
      const hospital = episode.hospitals

      // Skip if episode is no longer active
      if (episode.status !== 'active') {
        await supabase
          .from('reminder_jobs')
          .update({ status: 'cancelled' })
          .eq('id', job.id)
        result.failed++
        continue
      }

      if (!hospital.whatsapp_phone_number_id) {
        result.errors.push(`Job ${job.id}: hospital missing WhatsApp phone_number_id`)
        result.failed++
        continue
      }

      // Another patient on this phone is mid-question: send this one next tick.
      const hold = holdReason({ episodeId: job.episode_id, phone: patient.phone_e164, fireAt: job.fire_at as string }, conversations, sentThisRun)
      if (hold) {
        result.held++
        continue
      }

      const lang = (patient.preferred_language as LanguageCode) ?? 'en'

      // Build the message based on reminder type. The nightly check-in opens a
      // two-question conversation (medicines, then symptoms); legacy per-dose
      // reminders expect a TAKEN-style reply.
      let message
      let nextState: ConversationState = 'awaiting_reminder_response'
      if (schedule.type === 'symptom_check') {
        message = buildNightlyCheckinMessage({
          to: patient.phone_e164,
          patientName: patient.full_name,
          hospitalName: hospital.name,
          language: lang,
        })
        nextState = 'awaiting_checkin_meds'
      } else if (schedule.type === 'medication' && schedule.medications) {
        message = buildMedicationReminder({
          to: patient.phone_e164,
          patientName: patient.full_name,
          language: lang,
          medication: {
            ...schedule.medications,
            id: schedule.medication_id ?? '',
            summary_id: '',
            hospital_id: job.hospital_id,
            frequency: '',
            reminder_times: [],
            sort_order: 0,
            created_at: '',
          },
        })
      } else {
        message = buildGeneralReminder({
          to: patient.phone_e164,
          patientName: patient.full_name,
          reminderType: schedule.type,
          language: lang,
        })
      }

      // Send via WhatsApp, log it on the conversation, and move the conversation
      // into the awaiting state so the reply is handled by the FSM rather than
      // routed to AI Q&A.
      const sendResult = await sendAndLog({
        supabase,
        phoneNumberId: hospital.whatsapp_phone_number_id ?? '',
        message,
        episodeId: job.episode_id,
        hospitalId: job.hospital_id,
        patientId: episode.patient_id,
        nextState,
      })

      if (sendResult.status === 'failed') {
        await supabase
          .from('reminder_jobs')
          .update({ status: 'failed' })
          .eq('id', job.id)

        result.errors.push(`Job ${job.id}: ${sendResult.error}`)
        result.failed++
        continue
      }

      sentThisRun.add(patient.phone_e164)

      // Shared number: tonight's question is theirs, so an unaddressed reply
      // (or a follow-up after the check-in is done) goes to them.
      await rememberPatientIfShared(supabase, {
        hospitalId: job.hospital_id,
        phone: patient.phone_e164,
        patientId: episode.patient_id,
        patientName: patient.full_name,
        episodeId: job.episode_id,
      })

      // Mark job as sent
      await supabase
        .from('reminder_jobs')
        .update({
          status: 'sent',
          whatsapp_message_id: sendResult.messageId,
        })
        .eq('id', job.id)

      // Timeline event
      await supabase.from('patient_timeline_events').insert({
        episode_id: job.episode_id,
        hospital_id: job.hospital_id,
        event_type: 'reminder_sent',
        payload: {
          job_id: job.id,
          reminder_type: schedule.type,
          wa_message_id: sendResult.messageId,
        },
      })

      result.sent++
    } catch (err) {
      result.errors.push(`Job ${job.id}: unexpected error — ${String(err)}`)
      result.failed++
      await supabase
        .from('reminder_jobs')
        .update({ status: 'failed' })
        .eq('id', job.id)
    }
  }

  return result
}
