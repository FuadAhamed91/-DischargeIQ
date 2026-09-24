/**
 * Appointment messages in the patient's language: the confirmation request
 * ("can you attend?"), the thank-you once they confirm, and — when they ask
 * to change it — the numbered times on offer and the hand-off to a nurse
 * when none of them suit. Dates are rendered in the hospital's timezone.
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
  /** Openers for the list of times: first offer, a reply we could not read, a choice that has passed. */
  offer: (n: string, specialty: string) => string
  again: (n: string, specialty: string) => string
  passed: (n: string, specialty: string) => string
  slot: (date: string, time: string) => string
  howToReply: (none: number) => string
  nurse: (n: string, specialty: string) => string
  notFound: (n: string) => string
  defaultPlace: string
}> = {
  en: {
    request: (n, s, d, t, p) => `Hi ${n},\n\nYour *${s}* follow-up appointment is scheduled for:\n📅 *${d}* at *${t}*\n📍 ${p}\n\nReply *1* to confirm ✅\nReply *2* to reschedule 🔄`,
    confirmed: (n, s, d, t) => `✅ Thank you ${n}! Your *${s}* appointment on *${d}* at *${t}* is confirmed. We look forward to seeing you.`,
    offer: (n, s) => `We understand, ${n}. 🙏\n\nThese times are open for your *${s}* appointment:`,
    again: (n, s) => `Sorry ${n}, we did not catch that. Please choose one of these times for your *${s}* appointment:`,
    passed: (n, s) => `That time has already passed, ${n}. These times are open now for your *${s}* appointment:`,
    slot: (d, t) => `${d} at ${t}`,
    howToReply: (k) => `Reply with the number of the time that suits you.\nReply *${k}* if none of them do — a nurse will contact you.`,
    nurse: (n, s) => `No problem, ${n}. 🙏 A nurse will contact you to arrange a time for your *${s}* appointment.`,
    notFound: (n) => `Thank you ${n}. We could not find an appointment waiting for your confirmation — a nurse will check and get back to you.`,
    defaultPlace: 'Hospital main clinic',
  },
  ar: {
    request: (n, s, d, t, p) => `مرحباً ${n}،\n\nموعد متابعتك في *${s}* محدد في:\n📅 *${d}* الساعة *${t}*\n📍 ${p}\n\nأرسل *1* للتأكيد ✅\nأرسل *2* لتغيير الموعد 🔄`,
    confirmed: (n, s, d, t) => `✅ شكراً يا ${n}! تم تأكيد موعدك في *${s}* يوم *${d}* الساعة *${t}*. نتطلع لرؤيتك.`,
    offer: (n, s) => `نتفهم ذلك يا ${n}. 🙏\n\nهذه المواعيد متاحة لموعدك في *${s}*:`,
    again: (n, s) => `عذراً يا ${n}، لم نفهم ردك. يرجى اختيار أحد هذه المواعيد لموعدك في *${s}*:`,
    passed: (n, s) => `لقد مضى ذلك الموعد يا ${n}. هذه المواعيد متاحة الآن لموعدك في *${s}*:`,
    slot: (d, t) => `${d} الساعة ${t}`,
    howToReply: (k) => `أرسل رقم الموعد الذي يناسبك.\nأرسل *${k}* إذا لم يناسبك أي منها — وسيتواصل معك الممرض/ة.`,
    nurse: (n, s) => `لا مشكلة يا ${n}. 🙏 سيتواصل معك الممرض/ة لترتيب وقت يناسبك لموعدك في *${s}*.`,
    notFound: (n) => `شكراً يا ${n}. لم نجد موعداً بانتظار تأكيدك — سيتحقق الممرض/ة ويعاود التواصل معك.`,
    defaultPlace: 'العيادة الرئيسية بالمستشفى',
  },
  hi: {
    request: (n, s, d, t, p) => `नमस्ते ${n},\n\nआपका *${s}* फ़ॉलो-अप अपॉइंटमेंट तय है:\n📅 *${d}*, *${t}* बजे\n📍 ${p}\n\nपुष्टि के लिए *1* भेजें ✅\nतारीख बदलने के लिए *2* भेजें 🔄`,
    confirmed: (n, s, d, t) => `✅ धन्यवाद ${n}! आपका *${s}* अपॉइंटमेंट *${d}*, *${t}* बजे पक्का हो गया है। आपसे मिलने की प्रतीक्षा है।`,
    offer: (n, s) => `हम समझते हैं, ${n}। 🙏\n\nआपके *${s}* अपॉइंटमेंट के लिए ये समय उपलब्ध हैं:`,
    again: (n, s) => `माफ़ कीजिए ${n}, हम समझ नहीं पाए। कृपया अपने *${s}* अपॉइंटमेंट के लिए इनमें से एक समय चुनें:`,
    passed: (n, s) => `वह समय निकल चुका है, ${n}। आपके *${s}* अपॉइंटमेंट के लिए अब ये समय उपलब्ध हैं:`,
    slot: (d, t) => `${d}, ${t} बजे`,
    howToReply: (k) => `जो समय आपके लिए ठीक हो, उसका नंबर भेजें।\nअगर इनमें से कोई भी समय ठीक न हो तो *${k}* भेजें — नर्स आपसे संपर्क करेंगी।`,
    nurse: (n, s) => `कोई बात नहीं, ${n}। 🙏 नर्स आपसे संपर्क करके आपके *${s}* अपॉइंटमेंट का समय तय करेंगी।`,
    notFound: (n) => `धन्यवाद ${n}। आपकी पुष्टि के लिए कोई अपॉइंटमेंट नहीं मिला — नर्स जाँच कर आपसे संपर्क करेंगी।`,
    defaultPlace: 'अस्पताल का मुख्य क्लिनिक',
  },
  ta: {
    request: (n, s, d, t, p) => `வணக்கம் ${n},\n\nஉங்கள் *${s}* பின்தொடர் சந்திப்பு:\n📅 *${d}* *${t}* மணிக்கு\n📍 ${p}\n\nஉறுதிப்படுத்த *1* அனுப்பவும் ✅\nதேதியை மாற்ற *2* அனுப்பவும் 🔄`,
    confirmed: (n, s, d, t) => `✅ நன்றி ${n}! உங்கள் *${s}* சந்திப்பு *${d}* *${t}* மணிக்கு உறுதி செய்யப்பட்டது. உங்களைச் சந்திக்க ஆவலாக இருக்கிறோம்.`,
    offer: (n, s) => `புரிகிறது, ${n}. 🙏\n\nஉங்கள் *${s}* சந்திப்புக்கு இந்த நேரங்கள் உள்ளன:`,
    again: (n, s) => `மன்னிக்கவும் ${n}, புரியவில்லை. உங்கள் *${s}* சந்திப்புக்கு இந்த நேரங்களில் ஒன்றைத் தேர்ந்தெடுக்கவும்:`,
    passed: (n, s) => `அந்த நேரம் ஏற்கனவே கடந்துவிட்டது, ${n}. உங்கள் *${s}* சந்திப்புக்கு இப்போது இந்த நேரங்கள் உள்ளன:`,
    slot: (d, t) => `${d} ${t} மணிக்கு`,
    howToReply: (k) => `உங்களுக்கு வசதியான நேரத்தின் எண்ணை அனுப்பவும்.\nஎதுவும் பொருந்தவில்லை என்றால் *${k}* அனுப்பவும் — செவிலியர் உங்களைத் தொடர்பு கொள்வார்.`,
    nurse: (n, s) => `பரவாயில்லை, ${n}. 🙏 உங்கள் *${s}* சந்திப்புக்கான நேரத்தை ஏற்பாடு செய்ய செவிலியர் உங்களைத் தொடர்பு கொள்வார்.`,
    notFound: (n) => `நன்றி ${n}. உங்கள் உறுதிப்படுத்தலுக்காக காத்திருக்கும் சந்திப்பு எதுவும் இல்லை — செவிலியர் சரிபார்த்து உங்களைத் தொடர்பு கொள்வார்.`,
    defaultPlace: 'மருத்துவமனை முதன்மை கிளினிக்',
  },
  tl: {
    request: (n, s, d, t, p) => `Kumusta ${n},\n\nNakatakda ang iyong *${s}* follow-up appointment:\n📅 *${d}* ng *${t}*\n📍 ${p}\n\nSumagot ng *1* para kumpirmahin ✅\nSumagot ng *2* para mag-reschedule 🔄`,
    confirmed: (n, s, d, t) => `✅ Salamat ${n}! Kumpirmado na ang iyong *${s}* appointment sa *${d}* ng *${t}*. Inaasahan ka namin.`,
    offer: (n, s) => `Naiintindihan namin, ${n}. 🙏\n\nBukas ang mga oras na ito para sa iyong *${s}* appointment:`,
    again: (n, s) => `Paumanhin ${n}, hindi namin naintindihan. Pumili ng isa sa mga oras na ito para sa iyong *${s}* appointment:`,
    passed: (n, s) => `Lumipas na ang oras na iyon, ${n}. Bukas ngayon ang mga oras na ito para sa iyong *${s}* appointment:`,
    slot: (d, t) => `${d} ng ${t}`,
    howToReply: (k) => `I-reply ang numero ng oras na babagay sa iyo.\nI-reply ang *${k}* kung wala sa mga ito ang babagay — makikipag-ugnayan sa iyo ang nurse.`,
    nurse: (n, s) => `Walang problema, ${n}. 🙏 Makikipag-ugnayan sa iyo ang nurse para ayusin ang oras ng iyong *${s}* appointment.`,
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

/** The times on offer, numbered, and one number more for "none of these". */
export function buildRescheduleOptions(params: {
  to: string
  patientName: string
  language: LanguageCode
  specialty: string
  /** ISO instants, in the order they are numbered */
  slots: string[]
  timezone: string
  intro?: 'offer' | 'again' | 'passed'
}): OutboundMessage {
  const t = pick(params.language)
  const lines = params.slots.map((at, i) => {
    const date = formatInTimeZone(new Date(at), params.timezone, 'EEEE, d MMMM')
    const time = formatInTimeZone(new Date(at), params.timezone, 'HH:mm')
    return `*${i + 1}* — ${t.slot(date, time)}`
  })
  const intro = t[params.intro ?? 'offer'](params.patientName, params.specialty)
  return { type: 'text', to: params.to, body: `${intro}\n\n${lines.join('\n')}\n\n${t.howToReply(params.slots.length + 1)}` }
}

/** None of the times suit (or they asked for one of their own): a nurse arranges it. */
export function buildRescheduleNurseReply(params: { to: string; patientName: string; language: LanguageCode; specialty: string }): OutboundMessage {
  return { type: 'text', to: params.to, body: pick(params.language).nurse(params.patientName, params.specialty) }
}

export function buildNoPendingAppointmentReply(params: { to: string; patientName: string; language: LanguageCode }): OutboundMessage {
  return { type: 'text', to: params.to, body: pick(params.language).notFound(params.patientName) }
}
