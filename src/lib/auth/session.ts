import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Profile } from '@/types/database'
// eslint-disable-next-line @typescript-eslint/no-explicit-any

/**
 * Returns the authenticated user's profile.
 * Redirects to /login if not authenticated.
 * Call this at the top of any server component or route handler
 * that requires an authenticated user.
 */
export async function requireSession(): Promise<{ userId: string; profile: Profile }> {
  const supabase = await createClient()

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    redirect('/login')
  }

  return { userId: user.id, profile }
}

/**
 * Returns the current user's profile or null (no redirect).
 * Use in layouts that conditionally render based on auth state.
 */
export async function getSession(): Promise<{ userId: string; profile: Profile } | null> {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return null

    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (!profile) return null

    return { userId: user.id, profile }
  } catch {
    return null
  }
}
