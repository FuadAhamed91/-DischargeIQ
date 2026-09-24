import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Profile } from '@/types/database'

export interface SessionHospital {
  id: string
  name: string
  timezone: string
  settings: Record<string, unknown>
  /** The number patients write to on WhatsApp (E.164), when set up. */
  whatsapp_phone_number_id: string | null
}

/**
 * Returns the authenticated user's profile.
 * Redirects to /setup if there is no session or profile (the proxy signs
 * every visitor in, so this only happens when that sign-in is impossible).
 * Call this at the top of any server component or route handler
 * that requires an authenticated user.
 */
export const requireSession = cache(async (): Promise<{ userId: string; profile: Profile; hospital: SessionHospital }> => {
  // cache(): the dashboard layout and the page both call this during one render;
  // React memoises it per request so the JWT check and profile query run once.
  const supabase = await createClient()

  const { data: claimsData, error: authError } = await supabase.auth.getClaims()
  const userId = claimsData?.claims?.sub

  if (authError || !userId) {
    redirect('/setup')
  }

  // Profile + hospital in one query; pages need the hospital's timezone to
  // render timestamps correctly (see lib/format.ts).
  const { data, error: profileError } = await supabase
    .from('profiles')
    .select('*, hospitals(id, name, timezone, settings, whatsapp_phone_number_id)')
    .eq('id', userId)
    .single()

  if (profileError || !data) {
    redirect('/setup')
  }

  const { hospitals, ...profile } = data as Profile & { hospitals: SessionHospital | null }
  const hospital: SessionHospital = hospitals ?? {
    id: profile.hospital_id, name: 'Hospital', timezone: 'Asia/Dubai', settings: {}, whatsapp_phone_number_id: null,
  }

  return { userId, profile: profile as Profile, hospital }
})

/**
 * Returns the current user's profile or null (no redirect).
 * Use in layouts that conditionally render based on auth state.
 */
export async function getSession(): Promise<{ userId: string; profile: Profile } | null> {
  try {
    const supabase = await createClient()
    const { data: claimsData } = await supabase.auth.getClaims()
    const userId = claimsData?.claims?.sub
    if (!userId) return null

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (!profile) return null

    return { userId, profile }
  } catch {
    return null
  }
}
