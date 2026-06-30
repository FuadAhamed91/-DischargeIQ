/**
 * Bounded AI Q&A for patient WhatsApp messages.
 *
 * Gemini 2.5 Flash answers ONLY from the patient's approved discharge summary.
 * Out-of-scope or low-confidence questions are escalated to a nurse.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'
import type { DischargeSummary, Medication } from '@/types/database'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const gemini = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

export interface ChatResult {
  answer: string
  confidence: 'high' | 'medium' | 'low'
  shouldEscalate: boolean
  escalationReason?: string
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

  const prompt = `You are a compassionate, professional patient care assistant for DischargeIQ.
You MUST only answer from the information provided below. Do NOT give any medical advice beyond what is in the discharge summary.

Patient: ${patientName}
Patient's preferred language: ${language}

=== DISCHARGE SUMMARY ===
Emergency symptoms to watch for: ${summary.emergency_symptoms.join(', ') || 'None specified'}
Lifestyle instructions: ${summary.lifestyle_instructions.join('; ') || 'None'}
Restrictions: ${summary.restrictions.join('; ') || 'None'}
Recommended activities: ${summary.activities.join('; ') || 'None'}

=== MEDICATIONS ===
${medContext || 'No medications on record'}

=== HOSPITAL APPROVED GUIDANCE ===
${guidanceContext || 'No additional guidance available'}

=== PATIENT QUESTION ===
"${question}"

Instructions:
1. Answer ONLY if you can find the answer in the discharge summary or approved guidance above.
2. If the question relates to emergency symptoms listed above, tell the patient to seek emergency care immediately.
3. If you cannot answer confidently from the provided information, set shouldEscalate to true.
4. Always respond in the patient's preferred language (${language}).
5. Be warm, clear, and brief (2-4 sentences maximum).
6. Never diagnose, prescribe, or provide medical advice beyond the discharge summary.

Respond ONLY with valid JSON:
{
  "answer": "your response to the patient",
  "confidence": "high" | "medium" | "low",
  "shouldEscalate": true | false,
  "escalationReason": "reason if shouldEscalate is true, else null"
}`

  try {
    const result = await gemini.generateContent(prompt)
    const text = result.response.text().trim()

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Invalid AI response')

    const parsed = JSON.parse(jsonMatch[0]) as ChatResult
    return {
      answer: parsed.answer ?? "I'm sorry, I couldn't find that information. A nurse will follow up with you shortly.",
      confidence: parsed.confidence ?? 'low',
      shouldEscalate: parsed.shouldEscalate ?? true,
      escalationReason: parsed.escalationReason ?? undefined,
    }
  } catch {
    return {
      answer: "I'm having trouble answering that right now. A nurse will follow up with you shortly. 💙",
      confidence: 'low',
      shouldEscalate: true,
      escalationReason: 'AI response parsing failed',
    }
  }
}
