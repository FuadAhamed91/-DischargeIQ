/**
 * Thin wrapper around the Meta WhatsApp Cloud API.
 * All outbound messages go through this client.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const GRAPH_BASE = 'https://graph.facebook.com/v19.0'

function getToken(): string {
  const token = process.env.WHATSAPP_TOKEN
  if (!token) throw new Error('WHATSAPP_TOKEN env var is not set')
  return token
}

// ------------------------------------
// Core message types
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
}

// ------------------------------------
// Send helpers
// ------------------------------------

export async function sendMessage(
  phoneNumberId: string,
  message: OutboundMessage,
): Promise<SendResult> {
  const url = `${GRAPH_BASE}/${phoneNumberId}/messages`
  const token = getToken()

  let payload: Record<string, unknown>

  switch (message.type) {
    case 'text':
      payload = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'text',
        text: { body: message.body, preview_url: message.previewUrl ?? false },
      }
      break

    case 'template':
      payload = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'template',
        template: {
          name: message.templateName,
          language: { code: message.languageCode },
          components: message.components ?? [],
        },
      }
      break

    case 'interactive_buttons':
      payload = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: message.body },
          ...(message.footer ? { footer: { text: message.footer } } : {}),
          action: {
            buttons: message.buttons.map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      }
      break

    case 'interactive_list':
      payload = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(message.header ? { header: { type: 'text', text: message.header } } : {}),
          body: { text: message.body },
          ...(message.footer ? { footer: { text: message.footer } } : {}),
          action: {
            button: message.buttonText,
            sections: message.sections,
          },
        },
      }
      break
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    })

    const json = await res.json() as {
      messages?: Array<{ id: string }>
      error?: { message: string }
    }

    if (!res.ok || json.error) {
      return { messageId: '', status: 'failed', error: json.error?.message ?? `HTTP ${res.status}` }
    }

    return { messageId: json.messages?.[0]?.id ?? '', status: 'success' }
  } catch (err) {
    return { messageId: '', status: 'failed', error: String(err) }
  }
}

/**
 * Mark an inbound message as read (shows double blue ticks).
 */
export async function markAsRead(
  phoneNumberId: string,
  messageId: string,
): Promise<void> {
  const url = `${GRAPH_BASE}/${phoneNumberId}/messages`
  const token = getToken()

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  })
}

/**
 * Verify a Meta webhook challenge (GET request).
 */
export function verifyWebhookChallenge(
  mode: string | null,
  token: string | null,
  challenge: string | null,
): string | null {
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN
  if (mode === 'subscribe' && token === verifyToken) return challenge
  return null
}

/**
 * Verify the HMAC-SHA256 signature of an inbound webhook payload.
 * Returns true if valid.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  const secret = process.env.WHATSAPP_APP_SECRET
  if (!secret) return false
  if (!signatureHeader) return false

  const sig = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice(7)
    : signatureHeader

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))
  const computed = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return computed === sig
}
