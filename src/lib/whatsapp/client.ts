/**
 * Twilio WhatsApp client — replaces the Meta Cloud API integration.
 *
 * Twilio sandbox: anyone who texts "join <keyword>" to the sandbox number
 * can receive/send messages without Meta Business Verification.
 *
 * Docs: https://www.twilio.com/docs/whatsapp/sandbox
 */

// ------------------------------------
// Core message types (same interface as before)
// ------------------------------------

export type TextMessage = {
  type: 'text'
  to: string
  body: string
  previewUrl?: boolean
}

export type TemplateMessage = {
  type: 'template'
  to: string
  templateName: string
  languageCode: string
  components?: WhatsAppTemplateComponent[]
}

export type InteractiveButtonMessage = {
  type: 'interactive_buttons'
  to: string
  body: string
  footer?: string
  buttons: Array<{ id: string; title: string }>
}

export type InteractiveListMessage = {
  type: 'interactive_list'
  to: string
  header?: string
  body: string
  footer?: string
  buttonText: string
  sections: Array<{
    title: string
    rows: Array<{ id: string; title: string; description?: string }>
  }>
}

export type OutboundMessage =
  | TextMessage
  | TemplateMessage
  | InteractiveButtonMessage
  | InteractiveListMessage

export interface WhatsAppTemplateComponent {
  type: 'header' | 'body' | 'button'
  sub_type?: 'quick_reply' | 'url'
  index?: number
  parameters: Array<{ type: 'text' | 'image' | 'document'; text?: string }>
}

export interface SendResult {
  messageId: string
  status: 'success' | 'failed'
  error?: string
  /** Twilio error code when the API refused the message outright (e.g. 63015 not in sandbox). */
  errorCode?: number
}

// ------------------------------------
// Credentials
// ------------------------------------

function getCredentials() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_WHATSAPP_NUMBER // e.g. whatsapp:+14155238886
  if (!sid || !token || !from) {
    throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER must be set')
  }
  return { sid, token, from }
}

// ------------------------------------
// Send helper
// ------------------------------------

/**
 * Sends a WhatsApp message via Twilio.
 * The first param (_phoneNumberId) is kept for API compatibility but is not used —
 * the sandbox number comes from TWILIO_WHATSAPP_NUMBER env var.
 *
 * Interactive button/list messages are automatically converted to plain text
 * because Twilio sandbox does not support WhatsApp interactive messages.
 */
/**
 * The exact plain-text body delivered over the Twilio sandbox (text only).
 * Exported so the transcript logs precisely what the patient received.
 */
export function renderMessageBody(message: OutboundMessage): string {
  switch (message.type) {
    case 'text':
      return message.body

    case 'template':
      // Templates aren't supported in Twilio sandbox; send a generic fallback
      return 'Message from your care team. Please reply with any questions.'

    case 'interactive_buttons': {
      const options = message.buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n')
      return `${message.body}${message.footer ? `\n_${message.footer}_` : ''}\n\n${options}\n\nReply with the number of your choice.`
    }

    case 'interactive_list': {
      const rows = message.sections.flatMap((s) => s.rows)
      const options = rows.map((r, i) => `${i + 1}. ${r.title}`).join('\n')
      return `${message.body}\n\n${options}\n\nReply with the number of your choice.`
    }
  }
}

export async function sendMessage(
  _phoneNumberId: string,
  message: OutboundMessage,
): Promise<SendResult> {
  // Missing settings fail this one send like any refused message: the caller records it and
  // carries on (an urgent symptom is still escalated) instead of the whole handler throwing.
  let credentials: ReturnType<typeof getCredentials>
  try {
    credentials = getCredentials()
  } catch (err) {
    return { messageId: '', status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
  const { sid, token, from } = credentials
  const to = message.to.startsWith('whatsapp:') ? message.to : `whatsapp:${message.to}`
  const body = renderMessageBody(message)

  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const params = new URLSearchParams({ From: from, To: to, Body: body })
  // Delivery receipts come back to the same webhook (lib/whatsapp/status-callback.ts).
  // Twilio can only reach a public URL, so a localhost app URL gets none.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  if (appUrl.startsWith('https://')) params.set('StatusCallback', `${appUrl}/api/webhooks/whatsapp`)

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
    )

    const json = await res.json() as { sid?: string; message?: string; code?: number }

    if (!res.ok) {
      return {
        messageId: '',
        status: 'failed',
        error: json.message ?? `HTTP ${res.status}`,
        errorCode: typeof json.code === 'number' ? json.code : undefined,
      }
    }

    return { messageId: json.sid ?? '', status: 'success' }
  } catch (err) {
    return { messageId: '', status: 'failed', error: String(err) }
  }
}

/**
 * Mark as read — not supported in Twilio WhatsApp; this is a no-op. The
 * parameters are kept so the handler reads the same as with the Meta API.
 */
export async function markAsRead(phoneNumberId: string, messageId: string): Promise<void> {
  // Twilio does not expose read-receipt control via API
  void phoneNumberId
  void messageId
}

/**
 * Verifies the X-Twilio-Signature header using HMAC-SHA1.
 *
 * Algorithm:
 *  1. Concatenate the full webhook URL with all POST params sorted alphabetically (key+value).
 *  2. HMAC-SHA1 of that string using the Auth Token.
 *  3. Base64 encode and compare to the header.
 */
export async function verifyTwilioSignature(
  webhookUrl: string,
  params: Record<string, string>,
  signatureHeader: string | null,
): Promise<boolean> {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken || !signatureHeader) return false

  const sortedKeys = Object.keys(params).sort()
  let data = webhookUrl
  for (const key of sortedKeys) {
    data += key + (params[key] ?? '')
  }

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(authToken),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  const computed = Buffer.from(sigBuffer).toString('base64')

  return computed === signatureHeader
}
