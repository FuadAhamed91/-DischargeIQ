import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'

export interface Reminder {
  key: string
  href: string
  text: ReactNode
}

/** What a nurse still has to follow up, each one a link to where it gets done. */
export function KeyReminders({ reminders, empty }: { reminders: Reminder[]; empty: ReactNode }) {
  return (
    <section aria-labelledby="key-reminders" className="rounded-lg border bg-muted/40 px-4 py-3.5">
      <h3 id="key-reminders" className="text-sm font-medium">Key reminders</h3>
      {reminders.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-0.5">
          {reminders.map((r) => (
            <li key={r.key}>
              <Link
                href={r.href}
                className="group -mx-2 flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm leading-snug transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />
                <span className="min-w-0 flex-1">{r.text}</span>
                <ArrowRight
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
