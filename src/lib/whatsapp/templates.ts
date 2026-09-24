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
import { CARE_PLAN_MESSAGE_INSTRUCTIONS, CARE_PLAN_MESSAGE_WARNINGS } from './care-plan-limits'

// Set to true to send plain text instead of template messages while Meta reviews them.
// Read per call, not at load: scripts and checks set the flag after this module is imported.
const textFallbackEnabled = () => process.env.WHATSAPP_USE_TEXT_FALLBACK === 'true'

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

/** Translated summary content (discharge_summary_translations.content) of the plan being sent, when the patient's language differs. */
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
 * A translated list stands in for the saved one only item for item: one that
 * lost or gained a line (a warning sign, say) is not trusted, and the saved
 * list goes out as written.
 */
function translatedOr<T, U>(translated: T[] | undefined, saved: U[]): Array<T | U> {
  return translated && translated.length === saved.length ? translated : saved
}

/**
 * Builds the care plan message sent to the patient after a nurse approves
 * the summary: medicines, key instructions, follow-up appointments (booked
 * times, or the "by" date from the letter while the slot is still to be
 * confirmed) and the warning signs. Section text comes from the patient's
 * language; the content uses `translation`, which must be a translation of
 * this very content (sendCarePlan passes none otherwise).
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

  if (textFallbackEnabled()) {
    const t = CARE_PLAN_STRINGS[language] ?? CARE_PLAN_STRINGS.en

    const medRows = translatedOr(translation?.medications, medications)
    const medList = medRows.map((m) => `• ${m.name} ${m.dosage} — ${m.frequency}`).join('\n')

    const instructions = translatedOr(translation?.lifestyle_instructions, summary.lifestyle_instructions).slice(0, CARE_PLAN_MESSAGE_INSTRUCTIONS)
    const warnings = translatedOr(translation?.emergency_symptoms, summary.emergency_symptoms).slice(0, CARE_PLAN_MESSAGE_WARNINGS)

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

  if (textFallbackEnabled()) {
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

const NO_OPEN_EPISODE: Record<LanguageCode, (name: string | null) => string> = {
  en: (n) => `${n ? `Hi ${n}` : 'Hello'} 👋\n\nYour care episode with us has ended, so the assistant is no longer following up on this number. If you need help, please contact the hospital directly.\n\n_If this is a medical emergency, call emergency services now._`,
  ar: (n) => `${n ? `مرحباً ${n}` : 'مرحباً'} 👋\n\nانتهت فترة متابعتك معنا، لذلك لم يعد المساعد يتابع على هذا الرقم. إذا احتجت إلى مساعدة، يرجى التواصل مع المستشفى مباشرة.\n\n_إذا كانت هذه حالة طبية طارئة، اتصل بالطوارئ الآن._`,
  hi: (n) => `${n ? `नमस्ते ${n}` : 'नमस्ते'} 👋\n\nहमारे साथ आपकी देखभाल की अवधि पूरी हो गई है, इसलिए सहायक अब इस नंबर पर फ़ॉलो-अप नहीं करता। मदद चाहिए तो कृपया सीधे अस्पताल से संपर्क करें।\n\n_अगर यह मेडिकल इमरजेंसी है, तो अभी आपातकालीन सेवा को कॉल करें।_`,
  ta: (n) => `${n ? `வணக்கம் ${n}` : 'வணக்கம்'} 👋\n\nஎங்களுடனான உங்கள் பராமரிப்புக் காலம் முடிந்துவிட்டது, எனவே உதவியாளர் இனி இந்த எண்ணில் பின்தொடர்வதில்லை. உதவி தேவைப்பட்டால், நேரடியாக மருத்துவமனையைத் தொடர்பு கொள்ளவும்.\n\n_இது மருத்துவ அவசரநிலை என்றால், இப்போதே அவசர சேவையை அழைக்கவும்._`,
  tl: (n) => `${n ? `Kumusta ${n}` : 'Kumusta'} 👋\n\nTapos na ang iyong care episode sa amin, kaya hindi na nagfo-follow up ang assistant sa numerong ito. Kung kailangan mo ng tulong, direktang makipag-ugnayan sa ospital.\n\n_Kung ito ay medical emergency, tumawag ngayon sa emergency._`,
}

/** A registered number whose every episode is closed; addressed by name when the number is one patient's, in their language. */
export function buildNoOpenEpisodeMessage(to: string, patientName: string | null, language: LanguageCode = 'en'): OutboundMessage {
  const build = NO_OPEN_EPISODE[language] ?? NO_OPEN_EPISODE.en
  return { type: 'text', to, body: build(patientName) }
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

const EMERGENCY: Record<LanguageCode, (name: string) => string> = {
  en: (n) => `${n}, if you are experiencing a *medical emergency*, please call emergency services *now* or go to the nearest emergency department. 🚨\n\nYour care team has been alerted and a nurse will contact you as soon as possible.`,
  ar: (n) => `${n}، إذا كانت هذه *حالة طبية طارئة*، يرجى الاتصال بالطوارئ *الآن* أو التوجه إلى أقرب قسم طوارئ. 🚨\n\nتم إبلاغ فريق الرعاية، وسيتواصل معك الممرض/ة في أقرب وقت ممكن.`,
  hi: (n) => `${n}, अगर यह *मेडिकल इमरजेंसी* है, तो *अभी* आपातकालीन सेवा को कॉल करें या नज़दीकी इमरजेंसी विभाग में जाएँ। 🚨\n\nआपकी केयर टीम को सूचित कर दिया गया है और नर्स जल्द से जल्द आपसे संपर्क करेंगी।`,
  ta: (n) => `${n}, இது *மருத்துவ அவசரநிலை* என்றால், *உடனே* அவசர சேவையை அழைக்கவும் அல்லது அருகிலுள்ள அவசர சிகிச்சைப் பிரிவுக்குச் செல்லவும். 🚨\n\nஉங்கள் பராமரிப்புக் குழுவுக்குத் தெரிவிக்கப்பட்டுள்ளது; செவிலியர் விரைவில் உங்களைத் தொடர்பு கொள்வார்.`,
  tl: (n) => `${n}, kung ito ay *medical emergency*, tumawag *ngayon* sa emergency o pumunta sa pinakamalapit na emergency department. 🚨\n\nNaabisuhan na ang iyong care team at makikipag-ugnayan sa iyo ang isang nurse sa lalong madaling panahon.`,
}

/**
 * Sent when a message contains an emergency keyword. Localised from fixed
 * strings, never through the model: this path must be instant and deterministic.
 */
export function buildEmergencyEscalationMessage(params: {
  to: string
  patientName: string
  language: LanguageCode
}): OutboundMessage {
  const build = EMERGENCY[params.language] ?? EMERGENCY.en
  return { type: 'text', to: params.to, body: build(params.patientName) }
}

const CANNOT_READ_MEDIA: Record<LanguageCode, (name: string) => string> = {
  en: (n) => `Sorry ${n}, I cannot look at pictures or files yet. 🙏 Please describe it in words, or send a voice note — a nurse can then see it too.`,
  ar: (n) => `عذراً ${n}، لا أستطيع الاطلاع على الصور أو الملفات بعد. 🙏 صف الأمر بالكلمات أو أرسل رسالة صوتية، ليتمكن الممرض/ة من رؤيته أيضاً.`,
  hi: (n) => `माफ़ कीजिए ${n}, मैं अभी तस्वीरें या फ़ाइलें नहीं देख सकता। 🙏 कृपया शब्दों में बताएँ या वॉइस नोट भेजें — तब नर्स भी इसे देख सकेंगी।`,
  ta: (n) => `மன்னிக்கவும் ${n}, படங்களையோ கோப்புகளையோ என்னால் இன்னும் பார்க்க முடியாது. 🙏 வார்த்தைகளில் விவரிக்கவும் அல்லது குரல் குறிப்பு அனுப்பவும் — செவிலியரும் அதைப் பார்க்க முடியும்.`,
  tl: (n) => `Pasensya na ${n}, hindi ko pa kayang tingnan ang mga larawan o file. 🙏 Ilarawan mo ito sa salita, o magpadala ng voice note — makikita rin ito ng nurse.`,
}

/** A picture or document with no caption: nobody looks at it, so say so rather than stay silent. */
export function buildCannotReadMediaReply(params: {
  to: string
  patientName: string
  language: LanguageCode
}): OutboundMessage {
  const build = CANNOT_READ_MEDIA[params.language] ?? CANNOT_READ_MEDIA.en
  return { type: 'text', to: params.to, body: build(params.patientName) }
}

const ESCALATION_ACK: Record<LanguageCode, (name: string) => string> = {
  en: (n) => `Hi ${n},\n\nThank you for reaching out. 💙\n\nYour message has been received and a member of your care team will review it shortly.\n\nIf this is a *medical emergency*, please call emergency services immediately.`,
  ar: (n) => `مرحباً ${n}،\n\nشكراً لتواصلك معنا. 💙\n\nوصلتنا رسالتك، وسيراجعها أحد أعضاء فريق الرعاية قريباً.\n\nإذا كانت هذه *حالة طبية طارئة*، يرجى الاتصال بالطوارئ فوراً.`,
  hi: (n) => `नमस्ते ${n},\n\nसंपर्क करने के लिए धन्यवाद। 💙\n\nआपका संदेश मिल गया है और आपकी केयर टीम का कोई सदस्य जल्द ही इसे देखेगा।\n\nअगर यह *मेडिकल इमरजेंसी* है, तो तुरंत आपातकालीन सेवा को कॉल करें।`,
  ta: (n) => `வணக்கம் ${n},\n\nதொடர்பு கொண்டதற்கு நன்றி. 💙\n\nஉங்கள் செய்தி கிடைத்தது; உங்கள் பராமரிப்புக் குழுவைச் சேர்ந்த ஒருவர் விரைவில் அதைப் பார்ப்பார்.\n\nஇது *மருத்துவ அவசரநிலை* என்றால், உடனே அவசர சேவையை அழைக்கவும்.`,
  tl: (n) => `Kumusta ${n},\n\nSalamat sa pag-message. 💙\n\nNatanggap namin ang iyong mensahe at titingnan ito ng isang miyembro ng iyong care team sa lalong madaling panahon.\n\nKung ito ay *medical emergency*, tumawag agad sa emergency.`,
}

/** "A person will look at this": a voice note before triage, or a message the assistant could not handle. */
export function buildEscalationAcknowledgement(params: {
  to: string
  patientName: string
  language: LanguageCode
}): OutboundMessage {
  const build = ESCALATION_ACK[params.language] ?? ESCALATION_ACK.en
  return { type: 'text', to: params.to, body: build(params.patientName) }
}

const REMINDER_THANKS: Record<LanguageCode, (name: string) => string> = {
  en: (n) => `Thank you, ${n}! ✅ Keep it up!`,
  ar: (n) => `شكراً لك، ${n}! ✅ استمر على هذا!`,
  hi: (n) => `धन्यवाद, ${n}! ✅ ऐसे ही जारी रखें!`,
  ta: (n) => `நன்றி, ${n}! ✅ இப்படியே தொடருங்கள்!`,
  tl: (n) => `Salamat, ${n}! ✅ Ipagpatuloy mo lang!`,
}

/** Reply to a "taken" / "I'm fine" on a legacy per-dose reminder. */
export function buildReminderThanks(params: {
  to: string
  patientName: string
  language: LanguageCode
}): OutboundMessage {
  const build = REMINDER_THANKS[params.language] ?? REMINDER_THANKS.en
  return { type: 'text', to: params.to, body: build(params.patientName) }
}
