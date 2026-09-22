import { NextResponse, after } from 'next/server'
import { verifyTwilioSignature } from '@/lib/whatsapp/client'
import {
  parseWebhookPayload,
  extractPhoneNumberId,
  handleInboundMessage,
} from '@/lib/whatsapp/webhook-handler'
import { withSenderLock, senderKey } from '@/lib/whatsapp/sender-queue'

export const dynamic = 'force-dynamic'
// Inbound handling can include a Twilio reply and AI triage (Whisper + Gemini).
export const maxDuration = 60

// ------------------------------------
// GET — Twilio does not send a challenge; just return 200
// ------------------------------------
export async function GET() {
  return new NextResponse('OK', { status: 200 })
}

// ------------------------------------
// POST — Inbound messages from Twilio
// ------------------------------------
export async function POST(request: Request) {
  // Twilio sends application/x-www-form-urlencoded
  const rawBody = await request.text()

  // Parse form params into a plain object
  const formParams = Object.fromEntries(new URLSearchParams(rawBody).entries())

  // Verify Twilio signature (HMAC-SHA1)
  const webhookUrl =
    (process.env.NEXT_PUBLIC_APP_URL ?? '') + '/api/webhooks/whatsapp'
  const signature = request.headers.get('x-twilio-signature')

  const isValid = await verifyTwilioSignature(webhookUrl, formParams, signature)
  if (!isValid) {
    // Log and continue in dev (signature fails on localhost tunnels)
    // In production the header must be present and valid
    const isDev = process.env.NODE_ENV === 'development'
    if (!isDev) {
      console.warn('[Twilio webhook] Invalid signature — rejected')
      return new NextResponse('Forbidden', { status: 403 })
    }
    console.warn('[Twilio webhook] Invalid signature — allowed in dev mode')
  }

  // Extract the Twilio sandbox number ("To" field → identifies the hospital)
  const phoneNumberId = extractPhoneNumberId(formParams)
  if (!phoneNumberId) {
    return NextResponse.json({ ok: true })
  }

  // Parse the Twilio payload into our normalised format
  const messages = parseWebhookPayload(formParams)

  // Twilio wants a fast 200; do the real work after the response is sent.
  // after() keeps the function alive until the handler finishes — a detached
  // promise (the previous approach) can be frozen with the invocation on Vercel,
  // silently dropping the timeline write, the reply, and any triage.
  // Messages from the same sender are handled in order, one at a time;
  // different senders run side by side.
  after(async () => {
    for (const msg of messages) {
      try {
        await withSenderLock(senderKey(phoneNumberId, msg.from), () => handleInboundMessage(phoneNumberId, msg))
      } catch (err) {
        console.error('[Twilio webhook] handler error:', err)
      }
    }
  })

  // Twilio expects a 200 response (optionally with TwiML, but empty JSON is fine)
  return NextResponse.json({ ok: true })
}
