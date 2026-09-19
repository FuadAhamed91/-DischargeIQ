/**
 * Deterministic, language-aware pre-classification of inbound patient messages.
 *
 * Runs before any model call so that:
 *  - obvious acknowledgements / greetings get an instant reply and never
 *    raise a nurse alert (they used to be escalated as "unanswerable");
 *  - anything containing an emergency keyword is escalated immediately at
 *    critical severity, regardless of what a model would say.
 *
 * Anything else is 'unknown' and goes to the bounded Gemini Q&A, which does
 * its own finer-grained intent classification (see chat.ts).
 */

import { EMERGENCY_KEYWORDS } from './guardrails'

export type PreIntent = 'emergency' | 'acknowledgement' | 'greeting' | 'unknown'

// Whole-message matches after normalisation (lower-cased, punctuation stripped).
const ACKNOWLEDGEMENTS = new Set<string>([
  // English
  'ok', 'okay', 'k', 'kk', 'okey', 'alright', 'fine', 'good', 'great', 'sure', 'noted',
  'yes', 'yeah', 'yep', 'ya', 'yup', 'done', 'taken', 'took it', 'i took it', 'i have taken it',
  'understood', 'got it', 'will do', 'thanks', 'thank you', 'thankyou', 'thx', 'ty', 'thank u',
  'thanks a lot', 'thank you so much', 'many thanks', 'perfect', 'cool', 'no problem',
  // Arabic
  'شكرا', 'شكراً', 'شكرا لك', 'شكراً لك', 'تمام', 'حسنا', 'حسناً', 'نعم', 'اي', 'ايوه', 'ايوا',
  'تم', 'أخذت', 'اخذت', 'أخذته', 'اخذته', 'ماشي', 'طيب', 'ان شاء الله', 'إن شاء الله',
  // Hindi
  'धन्यवाद', 'शुक्रिया', 'ठीक है', 'ठीक', 'हाँ', 'हां', 'जी', 'जी हाँ', 'जी हां', 'ले लिया', 'ले ली',
  'हो गया', 'समझ गया', 'समझ गयी', 'ok ji', 'thik hai', 'theek hai', 'haan', 'ha', 'ji', 'le liya', 'ho gaya', 'shukriya', 'dhanyavad',
  // Tamil
  'நன்றி', 'சரி', 'ஆம்', 'ஆமாம்', 'எடுத்துவிட்டேன்', 'எடுத்தேன்', 'முடிந்தது', 'sari', 'nandri', 'aama',
  // Tagalog
  'salamat', 'salamat po', 'maraming salamat', 'sige', 'sige po', 'oo', 'opo', 'ok po', 'okay po',
  'tapos na', 'nainom ko na', 'nainom na', 'naiinom ko na', 'noted po',
])

const GREETINGS = new Set<string>([
  'hi', 'hello', 'hey', 'hii', 'helo', 'good morning', 'good afternoon', 'good evening', 'good night',
  'morning', 'evening',
  'salam', 'salaam', 'assalamu alaikum', 'assalam alaikum', 'as salamu alaykum', 'السلام عليكم', 'مرحبا', 'مرحباً', 'صباح الخير', 'مساء الخير', 'اهلا', 'أهلا', 'أهلاً',
  'namaste', 'namaskar', 'नमस्ते', 'नमस्कार', 'हेलो', 'हैलो',
  'vanakkam', 'வணக்கம்',
  'kumusta', 'kamusta', 'kumusta po', 'magandang umaga', 'magandang hapon', 'magandang gabi', 'hello po', 'hi po',
])

// A message that is nothing but these is an acknowledgement.
const ACK_EMOJI = /^[\s👍👌🙏❤️💙🙂😊✅✔️☑️👏🤝🫶💪🙌]+$/u

/**
 * Lower-cases, collapses whitespace and strips punctuation/emoji so that
 * "Taken ✅", "taken.", "TAKEN!!" all normalise to "taken". Letters from any
 * script are preserved (\p{L}), as are digits and marks (Arabic diacritics,
 * Devanagari/Tamil combining vowels).
 */
export function normaliseMessage(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function containsEmergencyKeyword(text: string): boolean {
  // Fold curly/backtick apostrophes so "can’t breathe" matches "can't breathe"
  const lower = text.toLowerCase().replace(/[’‘`´]/g, "'")
  return EMERGENCY_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))
}

export function isAcknowledgement(text: string): boolean {
  if (ACK_EMOJI.test(text.trim()) && text.trim().length > 0) return true
  const norm = normaliseMessage(text)
  if (!norm) return false
  if (ACKNOWLEDGEMENTS.has(norm)) return true
  // "ok thanks", "yes done", "taken thank you": a short message made only of
  // acknowledgement phrases (greedy longest-phrase match over the word list).
  const words = norm.split(' ')
  return words.length <= 6 && isOnlyAcknowledgementPhrases(words)
}

function isOnlyAcknowledgementPhrases(words: string[]): boolean {
  let i = 0
  while (i < words.length) {
    let matched = false
    for (let len = Math.min(4, words.length - i); len >= 1; len--) {
      if (ACKNOWLEDGEMENTS.has(words.slice(i, i + len).join(' '))) {
        i += len
        matched = true
        break
      }
    }
    if (!matched) return false
  }
  return true
}

export function isGreeting(text: string): boolean {
  return GREETINGS.has(normaliseMessage(text))
}

/**
 * Order matters: an emergency keyword wins even inside an otherwise casual
 * message ("ok but I have chest pain").
 */
export function classifyPreIntent(text: string): PreIntent {
  if (!text || !text.trim()) return 'unknown'
  if (containsEmergencyKeyword(text)) return 'emergency'
  if (isAcknowledgement(text)) return 'acknowledgement'
  if (isGreeting(text)) return 'greeting'
  return 'unknown'
}
