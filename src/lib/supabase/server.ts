import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

// Database generic is omitted until `npm run gen:types` is run against a live project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = ReturnType<typeof createServerClient<any>>

export async function createClient(): Promise<AnyClient> {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // setAll called from a Server Component — can be safely ignored
            // if you have middleware refreshing sessions
          }
        },
      },
    },
  )
}

/**
 * Service-role client: bypasses RLS for server-side work (cron, webhooks,
 * extraction, message logging) after the route has done its own auth check.
 *
 * Deliberately NOT built with @supabase/ssr + cookies: that client sends the
 * signed-in user's JWT as the bearer whenever a session cookie is present, so
 * inside a nurse-triggered API route it silently acted as the nurse and every
 * write to a table with SELECT-only policies (timeline events, conversations,
 * messages) came back 403. Never expose SUPABASE_SERVICE_ROLE_KEY to the browser.
 */
export async function createServiceClient(): Promise<AnyClient> {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  ) as unknown as AnyClient
}
