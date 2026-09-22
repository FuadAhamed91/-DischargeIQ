/**
 * Send a WhatsApp message to a patient AND record it on their conversation.
 *
 * Every outbound path (discharge summary, appointment confirmation, reminders,
 * webhook replies) goes through here so the dashboard transcript shows both
 * sides of the conversation with the exact text the patient received.
 *
 * Failed sends are logged too (status 'failed', error in metadata) so a nurse
 * can see that a message never reached the patient.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendMessage, renderMessageBody } from './client'
import { explainDeliveryError } from './delivery'
import type { OutboundMessage, SendResult } from './client'
import type { ConversationState } from './fsm'

export interface SendAndLogParams {
  supabase: SupabaseClient
  phoneNumberId: string
  message: OutboundMessage
  episodeId: string
  hospitalId: string
  patientId: string
  /** Conversation state to enter once the message is sent (e.g. awaiting a reply). */
  nextState?: ConversationState
  /** Extra fields stored on the logged message, e.g. who typed it ({ sender: 'nurse', ... }). */
  metadata?: Record<string, unknown>
}

export interface SendAndLogResult extends SendResult {
  conversationId: string | null
  loggedMessageId: string | null
}

function messageTypeForLog(message: OutboundMessage): 'text' | 'interactive' | 'template' {
  if (message.type === 'text') return 'text'
  if (message.type === 'template') return 'template'
  return 'interactive'
}

export async function sendAndLog(params: SendAndLogParams): Promise<SendAndLogResult> {
  const { supabase, phoneNumberId, message, episodeId, hospitalId, patientId, nextState, metadata } = params
  const waPhone = message.to.replace(/^whatsapp:/, '')

  const result = await sendMessage(phoneNumberId, message)
  const now = new Date().toISOString()

  // Get-or-create the conversation (unique per episode). Only touch the state
  // when the caller asked for a transition AND the message actually went out —
  // a failed send must not leave the conversation waiting for a reply.
  const applyState = nextState && result.status === 'success'
  const { data: conversation, error: convErr } = await supabase
    .from('whatsapp_conversations')
    .upsert(
      {
        episode_id: episodeId,
        hospital_id: hospitalId,
        patient_id: patientId,
        wa_phone: waPhone,
        last_message_at: now,
        updated_at: now,
        ...(applyState ? { conversation_state: nextState } : {}),
      },
      { onConflict: 'episode_id' },
    )
    .select('id')
    .single()

  if (convErr || !conversation) {
    console.error(`[whatsapp/outbound] conversation upsert failed for episode ${episodeId}:`, convErr?.message)
    return { ...result, conversationId: null, loggedMessageId: null }
  }

  const { data: logged, error: msgErr } = await supabase
    .from('whatsapp_messages')
    .insert({
      conversation_id: conversation.id,
      hospital_id: hospitalId,
      // wa_message_id is UNIQUE; failed sends have no SID, so store null rather than ''
      wa_message_id: result.messageId || null,
      direction: 'outbound',
      message_type: messageTypeForLog(message),
      content: renderMessageBody(message),
      status: result.status === 'success' ? 'sent' : 'failed',
      metadata: result.status === 'success'
        ? { ...metadata }
        : { ...metadata, error: explainDeliveryError(result.errorCode, result.error), error_code: result.errorCode ?? null },
    })
    .select('id')
    .single()

  if (msgErr) {
    console.error(`[whatsapp/outbound] message log failed for episode ${episodeId}:`, msgErr.message)
  }

  return { ...result, conversationId: conversation.id, loggedMessageId: logged?.id ?? null }
}
