import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Setup needed' }

/**
 * There is no login screen: every visitor is signed in as the hospital admin
 * by the proxy (lib/supabase/demo-sign-in.ts). When that cannot happen, the
 * proxy sends the visitor here, and this page says which of the two things it
 * needs is missing.
 */
export default function SetupPage() {
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) && !process.env.SUPABASE_SERVICE_ROLE_KEY!.startsWith('paste-')

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-3 rounded-xl border bg-card p-6 text-sm">
        <h1 className="text-lg font-semibold">The dashboard can&apos;t open yet</h1>
        {hasServiceKey ? (
          <p className="text-muted-foreground">
            The server could not sign in as the hospital admin. Supabase needs an active profile with the
            role <code>hospital_admin</code>, and the service-role key must belong to this project.
          </p>
        ) : (
          <p className="text-muted-foreground">
            <code>SUPABASE_SERVICE_ROLE_KEY</code> is missing. Copy it from Supabase → Project Settings →
            API Keys → <code>service_role</code> into <code>.env.local</code> (locally) or the Vercel
            environment variables, then reload this page.
          </p>
        )}
        <Link href="/" className="inline-block font-medium text-brand underline underline-offset-2">Try again</Link>
      </div>
    </main>
  )
}
