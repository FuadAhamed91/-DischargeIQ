/**
 * Voice notes and triage.
 *
 *  1. downloadTwilioMedia — the audio behind a Twilio media URL
 *  2. transcribeVoiceNote — Gemini 2.5 Flash (audio in, JSON out): the words,
 *     and how clearly it heard them (0–100). Whisper only as a fallback when
 *     OPENAI_API_KEY is configured — the OpenAI account ran out of credits on
 *     2026-09-19 and silently took voice triage down with it
 *  3. classifyRisk — Gemini 2.5 Flash against the patient's own warning signs
 *
 * What happens with a note — acted on, or handed to a nurse — is decided in
 * the webhook handler (takeVoiceNote).
 */

import OpenAI from 'openai'
import { generate } from './gemini'
import { parseModelJson } from './json'
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

/** Twilio sends e.g. "audio/ogg; codecs=opus"; Gemini and Storage want the bare type. */
export function bareMimeType(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase() || 'audio/ogg'
}

/** What was heard in a voice note. */
export interface HeardVoiceNote {
  transcript: string
  /**
   * 0–100: how clearly the model says it heard the note, against the scale in
   * the prompt — its own estimate, not a measured accuracy. null when the
   * words came from the Whisper fallback, which gives none.
   */
  clarity: number | null
}

const TRANSCRIBE_PROMPT = `Transcribe this voice message from a patient word for word, in the language spoken (it may be English, Arabic, Hindi, Tamil or Tagalog, or a mix). Do not translate, correct or complete it; write [unclear] where a word cannot be made out.

Then rate how clearly you heard it, from 0 to 100:
- 90–100: every word clear.
- 80–89: clear enough to act on: at most a word or two uncertain, none that change the meaning.
- 50–79: parts missing or uncertain, so the meaning may be wrong.
- 1–49: mostly unintelligible (noise, mumbling, too quiet, cut off).
- 0: no speech, or nothing intelligible.

Answer with ONLY this JSON: {"transcript": "<the words>", "clarity": <0-100>}`

/** The model's answer. Anything unreadable counts as not heard — clarity 0 sends the note to a nurse. */
export function parseHeard(text: string): HeardVoiceNote {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { transcript: '', clarity: 0 }
  try {
    const raw = parseModelJson(match[0]) as { transcript?: unknown; clarity?: unknown }
    const transcript = typeof raw.transcript === 'string' ? raw.transcript.trim() : ''
    const clarity = typeof raw.clarity === 'number' && Number.isFinite(raw.clarity) ? Math.max(0, Math.min(100, Math.round(raw.clarity))) : 0
    return { transcript, clarity: transcript ? clarity : 0 }
  } catch {
    return { transcript: '', clarity: 0 }
  }
}

async function transcribeWithGemini(audio: Buffer, mimeType: string): Promise<HeardVoiceNote> {
  // No thinking: hearing words needs none, and the patient is waiting for an answer.
  const { text } = await generate({
    contents: [{ role: 'user', parts: [
      { inlineData: { mimeType: bareMimeType(mimeType), data: audio.toString('base64') } },
      { text: TRANSCRIBE_PROMPT },
    ] }],
    generationConfig: { responseMimeType: 'application/json' },
  }, { label: 'transcribe', budgetMs: 25_000, noThinking: true })
  return parseHeard(text)
}

async function transcribeWithWhisper(audio: Buffer, mimeType: string): Promise<string> {
  const file = new File([audio.buffer as ArrayBuffer], 'audio.ogg', { type: mimeType })
  const response = await getOpenAI().audio.transcriptions.create({ model: 'whisper-1', file })
  return response.text.trim()
}

/**
 * The words in a voice note and how clearly they were heard. Gemini first;
 * Whisper only when Gemini failed and a key is set (its words carry no
 * clarity, so they go to a nurse). "Nothing intelligible" is an answer, not a
 * failure. Throws when no model could be asked, so the caller hands the note
 * to a nurse instead of losing it.
 */
export async function transcribeVoiceNote(audio: Buffer, mimeType = 'audio/ogg'): Promise<HeardVoiceNote> {
  try {
    return await transcribeWithGemini(audio, mimeType)
  } catch (err) {
    if (!process.env.OPENAI_API_KEY) throw err
    console.error('[Triage] Gemini transcription failed, trying Whisper:', err)
    return { transcript: await transcribeWithWhisper(audio, mimeType), clarity: null }
  }
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

  const prompt = `You are a clinical triage assistant for CareLoop, a post-discharge patient monitoring system.

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

  // No thinking step, as for transcription: the patient waits on WhatsApp for
  // the result, and the rubric above is explicit (emergency words never wait on
  // it — they are answered from intent.ts).
  const { text } = await generate(prompt, { label: 'triage', budgetMs: 25_000, noThinking: true })

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Invalid triage response from Gemini')

  const parsed = parseModelJson(jsonMatch[0]) as {
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
