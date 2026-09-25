export const dynamic = 'force-dynamic'

import { requireSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { Building2, User, MessageCircle, ShieldCheck, Check } from 'lucide-react'
import { LanguageBadge } from '@/components/shared/language-badge'
import { resolveClinicDays, describeClinicDays, SLOT_OPTION_COUNT } from '@/lib/appointments/slots'
import { UNCONFIRMED_AFTER_HOURS } from '@/lib/appointments/escalation'
import { resolveCheckinTime } from '@/lib/reminders/checkin'
import { cn } from '@/lib/utils'
import type { LanguageCode } from '@/types/enums'

export const metadata = { title: 'Settings' }

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  hospital_admin: 'Hospital admin',
  discharge_coordinator: 'Discharge coordinator',
  nurse: 'Nurse',
  case_manager: 'Case manager',
  read_only: 'Read only',
}

const SUPPORTED_LANGUAGES: LanguageCode[] = ['en', 'ar', 'hi', 'ta', 'tl']

const SECURITY = [
  'All patient data is protected by row-level security.',
  'Messages from WhatsApp are checked to be genuine (signature verification).',
  'Every AI interaction is logged for audit.',
  'HIPAA-aligned data access controls.',
]

export default async function SettingsPage() {
  const { profile } = await requireSession()
  const supabase = await createClient()

  const [{ data: hospital }, { data: department }, { count: staffCount }, { data: openEpisodes }] = await Promise.all([
    supabase
      .from('hospitals')
      .select('name, timezone, whatsapp_phone_number_id, settings')
      .eq('id', profile.hospital_id)
      .single(),
    profile.department_id
      ? supabase.from('departments').select('name').eq('id', profile.department_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('hospital_id', profile.hospital_id)
      .eq('is_active', true),
    // Every open episode with its patient's number: numbers that appear more
    // than once are shared (a family phone) and route by context.
    supabase
      .from('care_episodes')
      .select('id, patients!inner(id, full_name, phone_e164)')
      .eq('hospital_id', profile.hospital_id)
      .in('status', ['active', 'pending_review']),
  ])

  const byPhone = new Map<string, Array<{ episodeId: string; name: string }>>()
  for (const row of openEpisodes ?? []) {
    const p = (Array.isArray(row.patients) ? row.patients[0] : row.patients) as { id: string; full_name: string; phone_e164: string } | null
    if (!p) continue
    const list = byPhone.get(p.phone_e164) ?? []
    list.push({ episodeId: row.id as string, name: p.full_name })
    byPhone.set(p.phone_e164, list)
  }
  const sharedNumbers = [...byPhone.entries()].filter(([, list]) => list.length > 1).sort((a, b) => a[0].localeCompare(b[0]))
  const initials = profile.full_name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your account, and how patients are messaged</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Your account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-brand-foreground" aria-hidden="true">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate font-medium">{profile.full_name}</p>
              <p className="text-sm text-muted-foreground">
                {ROLE_LABELS[profile.role] ?? profile.role}
                {department?.name ? ` · ${department.name}` : ''}
                {profile.phone ? ` · ${profile.phone}` : ''}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {hospital && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Hospital
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                <Item label="Name">{hospital.name}</Item>
                <Item label="Time zone">{hospital.timezone}</Item>
                <Item label="Staff">{staffCount ?? 0} active</Item>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Patient messages
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y text-sm">
                <Row label="WhatsApp">
                  <span className="inline-flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', hospital.whatsapp_phone_number_id ? 'bg-success' : 'bg-muted-foreground')} aria-hidden="true" />
                    {hospital.whatsapp_phone_number_id ? 'Connected' : 'Not set up. Messages cannot be sent yet.'}
                  </span>
                </Row>
                <Row label="Languages">
                  <span className="flex flex-wrap gap-1.5">
                    {SUPPORTED_LANGUAGES.map((lang) => <LanguageBadge key={lang} language={lang} />)}
                  </span>
                </Row>
                <Row label="Nightly check-in">
                  Every evening at <span className="font-medium tnum">{resolveCheckinTime(hospital.settings)}</span>, once the care plan is sent
                </Row>
                <Row label="Unconfirmed appointments">
                  Become an alert if the patient hasn’t confirmed within <span className="font-medium">{UNCONFIRMED_AFTER_HOURS} hours</span> of being asked
                </Row>
                <Row label="Rescheduling">
                  A patient who asks to move an appointment is offered the next{' '}
                  <span className="font-medium">{SLOT_OPTION_COUNT} clinic days ({describeClinicDays(resolveClinicDays(hospital.settings))})</span>{' '}
                  at the same time, and picks one by number
                </Row>
                <Row label="Shared numbers">
                  {sharedNumbers.length === 0 ? (
                    <span className="text-muted-foreground">No number is used by more than one patient.</span>
                  ) : (
                    <>
                      <p className="text-muted-foreground">
                        Messages from a family phone are matched to the right patient, and the sender is asked when it’s unclear.
                      </p>
                      <ul className="mt-2 space-y-1">
                        {sharedNumbers.map(([phone, list]) => (
                          <li key={phone} className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-mono text-xs text-muted-foreground">{phone}</span>
                            <span>
                              {list.map((p, i) => (
                                <span key={p.episodeId}>
                                  {i > 0 && ', '}
                                  <Link href={`/episodes/${p.episodeId}`} className="underline underline-offset-2 hover:text-brand">{p.name}</Link>
                                </span>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Row>
              </dl>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Security
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {SECURITY.map((line) => (
              <li key={line} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <p className="pb-2 text-center text-xs text-muted-foreground">
        CareLoop v0.1 · Built for Healthcare Innovation Hackathon 2026
      </p>
    </div>
  )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  )
}

/** One setting: its name on the left from `sm` up, above it on a phone. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
