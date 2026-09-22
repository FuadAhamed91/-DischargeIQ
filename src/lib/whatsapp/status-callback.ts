/**
 * Twilio delivery receipts.
 *
 * Every send asks Twilio to report back to the same webhook (StatusCallback,
 * set in client.ts), so the transcript can show whether a message was
 * delivered or read — or failed, with the reason: 63016 "not joined to the
 * sandbox", 63015 "sandbox session expired", and so on.
 *
 * A receipt is a POST with MessageStatus and no message body. Statuses can
 * arrive out of order, so a row only ever moves forward:
 * sent → delivered → read, or → failed.
 */

import type { ServiceClient } from './recipient'

export interface StatusCallback {
  messageSid: string
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'undelivered' | 'failed'
  errorCode: string | null
  errorMessage: string | null
}

const STATUSES = new Set(['queued', 'sending', 'sent', 'delivered', 'read', 'undelivered', 'failed'])

/** A Twilio POST that is a delivery receipt rather than an inbound message, or null. */
export function parseStatusCallback(params: Record<string, string>): StatusCallback | null {
  const status = params.MessageStatus ?? params.SmsStatus ?? ''
  const sid = params.MessageSid ?? params.SmsSid ?? ''
  // An inbound message reports SmsStatus=received and carries a body / media.
  if (!sid || !STATUSES.has(status)) return null
  if (params.Body !== undefined || params.NumMedia !== undefined) return null
  return {
    messageSid: sid,
    status: status as StatusCallback['status'],
    errorCode: params.ErrorCode || null,
    errorMessage: params.ErrorMessage || null,
  }
}

type RowStatus = 'sent' | 'delivered' | 'read' | 'failed'
const RANK: Record<RowStatus, number> = { sent: 0, delivered: 1, read: 2, failed: 3 }

/** What the whatsapp_messages row should say after this receipt, given what it says now. */
export function nextRowStatus(current: RowStatus, receipt: StatusCallback['status']): RowStatus | null {
  const target: RowStatus | null =
    receipt === 'delivered' ? 'delivered'
      : receipt === 'read' ? 'read'
        : receipt === 'failed' || receipt === 'undelivered' ? 'failed'
          : null
  if (!target) return null                       // queued / sending / sent: nothing new
  if (current === 'failed') return null          // a failure is final
  if (RANK[target] <= RANK[current] && target !== 'failed') return null
  return target
}

/** Applies a receipt to the logged message. Unknown SIDs (older rows, other senders) are ignored. */
export async function applyStatusCallback(supabase: ServiceClient, receipt: StatusCallback): Promise<void> {
  const { data: row } = await supabase
    .from('whatsapp_messages')
    .select('id, status, metadata')
    .eq('wa_message_id', receipt.messageSid)
    .maybeSingle()
  if (!row) return

  const next = nextRowStatus(row.status as RowStatus, receipt.status)
  if (!next) return

  const metadata = { ...((row.metadata as Record<string, unknown> | null) ?? {}) }
  if (next === 'failed') {
    metadata.error = receipt.errorMessage
      ? `${receipt.errorMessage}${receipt.errorCode ? ` (${receipt.errorCode})` : ''}`
      : `Twilio ${receipt.status}${receipt.errorCode ? ` (${receipt.errorCode})` : ''}`
  } else {
    metadata[`${next}_at`] = new Date().toISOString()
  }

  const { error } = await supabase
    .from('whatsapp_messages')
    .update({ status: next, metadata })
    .eq('id', row.id)
  if (error) console.error('[WhatsApp] could not apply status callback:', error.message)
}
