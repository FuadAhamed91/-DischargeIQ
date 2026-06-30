/**
 * Voice triage engine.
 *
 * Pipeline:
 *  1. Download audio from Meta media API → Buffer
 *  2. Transcribe with OpenAI Whisper
 *  3. Classify risk with Gemini 2.5 Flash against patient's known emergency symptoms
 *  4. Return structured triage result
 */

import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { RiskLevel } from '@/types/enums'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const gemini = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

export interface TriageResult {
  transcript: string
  riskLevel: RiskLevel
  reasoning: string
  keySymptoms: string[]
  requiresImmediateAttention: boolean
}

/**
 * Downloads a WhatsApp media file and returns it as a Buffer.
 */
export async function downloadWhatsAppMedia(mediaId: string): Promise<Buffer> {
  const token = process.env.WHATSAPP_TOKEN
  if (!token) throw new Error('WHATSAPP_TOKEN not set')

  // Step 1: Get the media URL
  const urlRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const urlJson = await urlRes.json() as { url?: string; error?: { message: string } }
  if (!urlJson.url) throw new Error(`Media URL fetch failed: ${urlJson.error?.message}`)

  // Step 2: Download the actual file
  const fileRes = await fetch(urlJson.url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const arrayBuffer = await fileRes.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/**
 * Transcribes an audio Buffer using OpenAI Whisper.
 */
export async function transcribeAudio(audioBuffer: Buffer, mimeType = 'audio/ogg'): Promise<string> {
  const file = new File([audioBuffer.buffer as ArrayBuffer], 'audio.ogg', { type: mimeType })

  const response = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: 'en',
  })

  return response.text
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

  const result = await gemini.generateContent(prompt)
  const text = result.response.text().trim()

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
  mediaId: string
  emergencySymptoms: string[]
  patientName: string
}): Promise<TriageResult> {
  const audioBuffer = await downloadWhatsAppMedia(params.mediaId)
  const transcript = await transcribeAudio(audioBuffer)
  return classifyRisk({
    transcript,
    emergencySymptoms: params.emergencySymptoms,
    patientName: params.patientName,
  })
}
