import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type AuthClient = { auth: Pick<SupabaseClient['auth'], 'verifyOtp'> }

// The admin's email, looked up once per server instance.
let demoEmail: string | null = null
// Supabase keeps one magic-link token per user: a link made while another is
// being redeemed invalidates it. So sign-ins take turns here, and one that
// still loses a race (another server instance) tries again with a fresh link.
let queue: Promise<unknown> = Promise.resolve()
const ATTEMPTS = 3

/**
 * Signs the visitor in as the hospital's admin without a password: the app
 * has no login screen. The service key mints a one-time magic-link token,
 * which sends no email, and `supabase`, the proxy's cookie-bound client,
 * redeems it: that writes the session cookies onto the response. Returns false
 * when there is no active admin or Supabase refuses; the proxy then shows /setup.
 */
export function demoSignIn(supabase: AuthClient): Promise<boolean> {
  const run = queue.then(() => signIn(supabase))
  queue = run.catch(() => {})
  return run
}

async function signIn(supabase: AuthClient): Promise<boolean> {
  // No service key (a fresh clone, a preview deployment without secrets):
  // no demo sign-in, the login screen shows. createClient throws on an empty
  // key, and outside the try that took every page down with it.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return false
  try {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    if (!demoEmail) {
      // The first hospital admin: the account the demo is shown with.
      const { data: profile } = await admin
        .from('profiles')
        .select('id')
        .eq('role', 'hospital_admin')
        .eq('is_active', true)
        .order('created_at')
        .limit(1)
        .maybeSingle()
      if (!profile) return false
      const { data } = await admin.auth.admin.getUserById(profile.id)
      demoEmail = data.user?.email ?? null
      if (!demoEmail) return false
    }

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: demoEmail })
      if (error || !link.properties?.hashed_token) {
        console.error('[demo sign-in] could not make a sign-in link:', error?.message)
        demoEmail = null
        return false
      }
      const { error: verifyError } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
      if (!verifyError) return true
      console.error(`[demo sign-in] attempt ${attempt} could not sign in:`, verifyError.message)
    }
    return false
  } catch (err) {
    console.error('[demo sign-in]', err)
    return false
  }
}
