import path from 'node:path'
import Link from 'next/link'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Setup needed' }

/**
 * There is no login screen: every visitor is signed in as the hospital admin
 * by the proxy (lib/supabase/demo-sign-in.ts). When that cannot happen, the
 * proxy sends the visitor here, and this page says what is missing and exactly
 * where to get it.
 */
export default function SetupPage() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const hasServiceKey = key !== '' && !key.startsWith('paste-')
  const local = process.env.NODE_ENV === 'development'

  // https://<ref>.supabase.co → the project's API keys page in the dashboard.
  let apiKeysUrl = 'https://supabase.com/dashboard/project/_/settings/api-keys'
  try {
    const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname.split('.')[0]
    if (ref) apiKeysUrl = `https://supabase.com/dashboard/project/${ref}/settings/api-keys`
  } catch {
    // No or malformed URL: the generic link still lands on the right page after choosing a project.
  }
  const envFile = path.join(process.cwd(), '.env.local')

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-lg space-y-4 rounded-xl border bg-card p-6 text-sm">
        <h1 className="text-lg font-semibold">The dashboard can&apos;t open yet</h1>

        {hasServiceKey ? (
          <p className="text-muted-foreground">
            The server could not sign in as the hospital admin. Supabase needs an active profile with the
            role <code>hospital_admin</code>, and <code>SUPABASE_SERVICE_ROLE_KEY</code> must be this
            project&apos;s <code>service_role</code> key.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground">
              The app signs every visitor in as the hospital admin, and for that the server needs the
              project&apos;s <code>service_role</code> key. It is a secret, so it is not in the repo — paste it
              once:
            </p>
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Open{' '}
                <a href={apiKeysUrl} target="_blank" rel="noreferrer" className="font-medium text-brand underline underline-offset-2">
                  this project&apos;s API keys in Supabase
                </a>
                , choose the <strong>Legacy API Keys</strong> tab, and next to <code>service_role</code> click
                Reveal, then Copy.
              </li>
              {local ? (
                <li>
                  Open <code className="break-all">{envFile}</code> and put it after{' '}
                  <code>SUPABASE_SERVICE_ROLE_KEY=</code> (replacing <code>paste-the-service-role-key-here</code>
                  ). Save — the dev server picks it up by itself.
                </li>
              ) : (
                <li>
                  Add it as <code>SUPABASE_SERVICE_ROLE_KEY</code> in the Vercel project&apos;s environment
                  variables and redeploy.
                </li>
              )}
              <li>Click Try again.</li>
            </ol>
          </>
        )}

        <Link href="/" className="inline-block font-medium text-brand underline underline-offset-2">Try again</Link>
      </div>
    </main>
  )
}
