/**
 * Recording an inbound WhatsApp message on its conversation.
 *
 * Twilio redelivers a webhook whenever it does not get a timely 2xx (a cold
 * start, a network blip) and a patient can double-tap send. The MessageSid
 * is stored as whatsapp_messages.wa_message_id, which is UNIQUE, so the
 * insert doubles as an atomic claim: the delivery that wins the insert
 * handles the message, every other delivery of the same SID stops.
 */

import type { ParsedInbound } from './fsm'
import type { ServiceClient } from './recipient'

const UNIQUE_VIOLATION = '23505'

/** Cheap pre-check so a redelivery does not even resolve the sender. */
export async function alreadyHandled(supabase: ServiceClient, waMessageId: string): Promise<boolean> {
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id')
    .eq('wa_message_id', waMessageId)
    .maybeSingle()
  return Boolean(data)
}

export type LogInboundResult =
  | { status: 'logged'; messageId: string }
  | { status: 'duplicate' }
  | { status: 'failed' }

export function inboundMessageType(message: ParsedInbound): 'text' | 'interactive' | 'audio' {
  if (message.type === 'audio') return 'audio'
  if (message.type === 'interactive_reply') return 'interactive'
  return 'text'
}

export async function logInbound(params: {
  supabase: ServiceClient
  conversationId: string
  hospitalId: string
  message: ParsedInbound
  metadata?: Record<string, unknown>
}): Promise<LogInboundResult> {
  const { supabase, conversationId, hospitalId, message } = params
  // The WhatsApp profile name says who actually typed — on a shared phone
  // that is the relative, not necessarily the patient.
  const metadata = { ...(params.metadata ?? {}), ...(message.senderName ? { sender_name: message.senderName } : {}) }
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .insert({
      conversation_id: conversationId,
      hospital_id: hospitalId,
      wa_message_id: message.waMessageId,
      direction: 'inbound',
      message_type: inboundMessageType(message),
      content: message.text ?? message.interactiveTitle ?? '',
      status: 'delivered',
      ...(Object.keys(metadata).length ? { metadata } : {}),
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { status: 'duplicate' }
    console.error('[WhatsApp] could not persist inbound message:', error.message)
    return { status: 'failed' }
  }
  return { status: 'logged', messageId: data.id as string }
}
