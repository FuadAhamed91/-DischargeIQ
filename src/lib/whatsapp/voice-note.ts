/**
 * Patients' voice notes: the audio is kept so a nurse can listen to it on the
 * Conversation tab, and the logged message carries what was heard and how
 * clearly. A note heard clearly — clarity at or above VOICE_CLARITY_THRESHOLD
 * — is handled like a typed message; anything less goes to a nurse, unless
 * what was heard is red (webhook-handler.ts, takeVoiceNote).
 */

import type { ServiceClient } from './recipient'

/** Private bucket (migration 00016): <hospital_id>/<episode_id>/<message SID>.<ext>, readable by that hospital's staff. */
export const VOICE_NOTES_BUCKET = 'voice-notes'

/**
 * Clarity (0–100, the model's own estimate) from which a voice note is acted
 * on without a nurse listening first. A starting point: tune it once real
 * notes have been heard.
 */
export const VOICE_CLARITY_THRESHOLD = 80

/** What the transcript bubble needs to know about a voice note (whatsapp_messages.metadata.voice). */
export interface VoiceNoteMeta {
  clarity: number | null
  clear: boolean
}

export function heardClearly(heard: { transcript: string; clarity: number | null }): boolean {
  return heard.transcript.length > 0 && heard.clarity !== null && heard.clarity >= VOICE_CLARITY_THRESHOLD
}

const EXTENSIONS: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/aac': 'aac', 'audio/amr': 'amr', 'audio/wav': 'wav', 'audio/webm': 'webm',
}

/** Keeps the audio. The storage path, or null when it could not be stored (the note is still handled). */
export async function storeVoiceNote(
  supabase: ServiceClient,
  params: { hospitalId: string; episodeId: string; name: string; audio: Buffer; mimeType: string },
): Promise<string | null> {
  const path = `${params.hospitalId}/${params.episodeId}/${params.name}.${EXTENSIONS[params.mimeType] ?? 'bin'}`
  const { error } = await supabase.storage
    .from(VOICE_NOTES_BUCKET)
    .upload(path, params.audio, { contentType: params.mimeType, upsert: true })
  if (error) {
    console.error(`[Voice note] could not store ${path}:`, error.message)
    return null
  }
  return path
}

/**
 * Puts what was heard on the logged message: the transcript becomes its text
 * (so the transcript bubble and Translate work as for typed messages), with
 * the audio's path and how clearly it was heard.
 */
export async function recordVoiceNote(
  supabase: ServiceClient,
  messageId: string,
  voice: { transcript: string; clarity: number | null; audioPath: string | null },
): Promise<void> {
  const { data } = await supabase.from('whatsapp_messages').select('metadata').eq('id', messageId).maybeSingle()
  const meta: VoiceNoteMeta = { clarity: voice.clarity, clear: heardClearly(voice) }
  const { error } = await supabase
    .from('whatsapp_messages')
    .update({
      content: voice.transcript,
      media_storage_path: voice.audioPath,
      metadata: { ...((data?.metadata as Record<string, unknown> | null) ?? {}), voice: meta },
    })
    .eq('id', messageId)
  if (error) console.error(`[Voice note] could not record on message ${messageId}:`, error.message)
}
