import { NextResponse } from 'next/server'
import { validateCronSecret } from '@/lib/utils/api'
import { generateNextDayJobs } from '@/lib/reminders/generator'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const authError = validateCronSecret(request)
  if (authError) return authError

  try {
    const result = await generateNextDayJobs()

    console.log(`[cron/reminders/generate] generated=${result.generated} skipped=${result.skipped}`)
    if (result.errors.length > 0) {
      console.error('[cron/reminders/generate] errors:', result.errors)
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/reminders/generate] unexpected error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
