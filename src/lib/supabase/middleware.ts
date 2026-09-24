import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { demoSignIn } from '@/lib/supabase/demo-sign-in'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Verify the session on every request. getClaims() checks the JWT signature
  // locally against the project's JWKS (ES256) and still refreshes an expired
  // token through the cookie adapter — unlike getUser(), it does not make a
  // network round-trip to Supabase Auth per request.
  const { data: claimsData } = await supabase.auth.getClaims()
  const user = claimsData?.claims?.sub ? { id: claimsData.claims.sub } : null

  const { pathname } = request.nextUrl

  // Public routes that don't require a user session.
  // /api/webhooks is verified by Twilio signature; /api/cron by CRON_SECRET bearer token.
  const publicPaths = ['/setup', '/invite', '/api/webhooks', '/api/cron', '/api/v1/auth']
  const isPublic = publicPaths.some((p) => pathname.startsWith(p))

  // There is no login screen. The old /login address goes to the dashboard.
  if (pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // Every visitor without a session is signed in as the hospital's admin and
  // the request carries on with the new session cookies. If that cannot
  // happen (no service key, no admin profile) the visitor lands on /setup,
  // which says what is missing. HEAD requests (uptime checks, link previews)
  // get no session.
  if (!user && !isPublic) {
    if (request.method !== 'HEAD' && (await demoSignIn(supabase))) return supabaseResponse
    const url = request.nextUrl.clone()
    url.pathname = '/setup'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
