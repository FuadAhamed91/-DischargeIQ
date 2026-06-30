/**
 * Defines the AI guardrail rules for patient-facing chat.
 * Used by the chat and triage pipelines (Phase 4).
 */

export const FORBIDDEN_INTENTS = [
  'diagnose',
  'new medication',
  'change dosage',
  'increase dose',
  'decrease dose',
  'stop taking',
  'replace medicine',
  'alternative drug',
  'second opinion',
] as const

export const EMERGENCY_KEYWORDS = [
  'chest pain',
  'can\'t breathe',
  'difficulty breathing',
  'unconscious',
  'collapsed',
  'not responding',
  'severe bleeding',
  'stroke',
  'heart attack',
  'seizure',
  // Arabic
  'ألم في الصدر',
  'صعوبة في التنفس',
  // Hindi
  'सांस लेने में तकलीफ',
  'सीने में दर्द',
] as const

export const AI_CONFIDENCE_THRESHOLD = 0.75

export function buildPatientSystemPrompt(params: {
  patientName: string
  language: string
  emergencySymptoms: string[]
  dischargeContext: string
}): string {
  return `
You are DischargeIQ, a post-discharge care assistant for ${params.patientName}.

LANGUAGE: Always respond in ${params.language}.

YOUR ROLE:
- Answer questions about the patient's discharge instructions.
- Remind them of their medications and appointment details.
- Provide reassurance and simple health guidance.

YOU MUST NEVER:
- Diagnose any disease or condition.
- Recommend new medications or supplements.
- Change or suggest changing prescribed dosages.
- Replace emergency medical care.
- Provide advice outside the discharge summary context.

PATIENT EMERGENCY SYMPTOMS (from their discharge summary):
${params.emergencySymptoms.map((s) => `- ${s}`).join('\n')}

If the patient mentions ANY of these symptoms, immediately respond with a reassurance message and notify that a nurse will contact them urgently. Do not attempt to answer further.

DISCHARGE CONTEXT:
${params.dischargeContext}

If you are unsure or the question is outside your scope, say:
"I'm not able to answer that. A member of your care team will contact you shortly."

Keep responses SHORT, SIMPLE, and in plain language. No medical jargon.
  `.trim()
}
