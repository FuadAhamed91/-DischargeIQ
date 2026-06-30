/**
 * Outbound message builders for each patient-facing scenario.
 *
 * These functions return OutboundMessage objects ready to pass to sendMessage().
 * Template names here must match what you register in the Meta Business Suite.
 *
 * During development you can switch any template to a plain text() fallback by
 * toggling USE_TEXT_FALLBACK = true (useful before templates are approved).
 */

import type {
  OutboundMessage,
  InteractiveButtonMessage,
  InteractiveListMessage,
} from './client'
import type { LanguageCode } from '@/types/enums'
import type { DischargeSummary, Medication, Appointment } from '@/types/database'

// Set to true to send plain text instead of template messages while Meta reviews them.
const USE_TEXT_FALLBACK = process.env.WHATSAPP_USE_TEXT_FALLBACK === 'true'

// ------------------------------------
// Language helpers
// ------------------------------------

const LANG_MAP: Record<LanguageCode, string> = {
  en: 'en_US',
  ar: 'ar',
  hi: 'hi',
  ta: 'ta',
  tl: 'fil',
}

// ------------------------------------
// Discharge summary delivery
// ------------------------------------

/**
 * Builds the initial discharge instructions message sent to the patient
 * after a nurse approves the summary.
 */
export function buildDischargeSummaryMessage(params: {
  to: string
  patientName: string
  hospitalName: string
  language: LanguageCode
  summary: DischargeSummary
  medications: Medication[]
}): OutboundMessage {
  const { to, patientName, hospitalName, language, summary, medications } = params

  if (USE_TEXT_FALLBACK) {
    const medList = medications
      .map((m) => `• ${m.name} ${m.dosage} — ${m.frequency}`)
      .join('\n')

    const warnings = summary.emergency_symptoms.slice(0, 3).join(', ')

    return {
      type: 'text',
      to,
      body: [
        `Hello ${patientName} 👋`,
        `Your discharge instructions from *${hospitalName}* are ready.`,
        '',
        medications.length
          ? `*💊 Medications:*\n${medList}`
          : '',
        summary.lifestyle_instructions.length
          ? `*📋 Instructions:*\n${summary.lifestyle_instructions.slice(0, 3).map((i) => `• ${i}`).join('\n')}`
          : '',
        warnings
          ? `*🚨 Contact emergency services if you experience:* ${warnings}`
          : '',
        '',
        'Reply with any questions. We are here to help. 🩺',
      ].filter(Boolean).join('\n'),
    }
  }

  return {
    type: 'template',
    to,
    templateName: 'discharge_instructions_v1',
    languageCode: LANG_MAP[language] ?? 'en_US',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: patientName },
          { type: 'text', text: hospitalName },
          { type: 'text', text: medications.slice(0, 2).map((m) => m.name).join(', ') || 'See instructions' },
        ],
      },
    ],
  }
}

// ------------------------------------
// Appointment confirmation
// ------------------------------------

export function buildAppointmentConfirmationRequest(params: {
  to: string
  patientName: string
  language: LanguageCode
  appointment: Appointment
}): OutboundMessage {
  const { to, patientName, appointment } = params

  const date = new Date(appointment.scheduled_at)
  const dateStr = date.toLocaleDateString('en-GB', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
  const timeStr = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

  // Plain text for Twilio — patient replies "1" to confirm or "2" to reschedule
  return {
    type: 'text',
    to,
    body: `Hi ${patientName},\n\nYour *${appointment.specialty}* follow-up appointment is scheduled for:\n📅 *${dateStr}* at *${timeStr}*\n📍 ${appointment.location ?? 'Hospital main clinic'}\n\nReply *1* to confirm ✅\nReply *2* to reschedule 🔄`,
  }
}

// ------------------------------------
// Appointment slot selection
// ------------------------------------

export function buildSlotSelectionMessage(params: {
  to: string
  specialty: string
  slots: Array<{ id: string; datetime: string; location?: string }>
}): InteractiveListMessage {
  const { to, specialty, slots } = params

  const rows = slots.slice(0, 10).map((s) => {
    const d = new Date(s.datetime)
    const title = d.toLocaleDateString('en-GB', {
      weekday: 'short', month: 'short', day: 'numeric',
    })
    const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    return {
      id: `slot_${s.id}`,
      title: `${title} ${time}`,
      description: s.location ?? undefined,
    }
  })

  return {
    type: 'interactive_list',
    to,
    header: `📅 ${specialty} — Available Slots`,
    body: 'Please select a new appointment time that works for you:',
    footer: 'Slots are subject to availability',
    buttonText: 'View slots',
    sections: [{ title: 'Available times', rows }],
  }
}

// ------------------------------------
// Reminders
// ------------------------------------

export function buildMedicationReminder(params: {
  to: string
  patientName: string
  language: LanguageCode
  medication: Medication
}): OutboundMessage {
  const { to, patientName, medication } = params

  if (USE_TEXT_FALLBACK) {
    return {
      type: 'text',
      to,
      body: `💊 *Medication reminder*, ${patientName}\n\nTime to take your *${medication.name}* (${medication.dosage}).\n\n${medication.instructions ?? ''}\n\nReply *TAKEN* once done.`,
    }
  }

  return {
    type: 'template',
    to,
    templateName: 'medication_reminder_v1',
    languageCode: 'en_US',
    components: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: patientName },
          { type: 'text', text: medication.name },
          { type: 'text', text: medication.dosage },
        ],
      },
    ],
  }
}

export function buildSymptomCheckReminder(params: {
  to: string
  patientName: string
  language: LanguageCode
}): OutboundMessage {
  const { to, patientName } = params

  // Plain text for Twilio — patient replies "1" for OK or "2" for concern
  return {
    type: 'text',
    to,
    body: `Hi ${patientName} 👋\n\nHow are you feeling today?\n\nReply *1* if you are feeling good 😊\nReply *2* if you have a concern 😟\n\nOr send us a *voice note* and our care team will review it. 💙`,
  }
}

export function buildGeneralReminder(params: {
  to: string
  patientName: string
  reminderType: string
  language: LanguageCode
}): OutboundMessage {
  const { to, patientName, reminderType } = params

  const msgMap: Record<string, string> = {
    exercise: `🏃 *Exercise reminder*, ${patientName}\n\nTime for your recommended light exercise. Gentle walking or stretching as advised by your care team. Stay hydrated! 💧`,
    hydration: `💧 *Hydration reminder*, ${patientName}\n\nRemember to drink water regularly throughout the day as recommended.`,
    appointment: `📅 *Appointment reminder*, ${patientName}\n\nYou have an upcoming appointment. Please check your schedule and confirm attendance.`,
  }

  return {
    type: 'text',
    to,
    body: msgMap[reminderType] ?? `Reminder from your care team, ${patientName}. Please follow your discharge instructions.`,
  }
}

// ------------------------------------
// System / error messages
// ------------------------------------

export function buildNotRegisteredMessage(to: string): OutboundMessage {
  return {
    type: 'text',
    to,
    body: `Hello 👋\n\nWe could not find an active care record for this number.\n\nIf you believe this is an error, please contact the hospital directly.`,
  }
}

export function buildEscalationAcknowledgement(params: {
  to: string
  patientName: string
}): OutboundMessage {
  return {
    type: 'text',
    to: params.to,
    body: `Hi ${params.patientName},\n\nThank you for reaching out. 💙\n\nYour message has been received and a member of your care team will review it shortly.\n\nIf this is a *medical emergency*, please call emergency services immediately.`,
  }
}
