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
  InteractiveListMessage,
} from './client'
import { formatInTimeZone } from 'date-fns-tz'
import type { LanguageCode } from '@/types/enums'
import type { DischargeSummary, Medication } from '@/types/database'

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

/** Appointment as it appears in the care plan message. */
export interface CarePlanAppointment {
  specialty: string
  scheduled_at: string
  location: string | null
  /** Provisional: scheduled_at is the letter's "by" date, no slot booked yet */
  time_tbc: boolean
}

/** Translated summary content (discharge_summary_translations.content), when the patient's language differs. */
export interface CarePlanTranslation {
  medications?: Array<{ name: string; dosage: string; frequency: string; instructions?: string }>
  follow_up_requirements?: Array<{ specialty: string; instructions: string | null }>
  emergency_symptoms?: string[]
  lifestyle_instructions?: string[]
}

const CARE_PLAN_STRINGS: Record<LanguageCode, {
  hello: (n: string) => string
  ready: (h: string) => string
  meds: string
  instructions: string
  appointments: string
  by: (d: string) => string
  warn: string
  close: string
}> = {
  en: {
    hello: (n) => `Hello ${n} 👋`,
    ready: (h) => `Your discharge instructions from *${h}* are ready.`,
    meds: '💊 Medications',
    instructions: '📋 Instructions',
    appointments: '📅 Follow-up appointments',
    by: (d) => `by ${d} (time to be confirmed — we will message you)`,
    warn: '🚨 Contact emergency services if you experience:',
    close: 'Reply with any questions. We are here to help. 🩺',
  },
  ar: {
    hello: (n) => `مرحباً ${n} 👋`,
    ready: (h) => `تعليمات الخروج من *${h}* جاهزة.`,
    meds: '💊 الأدوية',
    instructions: '📋 التعليمات',
    appointments: '📅 مواعيد المتابعة',
    by: (d) => `قبل ${d} — سيتم تأكيد الوقت لاحقاً وسنراسلك`,
    warn: '🚨 اتصل بالطوارئ إذا شعرت بـ:',
    close: 'أرسل لنا أي سؤال. نحن هنا لمساعدتك. 🩺',
  },
  hi: {
    hello: (n) => `नमस्ते ${n} 👋`,
    ready: (h) => `*${h}* से आपके डिस्चार्ज निर्देश तैयार हैं।`,
    meds: '💊 दवाइयाँ',
    instructions: '📋 निर्देश',
    appointments: '📅 फ़ॉलो-अप अपॉइंटमेंट',
    by: (d) => `${d} तक — सही समय की पुष्टि बाद में होगी, हम आपको संदेश भेजेंगे`,
    warn: '🚨 यदि ये लक्षण हों तो तुरंत आपातकालीन सेवा को कॉल करें:',
    close: 'कोई भी सवाल हो तो जवाब दें। हम मदद के लिए यहाँ हैं। 🩺',
  },
  ta: {
    hello: (n) => `வணக்கம் ${n} 👋`,
    ready: (h) => `*${h}* இலிருந்து உங்கள் டிஸ்சார்ஜ் வழிமுறைகள் தயார்.`,
    meds: '💊 மருந்துகள்',
    instructions: '📋 வழிமுறைகள்',
    appointments: '📅 பின்தொடர் சந்திப்புகள்',
    by: (d) => `${d} க்குள் — சரியான நேரம் பின்னர் உறுதி செய்யப்படும், நாங்கள் உங்களுக்கு செய்தி அனுப்புவோம்`,
    warn: '🚨 இந்த அறிகுறிகள் இருந்தால் அவசர சேவையை அழைக்கவும்:',
    close: 'ஏதேனும் கேள்விகள் இருந்தால் பதிலளிக்கவும். உதவ நாங்கள் இருக்கிறோம். 🩺',
  },
  tl: {
    hello: (n) => `Kumusta ${n} 👋`,
    ready: (h) => `Handa na ang iyong mga tagubilin sa paglabas mula sa *${h}*.`,
    meds: '💊 Mga gamot',
    instructions: '📋 Mga tagubilin',
    appointments: '📅 Mga follow-up na appointment',
    by: (d) => `bago mag-${d} — kukumpirmahin pa ang eksaktong oras, magme-message kami`,
    warn: '🚨 Tumawag sa emergency kung maranasan mo ang:',
    close: 'Mag-reply kung may tanong. Nandito kami para tumulong. 🩺',
  },
}

/**
 * Builds the care plan message sent to the patient after a nurse approves
 * the summary: medicines, key instructions, follow-up appointments (booked
 * times, or the "by" date from the letter while the slot is still to be
 * confirmed) and the warning signs. Section text comes from the patient's
 * language; the content itself uses the stored translation when one exists.
 */
