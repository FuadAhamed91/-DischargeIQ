/**
 * Voice triage engine.
 *
 * Pipeline:
 *  1. Download audio from Twilio media URL → Buffer
 *  2. Transcribe with Gemini 2.5 Flash (audio in, text out); Whisper only as a
 *     fallback when OPENAI_API_KEY is configured — the OpenAI account ran out
 *     of credits on 2026-09-19 and silently took voice triage down with it
 *  3. Classify risk with Gemini 2.5 Flash against patient's known emergency symptoms
 *  4. Return structured triage result
 */

import OpenAI from 'openai'
import { generate } from './gemini'
import type { RiskLevel } from '@/types/enums'

// Lazy: the OpenAI SDK throws at construction when OPENAI_API_KEY is unset,
// which breaks `next build` (page-data collection) in envs without secrets.
let _openai: OpenAI | null = null
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _openai
}

export interface TriageResult {
  transcript: string
  riskLevel: RiskLevel
  reasoning: string
  keySymptoms: string[]
  requiresImmediateAttention: boolean
}

/**
 * Downloads a Twilio WhatsApp media file using Basic Auth (Account SID + Auth Token).
 */
export async function downloadTwilioMedia(mediaUrl: string): Promise<Buffer> {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set')

  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const res = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
  })

  if (!res.ok) throw new Error(`Failed to download Twilio media: ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

const TRANSCRIBE_PROMPT = `Transcribe this voice message from a patient word for word, in the language spoken (it may be English, Arabic, Hindi, Tamil or Tagalog, or a mix). Return ONLY the transcript text — no quotes, labels, translation or commentary. If nothing intelligible is said, return an empty string.`

async function transcribeWithGemini(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const { text } = await generate([
    // Twilio sends e.g. "audio/ogg; codecs=opus" — Gemini wants the bare type.
    { inlineData: { mimeType: mimeType.split(';')[0].trim() || 'audio/ogg', data: audioBuffer.toString('base64') } },
    { text: TRANSCRIBE_PROMPT },
  ], { label: 'transcribe', budgetMs: 25_000 })
  return text
}

async function transcribeWithWhisper(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const file = new File([audioBuffer.buffer as ArrayBuffer], 'audio.ogg', { type: mimeType })
  const response = await getOpenAI().audio.transcriptions.create({ model: 'whisper-1', file })
  return response.text.trim()
}

/**
 * Transcribes a voice note. Gemini first; Whisper only if a key is set and
 * Gemini failed. Throws when neither produced a transcript so the caller can
 * escalate the message to a nurse instead of losing it.
 */
export async function transcribeAudio(audioBuffer: Buffer, mimeType = 'audio/ogg'): Promise<string> {
  let geminiError: unknown
  try {
    const text = await transcribeWithGemini(audioBuffer, mimeType)
    if (text) return text
    geminiError = new Error('Gemini returned an empty transcript')
  } catch (err) {
    geminiError = err
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const text = await transcribeWithWhisper(audioBuffer, mimeType)
      if (text) return text
    } catch (err) {
      console.error('[Triage] Whisper fallback failed:', err)
    }
  }

  throw geminiError instanceof Error ? geminiError : new Error('Transcription failed')
}

/**
 * Classifies the risk level of a patient message against their known emergency symptoms.
 */
export async function classifyRisk(params: {
  transcript: string
  emergencySymptoms: string[]
  patientName: string
  specialty?: string
}): Promise<TriageResult> {
  const { transcript, emergencySymptoms, patientName } = params

  const symptomList = emergencySymptoms.length > 0
    ? emergencySymptoms.map((s) => `- ${s}`).join('\n')
    : '- Severe chest pain\n- Difficulty breathing\n- High fever\n- Uncontrolled bleeding'

  const prompt = `You are a clinical triage assistant for DischargeIQ, a post-discharge patient monitoring system.

Patient: ${patientName}
Patient's known emergency warning symptoms:
${symptomList}

Patient message/voice note transcript:
"${transcript}"

Classify the risk level and respond ONLY with valid JSON in this exact format:
{
  "riskLevel": "green" | "yellow" | "red",
  "reasoning": "Brief clinical reasoning in 1-2 sentences",
  "keySymptoms": ["symptom1", "symptom2"],
  "requiresImmediateAttention": true | false
}

Risk levels:
- RED: Patient reports symptoms matching emergency warning signs, mentions severe pain (7+/10), difficulty breathing, chest pain, signs of stroke, or any life-threatening symptoms. requiresImmediateAttention = true.
- YELLOW: Patient reports concerning symptoms not matching emergency criteria, moderate pain (4-6/10), medication side effects, or confusion about instructions. requiresImmediateAttention = false.
- GREEN: Patient is doing well, asking routine questions, reporting mild discomfort (1-3/10), or confirming medication taken. requiresImmediateAttention = false.

Be conservative — when in doubt, escalate to YELLOW or RED.`

  const { text } = await generate(prompt, { label: 'triage', budgetMs: 25_000 })

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Invalid triage response from Gemini')

  const parsed = JSON.parse(jsonMatch[0]) as {
    riskLevel: RiskLevel
    reasoning: string
    keySymptoms: string[]
    requiresImmediateAttention: boolean
  }

  return {
    transcript,
    riskLevel: parsed.riskLevel ?? 'yellow',
    reasoning: parsed.reasoning ?? '',
    keySymptoms: parsed.keySymptoms ?? [],
    requiresImmediateAttention: parsed.requiresImmediateAttention ?? false,
  }
}

/**
 * Full triage pipeline: download → transcribe → classify.
 */
export async function triageVoiceNote(params: {
  audioUrl: string
  audioMimeType?: string
  emergencySymptoms: string[]
  patientName: string
}): Promise<TriageResult> {
  const audioBuffer = await downloadTwilioMedia(params.audioUrl)
  const transcript = await transcribeAudio(audioBuffer, params.audioMimeType ?? 'audio/ogg')
  return classifyRisk({
    transcript,
    emergencySymptoms: params.emergencySymptoms,
    patientName: params.patientName,
  })
}
