/**
 * Nightly check-in conversation (plain text, works in the Twilio sandbox).
 *
 *   21:00 local  →  Q1 "Did you take all your medicines today?"  1 / 2 / 3
 *   reply        →  Q2 "How are you feeling tonight?"             OK / free text / voice note
 *   reply        →  good night, or text triage → nurse alert when yellow/red
 *
 * Every string exists in the five supported languages; the patient's
 * preferred_language picks the set. Keep wording short — these are read on a
 * phone, often by older patients.
 */

import type { OutboundMessage } from './client'
import type { LanguageCode } from '@/types/enums'
import type { RiskLevel } from '@/types/enums'

export type MedsTaken = 'all' | 'some' | 'none'

type T = (name: string, hospital: string) => string

const CHECKIN_Q1: Record<LanguageCode, T> = {
  en: (n, h) => `Good evening ${n} 🌙\nThis is your nightly check-in from ${h}.\n\nDid you take *all* of your medicines today?\n1️⃣ Yes, all of them\n2️⃣ Some of them\n3️⃣ None\n\nReply with *1*, *2* or *3*.`,
  ar: (n, h) => `مساء الخير ${n} 🌙\nهذه متابعتك الليلية من ${h}.\n\nهل تناولت *جميع* أدويتك اليوم؟\n1️⃣ نعم، كلها\n2️⃣ بعضها\n3️⃣ لم أتناول أياً منها\n\nأرسل *1* أو *2* أو *3*.`,
  hi: (n, h) => `शुभ संध्या ${n} 🌙\nयह ${h} की ओर से आपकी रात की जाँच है।\n\nक्या आपने आज अपनी *सभी* दवाइयाँ ली हैं?\n1️⃣ हाँ, सभी\n2️⃣ कुछ ली हैं\n3️⃣ एक भी नहीं\n\n*1*, *2* या *3* लिखकर जवाब दें।`,
  ta: (n, h) => `மாலை வணக்கம் ${n} 🌙\nஇது ${h} இலிருந்து உங்கள் இரவு நல விசாரிப்பு.\n\nஇன்று உங்கள் மருந்துகள் *அனைத்தையும்* எடுத்துக் கொண்டீர்களா?\n1️⃣ ஆம், அனைத்தும்\n2️⃣ சிலவற்றை\n3️⃣ எதுவும் இல்லை\n\n*1*, *2* அல்லது *3* என பதிலளிக்கவும்.`,
  tl: (n, h) => `Magandang gabi ${n} 🌙\nIto ang iyong gabi-gabing check-in mula sa ${h}.\n\nNainom mo ba *lahat* ng gamot mo ngayong araw?\n1️⃣ Oo, lahat\n2️⃣ Ang ilan lang\n3️⃣ Wala\n\nSumagot ng *1*, *2* o *3*.`,
}

const MEDS_LEAD: Record<LanguageCode, Record<MedsTaken, (n: string) => string>> = {
  en: {
    all: (n) => `Well done, ${n} 👏`,
    some: (n) => `Thanks for letting us know, ${n}. Please try to take the rest as prescribed.`,
    none: (n) => `Thank you for telling us, ${n}. Your nurse has been notified — please take your medicines as prescribed unless a doctor told you otherwise.`,
  },
  ar: {
    all: (n) => `أحسنت يا ${n} 👏`,
    some: (n) => `شكراً لإخبارنا يا ${n}. حاول تناول بقية الأدوية كما وُصفت لك.`,
    none: (n) => `شكراً لإخبارنا يا ${n}. تم إبلاغ الممرض/ة — يرجى تناول أدويتك كما وُصفت ما لم يخبرك الطبيب بغير ذلك.`,
  },
  hi: {
    all: (n) => `बहुत अच्छे, ${n} 👏`,
    some: (n) => `बताने के लिए धन्यवाद, ${n}। कृपया बाकी दवाइयाँ बताए अनुसार लेने की कोशिश करें।`,
    none: (n) => `बताने के लिए धन्यवाद, ${n}। आपकी नर्स को सूचित कर दिया गया है — जब तक डॉक्टर ने मना न किया हो, कृपया दवाइयाँ बताए अनुसार लें।`,
  },
  ta: {
    all: (n) => `நன்று, ${n} 👏`,
    some: (n) => `தெரிவித்ததற்கு நன்றி, ${n}. மீதமுள்ள மருந்துகளை பரிந்துரைத்தபடி எடுக்க முயலுங்கள்.`,
    none: (n) => `தெரிவித்ததற்கு நன்றி, ${n}. உங்கள் செவிலியருக்கு தெரிவிக்கப்பட்டுள்ளது — மருத்துவர் வேறு சொல்லாத வரை மருந்துகளை பரிந்துரைத்தபடி எடுத்துக் கொள்ளுங்கள்.`,
  },
  tl: {
    all: (n) => `Magaling, ${n} 👏`,
    some: (n) => `Salamat sa pagsabi, ${n}. Subukang inumin ang natitira ayon sa reseta.`,
    none: (n) => `Salamat sa pagsabi, ${n}. Naabisuhan na ang iyong nurse — inumin ang iyong mga gamot ayon sa reseta maliban kung iba ang sabi ng doktor.`,
  },
}

