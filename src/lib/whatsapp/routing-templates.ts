/**
 * What the assistant says when one WhatsApp number is linked to more than
 * one patient and it cannot tell who a message is about (see routing.ts).
 *
 * Plain text, five languages, same conventions as checkin-templates.ts. The
 * language is the one all linked patients share, else English — the sender
 * may be a relative rather than any of the patients.
 */

import type { OutboundMessage } from './client'
import type { LanguageCode } from '@/types/enums'

interface AskStrings {
  intro: string
  again: string
  question: string
  reply: (numbers: string) => string
  /** The name-prefix tip, with a real name from the list as the example. */
  tip: (example: string) => string
  holding: string
  or: string
}

const ASK: Record<LanguageCode, AskStrings> = {
  en: {
    intro: 'This WhatsApp number is linked to more than one patient.',
    again: 'Sorry, I did not catch that.',
    question: 'Who is this message about?',
    reply: (n) => `Reply with ${n}.`,
    tip: (n) => `You can also start any message with a name, e.g. “${n}: …”`,
    holding: 'I will pass your message on as soon as you reply.',
    or: 'or',
  },
  ar: {
    intro: 'هذا الرقم مرتبط بأكثر من مريض.',
    again: 'عذراً، لم أفهم.',
    question: 'عن مَن هذه الرسالة؟',
    reply: (n) => `أرسل ${n}.`,
    tip: (n) => `يمكنك أيضاً بدء أي رسالة بالاسم، مثل: «${n}: …»`,
    holding: 'سأمرر رسالتك فور ردّك.',
    or: 'أو',
  },
  hi: {
    intro: 'यह WhatsApp नंबर एक से अधिक मरीज़ों से जुड़ा है।',
    again: 'माफ़ कीजिए, मैं समझ नहीं पाया।',
    question: 'यह संदेश किसके बारे में है?',
    reply: (n) => `${n} लिखकर जवाब दें।`,
    tip: (n) => `आप किसी भी संदेश की शुरुआत नाम से भी कर सकते हैं, जैसे “${n}: …”`,
    holding: 'आपके जवाब देते ही मैं आपका संदेश आगे भेज दूँगा।',
    or: 'या',
  },
  ta: {
    intro: 'இந்த WhatsApp எண் ஒன்றுக்கு மேற்பட்ட நோயாளிகளுடன் இணைக்கப்பட்டுள்ளது.',
    again: 'மன்னிக்கவும், புரியவில்லை.',
    question: 'இந்தச் செய்தி யாரைப் பற்றியது?',
    reply: (n) => `${n} என பதிலளிக்கவும்.`,
    tip: (n) => `எந்தச் செய்தியையும் பெயருடன் தொடங்கலாம், எ.கா. “${n}: …”`,
    holding: 'நீங்கள் பதிலளித்தவுடன் உங்கள் செய்தியை அனுப்புகிறேன்.',
    or: 'அல்லது',
  },
  tl: {
    intro: 'Ang WhatsApp number na ito ay naka-link sa higit sa isang pasyente.',
    again: 'Paumanhin, hindi ko naintindihan.',
    question: 'Para kanino ang mensaheng ito?',
    reply: (n) => `Sumagot ng ${n}.`,
    tip: (n) => `Maaari mo ring simulan ang mensahe sa pangalan, hal. “${n}: …”`,
    holding: 'Ipapasa ko ang mensahe mo kapag sumagot ka na.',
    or: 'o',
  },
}

const SWITCHED: Record<LanguageCode, (name: string) => string> = {
  en: (n) => `Got it — I will treat your messages as being about *${n}*. Start a message with a name to talk about someone else.`,
  ar: (n) => `تمام — سأعتبر رسائلك عن *${n}*. ابدأ الرسالة بالاسم للحديث عن شخص آخر.`,
  hi: (n) => `ठीक है — अब आपके संदेश *${n}* के बारे में माने जाएँगे। किसी और के बारे में बात करने के लिए संदेश की शुरुआत नाम से करें।`,
  ta: (n) => `சரி — உங்கள் செய்திகள் *${n}* பற்றியதாகக் கருதப்படும். வேறொருவரைப் பற்றிப் பேச, செய்தியைப் பெயருடன் தொடங்கவும்.`,
  tl: (n) => `Sige — ituturing kong tungkol kay *${n}* ang mga mensahe mo. Simulan ang mensahe sa pangalan para makipag-usap tungkol sa iba.`,
}

/** "1, 2 or 3" in the prompt's language. */
function numberList(count: number, or: string): string {
  const numbers = Array.from({ length: count }, (_, i) => String(i + 1))
  if (numbers.length === 1) return numbers[0]
  return `${numbers.slice(0, -1).join(', ')} ${or} ${numbers[numbers.length - 1]}`
}

/**
 * "Who is this message about? 1. Farzana Arif 2. Umar Siddiqui". `repeat`
 * apologises instead of explaining, `holding` promises to pass the held
 * message on.
 */
export function buildWhoIsThisAboutMessage(params: {
  to: string
  options: Array<{ name: string }>
  language: LanguageCode
  repeat: boolean
  holding: boolean
}): OutboundMessage {
  const t = ASK[params.language] ?? ASK.en
  const list = params.options.map((o, i) => `${i + 1}. ${o.name}`).join('\n')
  const lines = [
    params.repeat ? t.again : t.intro,
    t.question,
    '',
    list,
    '',
    t.reply(numberList(params.options.length, t.or)),
  ]
  // The example is the last listed name: a reminder that the others are one word away.
  const example = params.options[params.options.length - 1]?.name.split(' ')[0] ?? ''
  if (!params.repeat && example) lines.push(t.tip(example))
  if (params.holding) lines.push(t.holding)
  return { type: 'text', to: params.to, body: lines.join('\n') }
}

/** After a bare name or a choice with nothing to pass on: confirm who we are talking about now. */
export function buildNowAboutMessage(params: { to: string; patientName: string; language: LanguageCode }): OutboundMessage {
  const build = SWITCHED[params.language] ?? SWITCHED.en
  return { type: 'text', to: params.to, body: build(params.patientName) }
}
