export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RiskBadge } from '@/components/shared/risk-badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { LanguageBadge } from '@/components/shared/language-badge'
import { ArrowLeft, Plus, Phone, Calendar, FileText, Users } from 'lucide-react'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RiskLevel, EpisodeStatus, LanguageCode } from '@/types/enums'

export async function generateMetadata() {
  return { title: 'Patient history' }
}

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { hospital } = await requireSession()
  const tz = hospital.timezone
  const { id } = await params
  const supabase = await createClient()

  const { data: patient } = await supabase
    .from('patients')
    .select(`
      *,
      profiles!patients_assigned_nurse_id_fkey(id, full_name),
      care_episodes(id, status, discharge_date, current_risk_level, created_at, started_at)
    `)
    .eq('id', id)
    .single()

  if (!patient) notFound()

  const episodes = (patient.care_episodes ?? []) as {
    id: string
    status: EpisodeStatus
    discharge_date: string
    current_risk_level: RiskLevel
    created_at: string
    started_at: string | null
  }[]

  const nurse = patient.profiles as { id: string; full_name: string } | null

  // Other patients registered on the same WhatsApp number (RLS-scoped: a nurse
  // sees those they are allowed to see; the webhook itself routes on all).
  const { data: sameNumber } = await supabase
    .from('patients')
    .select('id, full_name')
    .eq('hospital_id', hospital.id)
    .eq('phone_e164', patient.phone_e164)
    .neq('id', id)
    .order('full_name')
  const sharesNumberWith = (sameNumber ?? []) as { id: string; full_name: string }[]

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Back */}
      <Link href="/patients" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Patients
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{patient.full_name}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className="font-mono text-xs">{patient.mrn}</Badge>
            <LanguageBadge language={patient.preferred_language as LanguageCode} />
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <Phone className="w-3 h-3" />
              {patient.phone_e164}
            </div>
            {sharesNumberWith.length > 0 && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground" title="Registered on the same WhatsApp number">
                <Users className="w-3 h-3" aria-hidden="true" />
                <span>
                  shared with{' '}
                  {sharesNumberWith.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ', '}
                      <Link href={`/patients/${p.id}`} className="underline underline-offset-2 hover:text-foreground">{p.full_name}</Link>
                    </span>
                  ))}
                </span>
              </div>
            )}
          </div>
        </div>
        <Link href="/episodes/new" className={cn(buttonVariants({ size: 'sm' }), 'h-9')}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          New care plan
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Patient info */}
        <Card className="md:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {patient.date_of_birth && (
              <div>
                <span className="text-muted-foreground">Date of birth</span>
                <p className="font-medium">{fmt(patient.date_of_birth, 'dd MMM yyyy', tz)}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Assigned nurse</span>
              <p className="font-medium">{nurse?.full_name ?? 'Unassigned'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Registered</span>
              <p className="font-medium">{fmt(patient.created_at, 'dd MMM yyyy', tz)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Care plans</span>
              <p className="font-medium">{episodes.length}</p>
            </div>
          </CardContent>
        </Card>

        {/* Episodes */}
        <div className="md:col-span-2 space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Care plans
          </h2>

          {episodes.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No care plans yet</p>
              </CardContent>
            </Card>
          ) : (
            episodes.map((ep) => (
              <Link key={ep.id} href={`/episodes/${ep.id}`} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="transition-shadow duration-200 hover:ring-brand/50 cursor-pointer">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={ep.status} />
                          <RiskBadge level={ep.current_risk_level} />
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          Discharged {fmt(ep.discharge_date, 'dd MMM yyyy', tz)}
                        </div>
                      </div>

                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