const CHECKIN_Q2: Record<LanguageCode, string> = {
  en: `And how are you feeling tonight? Reply *OK* if you feel fine, or describe any symptoms in your own words (you can also send a voice note).`,
  ar: `وكيف تشعر الليلة؟ أرسل *OK* إذا كنت بخير، أو صف أي أعراض بكلماتك (يمكنك أيضاً إرسال رسالة صوتية).`,
  hi: `और आज रात आप कैसा महसूस कर रहे हैं? ठीक हैं तो *OK* लिखें, या अपने शब्दों में कोई भी लक्षण बताएँ (आप वॉइस नोट भी भेज सकते हैं)।`,
  ta: `இன்று இரவு எப்படி உணர்கிறீர்கள்? நலமாக இருந்தால் *OK* என பதிலளிக்கவும், அல்லது ஏதேனும் அறிகுறிகளை உங்கள் சொந்த வார்த்தைகளில் விவரிக்கவும் (குரல் குறிப்பும் அனுப்பலாம்).`,
  tl: `At kumusta ang pakiramdam mo ngayong gabi? Sumagot ng *OK* kung maayos ka, o ilarawan ang anumang sintomas sa sarili mong salita (puwede ring magpadala ng voice note).`,
}

const GOODNIGHT: Record<LanguageCode, (n: string) => string> = {
  en: (n) => `Glad to hear it, ${n}. Sleep well 🌙 Message us any time if something changes.`,
  ar: (n) => `يسعدنا سماع ذلك يا ${n}. ليلة سعيدة 🌙 راسلنا في أي وقت إذا تغير شيء.`,
  hi: (n) => `यह जानकर अच्छा लगा, ${n}। शुभ रात्रि 🌙 कुछ भी बदले तो हमें कभी भी संदेश भेजें।`,
  ta: (n) => `கேட்க மகிழ்ச்சி, ${n}. நல்ல இரவு 🌙 ஏதேனும் மாற்றம் இருந்தால் எப்போது வேண்டுமானாலும் எங்களுக்கு செய்தி அனுப்புங்கள்.`,
  tl: (n) => `Mabuti naman, ${n}. Magpahinga ka nang maayos 🌙 Mag-message ka anumang oras kung may magbago.`,
}

