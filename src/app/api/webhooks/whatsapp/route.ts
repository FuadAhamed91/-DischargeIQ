import { NextResponse } from 'next/server'
import {
  verifyWebhookChallenge,
  verifyWebhookSignature,
} from '@/lib/whatsapp/client'
import {
  parseWebhookPayload,
  extractPhoneNumberId,
  handleInboundMessage,
} from '@/lib/whatsapp/webhook-handler'

export const dynamic = 'force-dynamic'

// ------------------------------------
// GET — Meta webhook verification
// ------------------------------------
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const challenge = verifyWebhookChallenge(
    searchParams.get('hub.mode'),
    searchParams.get('hub.verify_token'),
    searchParams.get('hub.challenge'),
  )

  if (challenge === null) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  return new NextResponse(challenge, { status: 200 })
}

// ------------------------------------
// POST — Inbound messages + status updates
// ------------------------------------
export async function POST(request: Request) {
  // Always respond 200 immediately so Meta doesn't retry
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  // Verify HMAC signature
  const isValid = await verifyWebhookSignature(rawBody, signature)
  if (!isValid) {
    console.warn('[WhatsApp webhook] Invalid signature — rejected')
    return new NextResponse('Forbidden', { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return new NextResponse('Bad Request', { status: 400 })
  }

  // Extract the phone number ID that received the message
  const phoneNumberId = extractPhoneNumberId(body)
  if (!phoneNumberId) {
    // Status update or unknown shape — acknowledge and ignore
    return NextResponse.json({ ok: true })
  }

  // Parse messages from the payload
  const messages = parseWebhookPayload(body)

  // Process each message asynchronously (non-blocking)
  // In production use Vercel waitUntil or a job queue for longer tasks
  for (const msg of messages) {
    handleInboundMessage(phoneNumberId, msg).catch((err) => {
      console.error('[WhatsApp webhook] handler error:', err)
    })
  }

  return NextResponse.json({ ok: true })
}
