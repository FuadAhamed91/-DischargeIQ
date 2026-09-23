/**
 * Delivery receipts. Twilio tells us, per message SID, whether a message was
 * delivered, read, or failed — and with which error code. This module turns
 * that into the row the dashboard shows (whatsapp_messages.status + metadata),
 * and into an alert when a message never reached the patient.
 *
 * Status order: sent < delivered < read. failed is terminal. A late or
 * repeated callback never moves a message backwards.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { nextRowStatus } from './status-callback'
import type { StatusCallback } from './status-callback'

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

/** Plain-language reasons for the Twilio/WhatsApp error codes a hospital will actually meet. */
const EXPLANATIONS: Record<number, string> = {
  63015: 'This number has not joined the Twilio sandbox. The patient must send the "join <keyword>" message to the hospital number first.',
  63016: 'Sent outside the WhatsApp 24-hour window: free-text messages are only allowed within 24 hours of the patient\'s last message. Ask the patient to send any message to the hospital number.',
  63018: 'Sent too fast: the Twilio sandbox number can send only one message every three seconds, so a burst of replies (several people writing at once) can fail. Ask the patient to write again, or send it from the Conversation tab.',
  63024: 'The phone number is not a valid WhatsApp recipient. Check the number on the patient record.',
  63003: 'WhatsApp could not find this number. Check that it is registered on WhatsApp.',
  63013: 'WhatsApp rejected the message as a policy violation.',
  63014: 'The patient has blocked the hospital number on WhatsApp.',
  63032: 'The message could not be found at WhatsApp — it may have expired before delivery.',
  63033: 'The patient has not opted in to messages from this number.',
  63038: 'The hospital number has reached its daily WhatsApp messaging limit.',
  63049: 'WhatsApp chose not to deliver this message (too many messages to this patient).',
  21610: 'The patient has unsubscribed from messages from this number.',
  30007: 'The message was filtered by the carrier as spam.',
}

export function explainDeliveryError(code?: number | null, fallback?: string | null): string {
  if (code && EXPLANATIONS[code]) return `${EXPLANATIONS[code]} (Twilio ${code})`
  if (fallback) return code ? `${fallback} (Twilio ${code})` : fallback
  return code ? `Not delivered (Twilio error ${code})` : 'Not delivered'
}

/** Failures the patient can clear by messaging us — worth an automatic re-send when they do. */
export function isWindowOrOptInFailure(code?: number | null): boolean {
  return code === 63015 || code === 63016 || code === 63033
}

export function normaliseTwilioStatus(status: string): DeliveryStatus | null {
  switch (status.toLowerCase()) {
    case 'queued': case 'accepted': case 'sending': case 'sent':
      return 'sent'
    case 'delivered':
      return 'delivered'
    case 'read':
      return 'read'
    case 'failed': case 'undelivered':
      return 'failed'
    default:
      return null
  }
}

const ROW_STATUSES = new Set<string>(['sent', 'delivered', 'read', 'failed'])

interface StoredMessage {
  id: string
  conversation_id: string
  hospital_id: string
  status: string
  metadata: Record<string, unknown> | null
}

export interface ApplyDeliveryParams {
  supabase: SupabaseClient
  messageSid: string
  twilioStatus: string
  errorCode?: number | null
  /** Twilio's own wording, kept when we have no better explanation for the code. */
  errorMessage?: string | null
  now?: Date
}

export type ApplyDeliveryResult =
  | { outcome: 'unknown_message' }
  | { outcome: 'ignored'; reason: string }
  | { outcome: 'updated'; status: DeliveryStatus; alerted: boolean; messageId: string }

/**
 * Records a status callback on the message it is about. On the first failure
 * of a message, raises an alert for the nurse and writes the reason on the
 * timeline; later callbacks for the same message do not alert again.
 */
export async function applyDeliveryStatus(params: ApplyDeliveryParams): Promise<ApplyDeliveryResult> {
  const { supabase, messageSid, twilioStatus, errorCode } = params
  const now = params.now ?? new Date()

  if (!normaliseTwilioStatus(twilioStatus)) return { outcome: 'ignored', reason: `unknown status ${twilioStatus}` }

  const { data } = await supabase
    .from('whatsapp_messages')
    .select('id, conversation_id, hospital_id, status, metadata')
    .eq('wa_message_id', messageSid)
    .maybeSingle()
  const message = data as StoredMessage | null
  if (!message) return { outcome: 'unknown_message' }

  const current = (ROW_STATUSES.has(message.status) ? message.status : 'sent') as DeliveryStatus
  const receipt = twilioStatus.toLowerCase() === 'accepted' ? 'queued' : twilioStatus.toLowerCase()
  const status = nextRowStatus(current, receipt as StatusCallback['status'])
  if (!status) return { outcome: 'ignored', reason: `${current} already recorded` }

  const metadata: Record<string, unknown> = {
    ...(message.metadata ?? {}),
    delivery: { status: receipt, at: now.toISOString() },
    [`${status}_at`]: now.toISOString(),
  }
  if (status === 'failed') {
    metadata.error_code = errorCode ?? null
    metadata.error = explainDeliveryError(errorCode, params.errorMessage)
  }

  const { error: updateError } = await supabase
    .from('whatsapp_messages')
    .update({ status, metadata })
    .eq('id', message.id)
  if (updateError) {
    console.error('[WhatsApp delivery] update failed:', updateError.message)
    return { outcome: 'ignored', reason: updateError.message }
  }

  let alerted = false
  if (status === 'failed') {
    alerted = await raiseDeliveryAlert(supabase, message, errorCode ?? null, metadata.error as string)
  }
  return { outcome: 'updated', status, alerted, messageId: message.id }
}

/** One alert per undelivered message, with the reason on the timeline for the episode page. */
async function raiseDeliveryAlert(
  supabase: SupabaseClient,
  message: StoredMessage,
  errorCode: number | null,
  reason: string,
): Promise<boolean> {
  const { data: conversation } = await supabase
    .from('whatsapp_conversations')
    .select('episode_id, hospital_id')
    .eq('id', message.conversation_id)
    .maybeSingle()
  if (!conversation) return false

  const kind = typeof message.metadata?.kind === 'string' ? (message.metadata.kind as string) : 'message'
  const severity = kind === 'care_plan' ? 'medium' : 'low'

  const row = { episode_id: conversation.episode_id, hospital_id: conversation.hospital_id, severity }
  let { error } = await supabase.from('alerts').insert({ ...row, type: 'delivery_failed' })
  if (error && /invalid input value for enum/i.test(error.message)) {
    // Migration 00013 not applied yet: still surface it, under the generic type.
    ;({ error } = await supabase.from('alerts').insert({ ...row, type: 'escalation' }))
  }
  if (error) {
    console.error('[WhatsApp delivery] alert insert failed:', error.message)
    return false
  }

  await supabase.from('patient_timeline_events').insert({
    episode_id: conversation.episode_id,
    hospital_id: conversation.hospital_id,
    event_type: 'escalation_created',
    payload: {
      intent: 'delivery_failed',
      kind,
      message_id: message.id,
      error_code: errorCode,
      reason: kind === 'care_plan' ? `Care plan not delivered — ${reason}` : `WhatsApp message not delivered — ${reason}`,
      severity,
      resend_on_reply: kind === 'care_plan',
    },
  })
  return true
}
