import { NextResponse } from 'next/server'
import { validateCronSecret } from '@/lib/utils/api'
import { generateNextDayJobs } from '@/lib/reminders/generator'
import { pruneStaleNumberSessions } from '@/lib/whatsapp/number-session'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const authError = validateCronSecret(request)
  if (authError) return authError

  try {
    const result = await generateNextDayJobs()

    // Daily housekeeping that has no cron of its own: shared-number routing
    // memory nobody has touched for a week.
    const prunedSessions = await pruneStaleNumberSessions(await createServiceClient())

    console.log(`[cron/reminders/generate] generated=${result.generated} skipped=${result.skipped} prunedSessions=${prunedSessions}`)
    if (result.errors.length > 0) {
      console.error('[cron/reminders/generate] errors:', result.errors)
    }

    return NextResponse.json({ ok: true, ...result, prunedSessions })
  } catch (err) {
    console.error('[cron/reminders/generate] unexpected error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

// Vercel Cron invokes scheduled routes with GET; keep POST for manual/curl triggering.
export { POST as GET }