const TRIAGE_REPLY: Record<LanguageCode, Record<RiskLevel, (n: string) => string>> = {
  en: {
    green: (n) => `Thank you for telling us, ${n}. This doesn't sound urgent, but your care team can see it. If it gets worse, or you notice any of your warning signs, message us straight away or call emergency services.`,
    yellow: (n) => `Thank you, ${n}. We've flagged this to your nurse, who will contact you. If it gets worse, call emergency services. 💙`,
    red: (n) => `🚨 *Important, ${n}*\n\nBased on what you described, please seek emergency medical attention immediately or call emergency services.\n\nYour care team has been notified and will follow up urgently. 💙`,
  },
  ar: {
    green: (n) => `شكراً لإخبارنا يا ${n}. لا يبدو هذا عاجلاً، لكن فريق الرعاية يمكنه رؤيته. إذا ساءت الحالة أو لاحظت أياً من علامات الخطر، راسلنا فوراً أو اتصل بالطوارئ.`,
    yellow: (n) => `شكراً يا ${n}. تم إبلاغ الممرض/ة وسيتواصل معك. إذا ساءت الحالة، اتصل بالطوارئ. 💙`,
    red: (n) => `🚨 *هام يا ${n}*\n\nبناءً على ما وصفته، يرجى طلب الرعاية الطبية الطارئة فوراً أو الاتصال بالطوارئ.\n\nتم إبلاغ فريق الرعاية وسيتابع معك بشكل عاجل. 💙`,
  },
  hi: {
    green: (n) => `बताने के लिए धन्यवाद, ${n}। यह तत्काल गंभीर नहीं लगता, लेकिन आपकी केयर टीम इसे देख सकती है। अगर यह बढ़े या कोई चेतावनी लक्षण दिखे, तो तुरंत हमें संदेश भेजें या आपातकालीन सेवा को कॉल करें।`,
    yellow: (n) => `धन्यवाद, ${n}। हमने यह आपकी नर्स को भेज दिया है, वे आपसे संपर्क करेंगी। अगर स्थिति बिगड़े, तो आपातकालीन सेवा को कॉल करें। 💙`,
    red: (n) => `🚨 *ज़रूरी, ${n}*\n\nआपने जो बताया उसके आधार पर, कृपया तुरंत आपातकालीन चिकित्सा सहायता लें या आपातकालीन सेवा को कॉल करें।\n\nआपकी केयर टीम को सूचित कर दिया गया है और वे तुरंत संपर्क करेंगे। 💙`,
  },
  ta: {
    green: (n) => `தெரிவித்ததற்கு நன்றி, ${n}. இது அவசரமாகத் தெரியவில்லை, ஆனால் உங்கள் பராமரிப்புக் குழு இதைப் பார்க்க முடியும். மோசமானால் அல்லது எச்சரிக்கை அறிகுறிகள் தென்பட்டால், உடனே எங்களுக்கு செய்தி அனுப்புங்கள் அல்லது அவசர சேவையை அழைக்கவும்.`,
    yellow: (n) => `நன்றி, ${n}. இதை உங்கள் செவிலியருக்கு தெரிவித்துள்ளோம்; அவர்கள் உங்களை தொடர்பு கொள்வார்கள். மோசமானால், அவசர சேவையை அழைக்கவும். 💙`,
    red: (n) => `🚨 *முக்கியம், ${n}*\n\nநீங்கள் விவரித்ததின் அடிப்படையில், உடனடியாக அவசர மருத்துவ உதவியை நாடவும் அல்லது அவசர சேவையை அழைக்கவும்.\n\nஉங்கள் பராமரிப்புக் குழுவுக்கு தெரிவிக்கப்பட்டுள்ளது; அவர்கள் அவசரமாக தொடர்பு கொள்வார்கள். 💙`,
  },
  tl: {
    green: (n) => `Salamat sa pagsabi, ${n}. Mukhang hindi ito agarang delikado, pero nakikita ito ng iyong care team. Kung lumala o mapansin mo ang alinman sa mga babalang sintomas, mag-message agad o tumawag sa emergency.`,
    yellow: (n) => `Salamat, ${n}. Ipinaalam na namin ito sa iyong nurse na makikipag-ugnayan sa iyo. Kung lumala, tumawag sa emergency. 💙`,
    red: (n) => `🚨 *Mahalaga, ${n}*\n\nBatay sa iyong inilarawan, humingi agad ng emergency na tulong medikal o tumawag sa emergency.\n\nNaabisuhan na ang iyong care team at agad silang makikipag-ugnayan. 💙`,
  },
}

const pick = <V,>(table: Record<LanguageCode, V>, lang: LanguageCode): V => table[lang] ?? table.en

export function buildNightlyCheckinMessage(params: {
  to: string
  patientName: string
  hospitalName: string
  language: LanguageCode
}): OutboundMessage {
  return { type: 'text', to: params.to, body: pick(CHECKIN_Q1, params.language)(params.patientName, params.hospitalName) }
}

export function buildCheckinSymptomQuestion(params: {
  to: string
  patientName: string
  language: LanguageCode
  medsTaken: MedsTaken
}): OutboundMessage {
  const lead = pick(MEDS_LEAD, params.language)[params.medsTaken](params.patientName)
  return { type: 'text', to: params.to, body: `${lead}\n\n${pick(CHECKIN_Q2, params.language)}` }
}

export function buildCheckinGoodnight(params: { to: string; patientName: string; language: LanguageCode }): OutboundMessage {
  return { type: 'text', to: params.to, body: pick(GOODNIGHT, params.language)(params.patientName) }
}

/** Reply after a text symptom report has been triaged. */
export function buildTriageReply(params: { to: string; patientName: string; language: LanguageCode; riskLevel: RiskLevel }): OutboundMessage {
  return { type: 'text', to: params.to, body: pick(TRIAGE_REPLY, params.language)[params.riskLevel](params.patientName) }
}
