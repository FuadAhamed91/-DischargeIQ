import { NextResponse } from 'next/server'
import { validateCronSecret } from '@/lib/utils/api'
import { dispatchDueReminders } from '@/lib/reminders/dispatcher'

export const dynamic = 'force-dynamic'
export const maxDuration = 60  // seconds — Vercel Pro limit

export async function POST(request: Request) {
  const authError = validateCronSecret(request)
  if (authError) return authError

  try {
    const result = await dispatchDueReminders()

    console.log(`[cron/reminders/dispatch] sent=${result.sent} failed=${result.failed} held=${result.held}`)
    if (result.errors.length > 0) {
      console.error('[cron/reminders/dispatch] errors:', result.errors)
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/reminders/dispatch] unexpected error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

// Vercel Cron invokes scheduled routes with GET; keep POST for manual/curl triggering.
export { POST as GET }
