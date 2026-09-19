/**
 * Reminder dispatcher.
 *
 * Runs every 5 minutes (via cron) to send all due `reminder_jobs`
 * that have `status = 'pending'` and `fire_at <= now`.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { sendMessage } from '@/lib/whatsapp/client'
import {
  buildMedicationReminder,
  buildSymptomCheckReminder,
  buildGeneralReminder,
} from '@/lib/whatsapp/templates'
import type { LanguageCode } from '@/types/enums'

interface DispatchResult {
  sent: number
  failed: number
  errors: string[]
}

export async function dispatchDueReminders(): Promise<DispatchResult> {
  const supabase = await createServiceClient()
  const result: DispatchResult = { sent: 0, failed: 0, errors: [] }

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
        hospitals!inner(whatsapp_phone_number_id)
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

  for (const job of jobs) {
    try {
      const episode = job.care_episodes as unknown as {
        patient_id: string
        status: string
        patients: { full_name: string; phone_e164: string; preferred_language: string }
        hospitals: { whatsapp_phone_number_id: string | null }
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

      const lang = (patient.preferred_language as LanguageCode) ?? 'en'

      // Build the message based on reminder type
      let message
      if (schedule.type === 'medication' && schedule.medications) {
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
      } else if (schedule.type === 'symptom_check') {
        message = buildSymptomCheckReminder({
          to: patient.phone_e164,
          patientName: patient.full_name,
          language: lang,
        })
      } else {
        message = buildGeneralReminder({
          to: patient.phone_e164,
          patientName: patient.full_name,
          reminderType: schedule.type,
          language: lang,
        })
      }

      // Send via WhatsApp
      const sendResult = await sendMessage(hospital.whatsapp_phone_number_id, message)

      if (sendResult.status === 'failed') {
        await supabase
          .from('reminder_jobs')
          .update({ status: 'failed' })
          .eq('id', job.id)

        result.errors.push(`Job ${job.id}: ${sendResult.error}`)
        result.failed++
        continue
      }

      // Mark job as sent
      await supabase
        .from('reminder_jobs')
        .update({
          status: 'sent',
          whatsapp_message_id: sendResult.messageId,
        })
        .eq('id', job.id)

      // Put the conversation into awaiting_reminder_response so the patient's
      // "TAKEN"/"YES" reply is logged as a reminder response by the FSM rather
      // than routed to AI Q&A. The row normally exists already (created by the
      // episode-activation trigger); upsert covers episodes activated by hand.
      const { data: conversation, error: convErr } = await supabase
        .from('whatsapp_conversations')
        .upsert({
          episode_id: job.episode_id,
          hospital_id: job.hospital_id,
          patient_id: episode.patient_id,
          wa_phone: patient.phone_e164,
          conversation_state: 'awaiting_reminder_response',
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'episode_id' })
        .select('id')
        .single()

      if (convErr || !conversation) {
        console.error(`[dispatcher] conversation state update failed for job ${job.id}:`, convErr?.message)
      } else {
        // Log outbound message on the conversation
        const { error: msgErr } = await supabase.from('whatsapp_messages').insert({
          conversation_id: conversation.id,
          hospital_id: job.hospital_id,
          wa_message_id: sendResult.messageId,
          direction: 'outbound',
          message_type: 'text',
          content: `${schedule.type} reminder`,
          status: 'sent',
        })
        if (msgErr) console.error(`[dispatcher] outbound message log failed for job ${job.id}:`, msgErr.message)
      }

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