export function buildDischargeSummaryMessage(params: {
  to: string
  patientName: string
  hospitalName: string
  language: LanguageCode
  summary: DischargeSummary
  medications: Medication[]
  appointments?: CarePlanAppointment[]
  timezone?: string
  translation?: CarePlanTranslation | null
}): OutboundMessage {
  const { to, patientName, hospitalName, language, summary, medications, translation } = params
  const appointments = params.appointments ?? []
  const timezone = params.timezone ?? 'Asia/Dubai'

  if (USE_TEXT_FALLBACK) {
    const t = CARE_PLAN_STRINGS[language] ?? CARE_PLAN_STRINGS.en

    const medRows = translation?.medications?.length === medications.length && translation.medications.length > 0
      ? translation.medications
      : medications
    const medList = medRows.map((m) => `• ${m.name} ${m.dosage} — ${m.frequency}`).join('\n')

    const instructions = (translation?.lifestyle_instructions?.length ? translation.lifestyle_instructions : summary.lifestyle_instructions).slice(0, 3)
    const warnings = (translation?.emergency_symptoms?.length ? translation.emergency_symptoms : summary.emergency_symptoms).slice(0, 4)

    const apptList = appointments.map((a) => {
      const date = formatInTimeZone(new Date(a.scheduled_at), timezone, 'EEE d MMM yyyy')
      if (a.time_tbc) return `• ${a.specialty} — ${t.by(date)}`
      const time = formatInTimeZone(new Date(a.scheduled_at), timezone, 'HH:mm')
      return `• ${a.specialty} — ${date}, ${time}${a.location ? ` (${a.location})` : ''}`
    }).join('\n')

    return {
      type: 'text',
      to,
      // One blank line between sections: reads as a card on a phone screen.
      body: [
        `${t.hello(patientName)}\n${t.ready(hospitalName)}`,
        medList ? `*${t.meds}:*\n${medList}` : '',
        instructions.length ? `*${t.instructions}:*\n${instructions.map((i) => `• ${i}`).join('\n')}` : '',
        apptList ? `*${t.appointments}:*\n${apptList}` : '',
        warnings.length ? `*${t.warn}*\n${warnings.map((w) => `• ${w}`).join('\n')}` : '',
        t.close,
      ].filter(Boolean).join('\n\n'),
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

// buildAppointmentConfirmationRequest moved to ./appointment-templates.ts (localised, hospital-timezone aware)

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

// ------------------------------------
// Instant replies for messages that need no answer (see lib/ai/intent.ts)
// ------------------------------------

const ACK_REPLIES: Record<LanguageCode, (name: string) => string> = {
  en: (n) => `Thank you, ${n}! 💙 If you have any questions about your recovery, just message me here.`,
  ar: (n) => `شكراً لك، ${n}! 💙 إذا كان لديك أي سؤال عن تعافيك، راسلني هنا.`,
  hi: (n) => `धन्यवाद, ${n}! 💙 अगर आपके स्वास्थ्य-लाभ के बारे में कोई सवाल हो, तो यहाँ संदेश भेजें।`,
  ta: (n) => `நன்றி, ${n}! 💙 உங்கள் குணமடைதல் பற்றி ஏதேனும் கேள்வி இருந்தால், இங்கே செய்தி அனுப்புங்கள்.`,
  tl: (n) => `Salamat, ${n}! 💙 Kung may tanong ka tungkol sa iyong paggaling, mag-message lang dito.`,
}

const GREETING_REPLIES: Record<LanguageCode, (name: string) => string> = {
  en: (n) => `Hello ${n}! 👋 How can I help you with your recovery today?`,
  ar: (n) => `مرحباً ${n}! 👋 كيف يمكنني مساعدتك في تعافيك اليوم؟`,
  hi: (n) => `नमस्ते ${n}! 👋 आज मैं आपके स्वास्थ्य-लाभ में कैसे मदद कर सकता हूँ?`,
  ta: (n) => `வணக்கம் ${n}! 👋 இன்று உங்கள் குணமடைதலில் நான் எப்படி உதவலாம்?`,
  tl: (n) => `Kumusta ${n}! 👋 Paano kita matutulungan sa iyong paggaling ngayon?`,
}

export function buildAcknowledgementReply(params: {
  to: string
  patientName: string
  language: LanguageCode
}): OutboundMessage {
  const build = ACK_REPLIES[params.language] ?? ACK_REPLIES.en
  return { type: 'text', to: params.to, body: build(params.patientName) }
}

export function buildGreetingReply(params: {
  to: string
  patientName: string
  language: LanguageCode
}): OutboundMessage {
  const build = GREETING_REPLIES[params.language] ?? GREETING_REPLIES.en
  return { type: 'text', to: params.to, body: build(params.patientName) }
}

/**
 * Sent when a message contains an emergency keyword. Deliberately not
 * localised through the model: this path must be instant and deterministic.
 */
export function buildEmergencyEscalationMessage(params: {
  to: string
  patientName: string
}): OutboundMessage {
  return {
    type: 'text',
    to: params.to,
    body: `${params.patientName}, if you are experiencing a *medical emergency*, please call emergency services *now* or go to the nearest emergency department. 🚨\n\nYour care team has been alerted and a nurse will contact you as soon as possible.`,
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
