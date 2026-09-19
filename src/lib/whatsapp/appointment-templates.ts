/**
 * Appointment messages in the patient's language: the confirmation request
 * ("can you attend?"), the thank-you once they confirm, and the reschedule
 * acknowledgement. Dates are rendered in the hospital's timezone.
 */

import { formatInTimeZone } from 'date-fns-tz'
import type { OutboundMessage } from './client'
import type { LanguageCode } from '@/types/enums'

interface AppointmentLike {
  specialty: string
  scheduled_at: string
  location: string | null
}

const STRINGS: Record<LanguageCode, {
  request: (n: string, specialty: string, date: string, time: string, place: string) => string
  confirmed: (n: string, specialty: string, date: string, time: string) => string
  reschedule: (n: string, specialty: string) => string
  notFound: (n: string) => string
  defaultPlace: string
}> = {
  en: {
    request: (n, s, d, t, p) => `Hi ${n},\n\nYour *${s}* follow-up appointment is scheduled for:\n📅 *${d}* at *${t}*\n📍 ${p}\n\nReply *1* to confirm ✅\nReply *2* to reschedule 🔄`,
    confirmed: (n, s, d, t) => `✅ Thank you ${n}! Your *${s}* appointment on *${d}* at *${t}* is confirmed. We look forward to seeing you.`,
    reschedule: (n, s) => `We understand, ${n}. 🙏\n\nPlease contact the hospital to reschedule your *${s}* appointment, or reply with your preferred date and a nurse will assist you.`,
    notFound: (n) => `Thank you ${n}. We could not find an appointment waiting for your confirmation — a nurse will check and get back to you.`,
    defaultPlace: 'Hospital main clinic',
  },
  ar: {
    request: (n, s, d, t, p) => `مرحباً ${n}،\n\nموعد متابعتك في *${s}* محدد في:\n📅 *${d}* الساعة *${t}*\n📍 ${p}\n\nأرسل *1* للتأكيد ✅\nأرسل *2* لتغيير الموعد 🔄`,
    confirmed: (n, s, d, t) => `✅ شكراً يا ${n}! تم تأكيد موعدك في *${s}* يوم *${d}* الساعة *${t}*. نتطلع لرؤيتك.`,
    reschedule: (n, s) => `نتفهم ذلك يا ${n}. 🙏\n\nيرجى التواصل مع المستشفى لتغيير موعد *${s}*، أو أرسل التاريخ الذي يناسبك وسيساعدك الممرض/ة.`,
    notFound: (n) => `شكراً يا ${n}. لم نجد موعداً بانتظار تأكيدك — سيتحقق الممرض/ة ويعاود التواصل معك.`,
    defaultPlace: 'العيادة الرئيسية بالمستشفى',
  },
  hi: {
    request: (n, s, d, t, p) => `नमस्ते ${n},\n\nआपका *${s}* फ़ॉलो-अप अपॉइंटमेंट तय है:\n📅 *${d}*, *${t}* बजे\n📍 ${p}\n\nपुष्टि के लिए *1* भेजें ✅\nतारीख बदलने के लिए *2* भेजें 🔄`,
    confirmed: (n, s, d, t) => `✅ धन्यवाद ${n}! आपका *${s}* अपॉइंटमेंट *${d}*, *${t}* बजे पक्का हो गया है। आपसे मिलने की प्रतीक्षा है।`,
    reschedule: (n, s) => `हम समझते हैं, ${n}। 🙏\n\nकृपया *${s}* अपॉइंटमेंट बदलने के लिए अस्पताल से संपर्क करें, या अपनी पसंद की तारीख भेजें — नर्स आपकी मदद करेंगी।`,
    notFound: (n) => `धन्यवाद ${n}। आपकी पुष्टि के लिए कोई अपॉइंटमेंट नहीं मिला — नर्स जाँच कर आपसे संपर्क करेंगी।`,
    defaultPlace: 'अस्पताल का मुख्य क्लिनिक',
  },
  ta: {
    request: (n, s, d, t, p) => `வணக்கம் ${n},\n\nஉங்கள் *${s}* பின்தொடர் சந்திப்பு:\n📅 *${d}* *${t}* மணிக்கு\n📍 ${p}\n\nஉறுதிப்படுத்த *1* அனுப்பவும் ✅\nதேதியை மாற்ற *2* அனுப்பவும் 🔄`,
    confirmed: (n, s, d, t) => `✅ நன்றி ${n}! உங்கள் *${s}* சந்திப்பு *${d}* *${t}* மணிக்கு உறுதி செய்யப்பட்டது. உங்களைச் சந்திக்க ஆவலாக இருக்கிறோம்.`,
    reschedule: (n, s) => `புரிகிறது, ${n}. 🙏\n\n*${s}* சந்திப்பை மாற்ற மருத்துவமனையைத் தொடர்பு கொள்ளவும், அல்லது உங்களுக்கு வசதியான தேதியை அனுப்பவும் — செவிலியர் உதவுவார்.`,
    notFound: (n) => `நன்றி ${n}. உங்கள் உறுதிப்படுத்தலுக்காக காத்திருக்கும் சந்திப்பு எதுவும் இல்லை — செவிலியர் சரிபார்த்து உங்களைத் தொடர்பு கொள்வார்.`,
    defaultPlace: 'மருத்துவமனை முதன்மை கிளினிக்',
  },
  tl: {
    request: (n, s, d, t, p) => `Kumusta ${n},\n\nNakatakda ang iyong *${s}* follow-up appointment:\n📅 *${d}* ng *${t}*\n📍 ${p}\n\nSumagot ng *1* para kumpirmahin ✅\nSumagot ng *2* para mag-reschedule 🔄`,
    confirmed: (n, s, d, t) => `✅ Salamat ${n}! Kumpirmado na ang iyong *${s}* appointment sa *${d}* ng *${t}*. Inaasahan ka namin.`,
    reschedule: (n, s) => `Naiintindihan namin, ${n}. 🙏\n\nMakipag-ugnayan sa ospital para i-reschedule ang iyong *${s}* appointment, o i-reply ang petsang gusto mo at tutulungan ka ng nurse.`,
    notFound: (n) => `Salamat ${n}. Wala kaming nakitang appointment na naghihintay ng iyong kumpirmasyon — titingnan ito ng nurse at babalikan ka.`,
    defaultPlace: 'Pangunahing klinika ng ospital',
  },
}

