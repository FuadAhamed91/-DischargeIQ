/**
 * The database side of routing a shared WhatsApp number (routing.ts is the
 * pure decision): the state of every linked conversation, and asking the
 * sender who a message is about — sent once, recorded on every linked
 * transcript so each nurse can see the question was asked.
 */

import { sendMessage, renderMessageBody } from './client'
import { readConversationState } from './fsm'
import type { ParsedInbound } from './fsm'
import { saveNumberSession } from './number-session'
import { getOrCreateConversation } from './recipient'
import type { OpenEpisodeCandidate, ServiceClient } from './recipient'
import { promptLanguage, sessionWhileAsking } from './routing'
import type { NumberSession, RoutingCandidate } from './routing'
import { buildWhoIsThisAboutMessage } from './routing-templates'
import type { LanguageCode } from '@/types/enums'

/** Candidates with their conversation state — one query for all of them; no row means idle. */
export async function loadRoutingCandidates(
  supabase: ServiceClient,
  candidates: OpenEpisodeCandidate[],
): Promise<RoutingCandidate[]> {
  const states = new Map<string, unknown>()
  if (candidates.length > 1) {
    const { data } = await supabase
      .from('whatsapp_conversations')
      .select('episode_id, conversation_state')
      .in('episode_id', candidates.map((c) => c.episode.id))
    for (const row of (data ?? []) as Array<{ episode_id: string; conversation_state: unknown }>) {
      states.set(row.episode_id, row.conversation_state)
    }
  }
  return candidates.map((c) => ({
    patientId: c.patient.id,
    patientName: c.patient.full_name,
    episodeId: c.episode.id,
    language: (c.patient.preferred_language as LanguageCode) ?? 'en',
    state: readConversationState(states.get(c.episode.id)).state,
  }))
}

export interface AskParams {
  supabase: ServiceClient
  phoneNumberId: string
  hospitalId: string
  phone: string
  options: RoutingCandidate[]
  held: ParsedInbound | null
  repeat: boolean
  session: NumberSession
}

/**
 * Ask "who is this message about?", remember that we asked (and what we are
 * holding), and log the question on each linked conversation. One Twilio
 * send, so the SID goes on the first transcript row and the copies carry
 * none (wa_message_id is UNIQUE).
 */
export async function askWhoIsThisAbout(params: AskParams): Promise<void> {
  const { supabase, phoneNumberId, hospitalId, phone, options, held, repeat, session } = params
  const prompt = buildWhoIsThisAboutMessage({
    to: phone,
    options: options.map((o) => ({ name: o.patientName })),
    language: promptLanguage(options),
    repeat,
    holding: held !== null,
  })

  const result = await sendMessage(phoneNumberId, prompt)
  await saveNumberSession(supabase, hospitalId, phone, sessionWhileAsking(session, options, held, repeat))

  const body = renderMessageBody(prompt)
  const metadata = {
    kind: 'routing_prompt',
    options: options.map((o) => o.patientName),
    holding: held !== null,
    ...(result.status === 'failed' ? { error: result.error ?? 'send failed' } : {}),
  }
  let first = true
  for (const option of options) {
    const conversation = await getOrCreateConversation(supabase, {
      episodeId: option.episodeId,
      hospitalId,
      patientId: option.patientId,
      phone,
    })
    if (!conversation) continue
    const { error } = await supabase.from('whatsapp_messages').insert({
      conversation_id: conversation.id,
      hospital_id: hospitalId,
      wa_message_id: first && result.messageId ? result.messageId : null,
      direction: 'outbound',
      message_type: 'text',
      content: body,
      status: result.status === 'success' ? 'sent' : 'failed',
      metadata,
    })
    if (error) console.error('[WhatsApp] could not log routing prompt:', error.message)
    first = false
  }
}
