/**
 * Bounded AI Q&A for patient WhatsApp messages.
 *
 * Gemini 2.5 Flash answers ONLY from the patient's approved discharge summary.
 * Out-of-scope or low-confidence questions are escalated to a nurse.
 */

import { generate } from './gemini'
import { parseModelJson } from './json'
import type { DischargeSummary, Medication } from '@/types/database'
import { SUPPORTED_LANGUAGES } from '@/types/enums'
import type { LanguageCode } from '@/types/enums'

/** When the model gives no usable answer the patient still hears back — in their language. */
const FALLBACK_ANSWER: Record<LanguageCode, string> = {
  en: "I'm having trouble answering that right now. A nurse will follow up with you shortly. 💙",
  ar: 'عذراً، لا أستطيع الإجابة عن ذلك الآن. سيتواصل معك الممرض/ة قريباً. 💙',
  hi: 'माफ़ कीजिए, मैं अभी इसका जवाब नहीं दे पा रहा हूँ। नर्स जल्द ही आपसे संपर्क करेंगी। 💙',
  ta: 'மன்னிக்கவும், இப்போது இதற்குப் பதிலளிக்க முடியவில்லை. செவிலியர் விரைவில் உங்களைத் தொடர்பு கொள்வார். 💙',
  tl: 'Pasensya na, hindi ko ito masagot ngayon. Makikipag-ugnayan sa iyo ang isang nurse sa lalong madaling panahon. 💙',
}


/**
 * What the patient's message is, as judged by the model. Escalation is derived
 * from this in code (see deriveEscalation) rather than trusted from the model:
 *  - acknowledgement / greeting / social  → never escalate
 *  - question_in_scope                    → escalate only on low confidence
 *  - question_out_of_scope                → escalate (nurse follow-up, low)
 *  - concern                              → escalate (medium; high if it matches
 *                                            the patient's emergency symptoms)
 */
export type ChatIntent =
  | 'acknowledgement'
  | 'greeting'
  | 'social'
  | 'question_in_scope'
  | 'question_out_of_scope'
  | 'concern'

export type EscalationSeverity = 'low' | 'medium' | 'high'

export interface ChatResult {
  intent: ChatIntent
  answer: string
  confidence: 'high' | 'medium' | 'low'
  shouldEscalate: boolean
  severity?: EscalationSeverity
  escalationReason?: string
  /** Model that produced the answer (a fallback when the primary was busy); unset when nothing answered. */
  model?: string
}

const CHAT_INTENTS: ReadonlySet<string> = new Set<ChatIntent>([
  'acknowledgement', 'greeting', 'social', 'question_in_scope', 'question_out_of_scope', 'concern',
])

interface RawModelOutput {
  intent?: string
  answer?: string
  confidence?: string
  matchesEmergencySymptom?: boolean
  escalationReason?: string | null
}

/**
 * Turns the model's classification into the escalation decision. Deterministic,
 * so a thank-you can never page a nurse and a symptom report always does.
 */
export function deriveEscalation(raw: RawModelOutput): Pick<ChatResult, 'intent' | 'confidence' | 'shouldEscalate' | 'severity' | 'escalationReason'> {
  const intent: ChatIntent = CHAT_INTENTS.has(raw.intent ?? '') ? (raw.intent as ChatIntent) : 'question_out_of_scope'
  const confidence: ChatResult['confidence'] =
    raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low' ? raw.confidence : 'low'
  const reason = raw.escalationReason ?? undefined

  switch (intent) {
    case 'acknowledgement':
    case 'greeting':
    case 'social':
      return { intent, confidence, shouldEscalate: false }
    case 'question_in_scope':
      return confidence === 'low'
        ? { intent, confidence, shouldEscalate: true, severity: 'low', escalationReason: reason ?? 'Low-confidence answer to an in-scope question' }
        : { intent, confidence, shouldEscalate: false }
    case 'question_out_of_scope':
      return { intent, confidence, shouldEscalate: true, severity: 'low', escalationReason: reason ?? 'Question outside the discharge summary' }
    case 'concern':
      return {
        intent,
        confidence,
        shouldEscalate: true,
        severity: raw.matchesEmergencySymptom ? 'high' : 'medium',
        escalationReason: reason ?? (raw.matchesEmergencySymptom ? 'Patient reported an emergency warning sign' : 'Patient reported a symptom or concern'),
      }
  }
}

export interface ApprovedGuidance {
  category: string
  answer: Record<string, string>  // language → answer
}

/**
 * Answers a patient question using only the approved discharge context.
 */
