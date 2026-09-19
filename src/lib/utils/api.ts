import { NextResponse } from 'next/server'
import { apiSuccess, apiError } from '@/types/api'
import { createClient } from '@/lib/supabase/server'
import type { UserRole } from '@/types/enums'
import type { Profile } from '@/types/database'

/**
 * Resolves the authenticated user + profile from an API route.
 * Returns a 401 response if not authenticated.
 */
export async function resolveAuthContext(): Promise<
  | { ok: true; profile: Profile }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient()
  // Local JWT verification (see lib/supabase/middleware.ts) — no Auth round-trip.
  const { data: claimsData, error } = await supabase.auth.getClaims()
  const userId = claimsData?.claims?.sub

  if (error || !userId) {
    return {
      ok: false,
      response: NextResponse.json(apiError('Unauthorized'), { status: 401 }),
    }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (!profile) {
    return {
      ok: false,
      response: NextResponse.json(apiError('Profile not found'), { status: 401 }),
    }
  }

  return { ok: true, profile }
}

/**
 * Returns a 403 NextResponse if the user's role is below the required level.
 */
export function requireRole(userRole: UserRole, required: UserRole): NextResponse | null {
  const hierarchy: Record<UserRole, number> = {
    super_admin: 100,
    hospital_admin: 80,
    discharge_coordinator: 60,
    case_manager: 50,
    nurse: 40,
    read_only: 10,
  }
  if (hierarchy[userRole] < hierarchy[required]) {
    return NextResponse.json(
      apiError('Forbidden', 'Insufficient permissions'),
      { status: 403 },
    )
  }
  return null
}

/**
 * Validates the CRON_SECRET header for cron routes.
 */
export function validateCronSecret(request: Request): NextResponse | null {
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json(apiError('Unauthorized'), { status: 401 })
  }
  return null
}

export { apiSuccess, apiError, NextResponse }