const pick = (lang: LanguageCode) => STRINGS[lang] ?? STRINGS.en

function when(appointment: AppointmentLike, timezone: string) {
  const at = new Date(appointment.scheduled_at)
  return {
    date: formatInTimeZone(at, timezone, 'EEEE, d MMMM yyyy'),
    time: formatInTimeZone(at, timezone, 'HH:mm'),
  }
}

export function buildAppointmentConfirmationRequest(params: {
  to: string
  patientName: string
  language: LanguageCode
  appointment: AppointmentLike
  timezone: string
}): OutboundMessage {
  const t = pick(params.language)
  const { date, time } = when(params.appointment, params.timezone)
  return {
    type: 'text',
    to: params.to,
    body: t.request(params.patientName, params.appointment.specialty, date, time, params.appointment.location ?? t.defaultPlace),
  }
}

export function buildAppointmentConfirmedReply(params: {
  to: string
  patientName: string
  language: LanguageCode
  appointment: AppointmentLike
  timezone: string
}): OutboundMessage {
  const t = pick(params.language)
  const { date, time } = when(params.appointment, params.timezone)
  return { type: 'text', to: params.to, body: t.confirmed(params.patientName, params.appointment.specialty, date, time) }
}

export function buildRescheduleReply(params: { to: string; patientName: string; language: LanguageCode; specialty: string | null }): OutboundMessage {
  const t = pick(params.language)
  return { type: 'text', to: params.to, body: t.reschedule(params.patientName, params.specialty ?? 'follow-up') }
}

export function buildNoPendingAppointmentReply(params: { to: string; patientName: string; language: LanguageCode }): OutboundMessage {
  return { type: 'text', to: params.to, body: pick(params.language).notFound(params.patientName) }
}