export async function answerPatientQuestion(params: {
  question: string
  patientName: string
  language: string
  summary: DischargeSummary
  medications: Medication[]
  approvedGuidance: ApprovedGuidance[]
}): Promise<ChatResult> {
  const { question, patientName, language, summary, medications, approvedGuidance } = params
  // The model is told "Hindi", not "hi" — a bare code reads like a greeting.
  const languageName = SUPPORTED_LANGUAGES[language as LanguageCode] ?? language
  const fallbackAnswer = FALLBACK_ANSWER[language as LanguageCode] ?? FALLBACK_ANSWER.en

  // Build context from discharge summary
  const medContext = medications
    .map((m) => `- ${m.name} ${m.dosage}, ${m.frequency}${m.instructions ? ` (${m.instructions})` : ''}`)
    .join('\n')

  const guidanceContext = approvedGuidance
    .map((g) => {
      const answer = g.answer[language] ?? g.answer['en'] ?? ''
      return answer ? `[${g.category}] ${answer}` : ''
    })
    .filter(Boolean)
    .join('\n')

  const prompt = `You are a compassionate, professional patient care assistant for CareLoop.
You MUST only answer from the information provided below. Do NOT give any medical advice beyond what is in the discharge summary.

Patient: ${patientName}
Patient's preferred language: ${languageName}

=== DISCHARGE SUMMARY ===
Emergency symptoms to watch for: ${summary.emergency_symptoms.join(', ') || 'None specified'}
Lifestyle instructions: ${summary.lifestyle_instructions.join('; ') || 'None'}
Restrictions: ${summary.restrictions.join('; ') || 'None'}
Recommended activities: ${summary.activities.join('; ') || 'None'}

=== MEDICATIONS ===
${medContext || 'No medications on record'}

=== HOSPITAL APPROVED GUIDANCE ===
${guidanceContext || 'No additional guidance available'}

=== PATIENT MESSAGE ===
"${question}"

Step 1 — classify the message as exactly one intent:
- "acknowledgement": the patient is confirming, agreeing or thanking (e.g. "taken", "done", "ok thanks", "I took my tablets", "understood"). Nothing needs answering.
- "greeting": a hello or similar with no question.
- "social": small talk or a pleasantry with no medical content.
- "question_in_scope": a question you CAN answer from the discharge summary, medications or approved guidance above.
- "question_out_of_scope": a question you CANNOT answer from the information above, or one asking you to diagnose, recommend or change medication/doses, or give advice beyond the summary.
- "concern": the patient reports a symptom, side effect, pain, feeling unwell, or worry about their health — even mildly.

Step 2 — write the reply:
- acknowledgement / greeting / social: one warm sentence. No medical content. Do not say a nurse will contact them.
- question_in_scope: answer from the information above only. 2–4 sentences.
- question_out_of_scope: say you can't answer that from their discharge instructions and a member of the care team will follow up. Do not guess.
- concern: acknowledge with empathy, remind them of the relevant discharge instruction if there is one, and say a nurse will be in touch. If the concern matches any listed emergency symptom, tell them to seek emergency care immediately and set matchesEmergencySymptom to true.

Rules: write the answer in ${languageName}, the patient's preferred language, whatever language their message is in; be warm, clear and brief; never diagnose, prescribe, or advise beyond the discharge summary.

Respond ONLY with valid JSON:
{
  "intent": "acknowledgement" | "greeting" | "social" | "question_in_scope" | "question_out_of_scope" | "concern",
  "answer": "your reply to the patient",
  "confidence": "high" | "medium" | "low",
  "matchesEmergencySymptom": true | false,
  "escalationReason": "one short sentence if a nurse should follow up, else null"
}`

  try {
    // The webhook runs this inside after() with a 60 s ceiling; leave room for the reply.
    // No thinking step: the patient is waiting on WhatsApp, and thinking was most
    // of a 27 s reply. Emergencies never get here (keywords in intent.ts).
    const { text, model } = await generate(prompt, { label: 'patient-chat', budgetMs: 25_000, noThinking: true })

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Invalid AI response')

    const raw = parseModelJson(jsonMatch[0]) as RawModelOutput
    const decision = deriveEscalation(raw)
    return {
      ...decision,
      answer: raw.answer?.trim() || fallbackAnswer,
      model,
    }
  } catch {
    // Fail closed for anything we could not classify: the patient asked something
    // and nobody answered, so a nurse should look. (Plain acknowledgements never
    // reach this function — see lib/ai/intent.ts.)
    return {
      intent: 'question_out_of_scope',
      answer: fallbackAnswer,
      confidence: 'low',
      shouldEscalate: true,
      severity: 'low',
      escalationReason: 'AI response unavailable or unparseable',
    }
  }
}
