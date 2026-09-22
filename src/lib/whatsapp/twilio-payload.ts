/**
 * Twilio's inbound webhook payload (application/x-www-form-urlencoded) as
 * our normalised ParsedInbound. Delivery receipts, which arrive on the same
 * webhook, are parsed by status-callback.ts.
 */

import type { ParsedInbound } from './fsm'

// ------------------------------------
// Payload parsing (Twilio form data)
// ------------------------------------

/**
 * Parses a Twilio WhatsApp webhook (application/x-www-form-urlencoded).
 *
 * Key Twilio fields:
 *   From          = whatsapp:+971501234567
 *   To            = whatsapp:+14155238886
 *   Body          = message text
 *   MessageSid    = SMxxxxxx
 *   NumMedia      = number of attached media files
 *   MediaUrl0     = URL to media (requires Twilio Basic Auth to download)
 *   MediaContentType0 = e.g. audio/ogg, image/jpeg
 *   ProfileName   = the sender's WhatsApp display name (not verified; useful on a shared phone)
 */
export function parseWebhookPayload(params: Record<string, string>): ParsedInbound[] {
  const from = (params.From ?? '').replace('whatsapp:', '')
  const sid = params.MessageSid ?? `twilio-${Date.now()}`
  const body = params.Body ?? ''
  const numMedia = parseInt(params.NumMedia ?? '0', 10)
  const mediaUrl = params.MediaUrl0 ?? ''
  const mediaContentType = params.MediaContentType0 ?? ''

  const senderName = (params.ProfileName ?? '').trim().slice(0, 80)
  const parsed: ParsedInbound = {
    waMessageId: sid,
    from,
    ...(senderName ? { senderName } : {}),
    type: 'unknown',
    timestamp: Math.floor(Date.now() / 1000),
  }

  if (numMedia > 0 && mediaContentType.startsWith('audio/')) {
    parsed.type = 'audio'
    parsed.audioUrl = mediaUrl
    parsed.audioMimeType = mediaContentType
  } else if (body.trim() !== '') {
    // A captioned picture is handled as its caption.
    parsed.type = 'text'
    parsed.text = body
  } else if (numMedia > 0 && mediaContentType.startsWith('image/')) {
    parsed.type = 'image'
  } else if (numMedia > 0) {
    parsed.type = 'document'
  }

  return [parsed]
}

/**
 * Extracts the Twilio sandbox number (the "To" field) to identify the hospital.
 * Returns the number in E.164 format (without "whatsapp:" prefix).
 */
export function extractPhoneNumberId(params: Record<string, string>): string | null {
  const to = params.To ?? ''
  return to.replace('whatsapp:', '') || null
}
