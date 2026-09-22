/**
 * Twilio delivery receipts.
 *
 * Every send asks Twilio to report back to the same webhook (StatusCallback,
 * set in client.ts), so the transcript can show whether a message was
 * delivered or read — or failed, with the reason in plain language (63016:
 * outside WhatsApp's 24-hour window, 63015: not joined to the sandbox, …;
 * see lib/whatsapp/delivery.ts, which also raises the nurse's alert).
 *
 * A receipt is a POST with MessageStatus and no message body. Statuses can
 * arrive out of order, so a row only ever moves forward:
 * sent → delivered → read, or → failed.
 */

import type { ServiceClient } from './recipient'
import { applyDeliveryStatus } from './delivery'

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

/**
 * Applies a receipt to the logged message: status, plain-language reason,
 * and — on a failure — the nurse's alert. Unknown SIDs (older rows, other
 * senders) are ignored.
 */
export async function applyStatusCallback(supabase: ServiceClient, receipt: StatusCallback): Promise<void> {
  const code = receipt.errorCode ? Number(receipt.errorCode) : null
  const result = await applyDeliveryStatus({
    supabase,
    messageSid: receipt.messageSid,
    twilioStatus: receipt.status,
    errorCode: Number.isFinite(code) ? code : null,
    errorMessage: receipt.errorMessage,
  })
  if (result.outcome === 'updated' && result.status === 'failed') {
    console.warn(`[WhatsApp] ${receipt.messageSid} ${receipt.status} error=${receipt.errorCode ?? '-'} alerted=${result.alerted}`)
  }
}
