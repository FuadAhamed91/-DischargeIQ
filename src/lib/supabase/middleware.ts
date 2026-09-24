import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { siteConfig } from '@/config/site'
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
  const publicPaths = ['/login', '/invite', '/api/webhooks', '/api/cron', '/api/v1/auth']
  const isPublic = publicPaths.some((p) => pathname.startsWith(p))

  // Hackathon demo (siteConfig.demoSignIn): no login screen. A visitor without a
  // session is signed in as the hospital's admin and the request carries on with
  // the new session cookies; /login goes straight to the dashboard. If signing in
  // fails, /login shows the form as usual, so this cannot loop. HEAD requests
  // (uptime checks, link previews) get no session.
  if (!user && siteConfig.demoSignIn && request.method !== 'HEAD' && (!isPublic || pathname === '/login') && (await demoSignIn(supabase))) {
    if (pathname !== '/login') return supabaseResponse
    const url = request.nextUrl.clone()
    url.pathname = '/'
    const redirect = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
    return redirect
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Only redirect away from /login if the user has a profile row.
  // Without this check, users with auth but no profile get caught in a redirect loop.
  if (user && pathname === '/login') {
    const { createServerClient: createSC } = await import('@supabase/ssr')
    const adminClient = createSC(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { cookies: { getAll: () => [], setAll: () => {} } },
    )
    const { data: profile } = await adminClient
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .single()

    if (profile) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}
