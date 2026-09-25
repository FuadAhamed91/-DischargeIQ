/**
 * What a judge can send as a demo patient ("Reply as Fatima", on the patient's
 * conversation), in each patient language: one urgent symptom and two
 * questions the assistant answers from the care plan.
 */

import type { LanguageCode } from '@/types/enums'

export interface DemoReply {
  text: string
  /** The English, under a message in another language. */
  gloss?: string
  urgent?: boolean
}

// The urgent line is one the emergency check recognises in that language
// (lib/ai/guardrails.ts), so it raises a critical alert with or without the AI.
export const DEMO_REPLIES: Record<LanguageCode, DemoReply[]> = {
  en: [
    { text: 'I have chest pain and I’m short of breath', urgent: true },
    { text: 'Can I take paracetamol for a headache?' },
    { text: 'Which medicine do I take in the evening?' },
  ],
  ar: [
    { text: 'عندي ألم في صدري وضيق في التنفس', gloss: 'I have chest pain and shortness of breath', urgent: true },
    { text: 'هل آخذ بنادول للصداع؟', gloss: 'Can I take Panadol for a headache?' },
    { text: 'أي دواء آخذه في المساء؟', gloss: 'Which medicine do I take in the evening?' },
  ],
  hi: [
    { text: 'मेरे सीने में दर्द है और सांस लेने में तकलीफ हो रही है', gloss: 'I have chest pain and trouble breathing', urgent: true },
    { text: 'क्या सिरदर्द के लिए पैरासिटामोल लेना ठीक है?', gloss: 'Is it all right to take paracetamol for a headache?' },
    { text: 'शाम को कौन सी दवा लेनी है?', gloss: 'Which medicine do I take in the evening?' },
  ],
  ta: [
    { text: 'எனக்கு நெஞ்சு வலி, மூச்சு விட முடியவில்லை', gloss: 'I have chest pain, I can’t breathe', urgent: true },
    { text: 'தலைவலிக்கு பாராசிட்டமால் எடுக்கலாமா?', gloss: 'Can I take paracetamol for a headache?' },
    { text: 'மாலையில் எந்த மருந்தை எடுக்க வேண்டும்?', gloss: 'Which medicine do I take in the evening?' },
  ],
  tl: [
    { text: 'Masakit ang dibdib ko at hirap akong huminga', gloss: 'My chest hurts and I can’t breathe well', urgent: true },
    { text: 'Puwede ba akong uminom ng paracetamol para sa sakit ng ulo?', gloss: 'Can I take paracetamol for a headache?' },
    { text: 'Anong gamot ang iinumin ko sa gabi?', gloss: 'Which medicine do I take in the evening?' },
  ],
}
