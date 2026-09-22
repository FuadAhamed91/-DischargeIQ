export const dynamic = 'force-dynamic'

import { requireSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import { Building2, User, Globe, Phone, Shield, Bell, Users } from 'lucide-react'
import { LanguageBadge } from '@/components/shared/language-badge'
import type { LanguageCode } from '@/types/enums'

export const metadata = { title: 'Settings' }

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  hospital_admin: 'Hospital Admin',
  discharge_coordinator: 'Discharge Coordinator',
  nurse: 'Nurse',
  case_manager: 'Case Manager',
  read_only: 'Read Only',
}

const SUPPORTED_LANGUAGES: LanguageCode[] = ['en', 'ar', 'hi', 'ta', 'tl']

export default async function SettingsPage() {
  const { profile } = await requireSession()
  const supabase = await createClient()

  const [{ data: hospital }, { data: department }, { count: staffCount }, { data: openEpisodes }] = await Promise.all([
    supabase
      .from('hospitals')
      .select('name, slug, timezone, whatsapp_phone_number_id, settings, is_active, created_at')
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

  const hospitalSettings = (hospital?.settings ?? {}) as {
    languages?: string[]
    escalation_threshold_hours?: number
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your profile and hospital configuration
        </p>
      </div>

      {/* Profile card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" /> Your Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between">
            <div className="w-12 h-12 rounded-full bg-brand text-brand-foreground flex items-center justify-center text-lg font-bold">
              {profile.full_name.split(' ').map((n: string) => n[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <Badge variant="secondary">{ROLE_LABELS[profile.role] ?? profile.role}</Badge>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Full name</p>
              <p className="font-medium">{profile.full_name}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Department</p>
              <p className="font-medium">{department?.name ?? 'Not assigned'}</p>
            </div>
            {profile.phone && (
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Phone</p>
                <p className="font-medium flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-muted-foreground" /> {profile.phone}
                </p>
              </div>
            )}
            <div>
              <p className="text-muted-foreground text-xs mb-0.5">Account status</p>
              <Badge variant={profile.is_active ? 'default' : 'destructive'} className="text-xs">
                {profile.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Hospital card */}
      {hospital && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="w-4 h-4" /> Hospital Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Hospital name</p>
                <p className="font-medium">{hospital.name}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Slug</p>
                <p className="font-medium font-mono text-xs bg-muted px-2 py-1 rounded w-fit">{hospital.slug}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5 flex items-center gap-1">
                  <Globe className="w-3 h-3" /> Timezone
                </p>
                <p className="font-medium">{hospital.timezone}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-0.5">Active staff</p>
                <p className="font-medium">{staffCount ?? 0} members</p>
              </div>
            </div>

            <Separator />

            {/* WhatsApp */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">WhatsApp Integration</p>
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${hospital.whatsapp_phone_number_id ? 'bg-success' : 'bg-muted-foreground'}`} />
                <span className="text-sm">
                  {hospital.whatsapp_phone_number_id ? 'Connected' : 'Not configured'}
                </span>
                {hospital.whatsapp_phone_number_id && (
                  <Badge variant="outline" className="text-xs font-mono">
                    ID: {hospital.whatsapp_phone_number_id.slice(0, 8)}…
                  </Badge>
                )}
              </div>
              <div className="mt-3 text-sm">
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <Users className="w-3.5 h-3.5" aria-hidden="true" />
                  {sharedNumbers.length === 0
                    ? 'No number is shared by more than one open episode.'
                    : `${sharedNumbers.length} ${sharedNumbers.length === 1 ? 'number is' : 'numbers are'} shared by more than one open episode — messages from them are routed by context, and the sender is asked when it is unclear.`}
                </p>
                {sharedNumbers.length > 0 && (
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
                )}
              </div>
            </div>

            <Separator />

            {/* Languages */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                <Globe className="w-3 h-3" /> Supported Languages
              </p>
              <div className="flex gap-2 flex-wrap">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <LanguageBadge key={lang} language={lang} />
                ))}
              </div>
            </div>

            <Separator />

            {/* Escalation settings */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                <Bell className="w-3 h-3" /> Escalation Settings
              </p>
              <p className="text-sm">
                Unconfirmed appointments escalate after{' '}
                <span className="font-medium">{hospitalSettings.escalation_threshold_hours ?? 48} hours</span>
              </p>
            </div>

            <Separator />

            {/* Security */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                <Shield className="w-3 h-3" /> Security
              </p>
              <div className="space-y-1.5 text-sm text-muted-foreground">
                <p>✓ Row-level security enabled on all patient data</p>
                <p>✓ WhatsApp webhook signature verification active</p>
                <p>✓ All AI interactions logged for audit</p>
                <p>✓ HIPAA-aligned data access controls</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Version info */}
      <p className="text-xs text-muted-foreground text-center pb-2">
        DischargeIQ v0.1 · Built for Healthcare Innovation Hackathon 2026
      </p>
    </div>
  )
}
