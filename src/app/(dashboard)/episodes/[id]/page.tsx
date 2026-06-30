export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { RiskBadge } from '@/components/shared/risk-badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { LanguageBadge } from '@/components/shared/language-badge'
import { ArrowLeft, Pencil, User, Calendar, Pill, AlertTriangle, ChevronRight } from 'lucide-react'
import { format } from 'date-fns'
import type { RiskLevel, EpisodeStatus, SummaryStatus, LanguageCode } from '@/types/enums'
import type { Medication, FollowUpRequirement, Alert } from '@/types/database'

export async function generateMetadata() {
  return { title: 'Episode Detail' }
}

export default async function EpisodeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireSession()
  const { id } = await params
  const supabase = await createClient()

  const { data: episode } = await supabase
    .from('care_episodes')
    .select(`
      *,
      patients(*),
      profiles!care_episodes_assigned_nurse_id_fkey(id, full_name),
      discharge_summaries(
        id, status, approved_at, nurse_notes,
        emergency_symptoms, lifestyle_instructions, restrictions, activities,
        medications(*),
        follow_up_requirements(*)
      ),
      discharge_documents(id, original_filename, extraction_status, created_at),
      alerts(id, type, severity, status, created_at)
    `)
    .eq('id', id)
    .single()

  if (!episode) notFound()

  const patient = episode.patients as { id: string; full_name: string; phone_e164: string; preferred_language: string; mrn: string; date_of_birth: string | null }
  const nurse = episode.profiles as { id: string; full_name: string } | null
  const summary = (episode.discharge_summaries as unknown[])?.[0] as {
    id: string; status: SummaryStatus; approved_at: string | null; nurse_notes: string | null;
    emergency_symptoms: string[]; lifestyle_instructions: string[]; restrictions: string[]; activities: string[];
    medications: Medication[]; follow_up_requirements: FollowUpRequirement[]
  } | null
  const documents = (episode.discharge_documents ?? []) as { id: string; original_filename: string; extraction_status: string; created_at: string }[]
  const openAlerts = ((episode.alerts ?? []) as Alert[]).filter((a) => a.status === 'open')

  return (
    <div className="space-y-5 max-w-5xl">
      <Link href="/patients" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> All patients
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{patient.full_name}</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge variant="outline" className="font-mono text-xs">{patient.mrn}</Badge>
            <LanguageBadge language={patient.preferred_language as LanguageCode} />
            <StatusBadge status={episode.status as EpisodeStatus} />
            <RiskBadge level={episode.current_risk_level as RiskLevel} />
          </div>
        </div>

        {summary && summary.status !== 'sent' && (
          <Link href={`/episodes/${id}/review`}>
            <Button style={{ backgroundColor: '#1C0770' }} size="sm">
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              {summary.status === 'approved' ? 'View summary' : 'Review summary'}
            </Button>
          </Link>
        )}
      </div>

      {/* Open alerts banner */}
      {openAlerts.length > 0 && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-700">
              {openAlerts.length} open alert{openAlerts.length > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-red-600">Review alerts immediately</p>
          </div>
          <Link href="/alerts">
            <Button size="sm" variant="destructive">View alerts</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: episode info */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Episode Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground text-xs">Discharge date</p>
                  <p className="font-medium">{format(new Date(episode.discharge_date), 'dd MMM yyyy')}</p>
                </div>
              </div>
              <Separator />
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-muted-foreground" />
                <div>
                  <p className="text-muted-foreground text-xs">Assigned nurse</p>
                  <p className="font-medium">{nurse?.full_name ?? 'Unassigned'}</p>
                </div>
              </div>
              {episode.compliance_score !== null && (
                <>
                  <Separator />
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Compliance score</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#30D5C8] rounded-full"
                          style={{ width: `${episode.compliance_score}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium">{(episode.compliance_score as number).toFixed(0)}%</span>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Documents
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {documents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No documents uploaded yet</p>
              ) : (
                documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between py-1">
                    <div>
                      <p className="text-sm font-medium truncate max-w-[160px]">{doc.original_filename}</p>
                      <Badge variant="secondary" className="text-xs">{doc.extraction_status}</Badge>
                    </div>
                  </div>
                ))
              )}

              {!summary && (
                <Link href={`/episodes/${id}/review`} className="block mt-2">
                  <Button variant="outline" size="sm" className="w-full text-xs">
                    Upload discharge PDF
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: summary */}
        <div className="lg:col-span-2 space-y-4">
          {!summary ? (
            <Card>
              <CardContent className="py-16 text-center">
                <Pill className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <p className="font-medium">No discharge summary yet</p>
                <p className="text-sm text-muted-foreground mb-4">Upload the discharge PDF to extract the summary</p>
                <Link href="/episodes/new">
                  <Button style={{ backgroundColor: '#1C0770' }} size="sm">Upload PDF</Button>
                </Link>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Summary status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusBadge status={summary.status} />
                  {summary.approved_at && (
                    <span className="text-xs text-muted-foreground">
                      Approved {format(new Date(summary.approved_at), 'dd MMM yyyy')}
                    </span>
                  )}
                </div>
                <Link href={`/episodes/${id}/review`}>
                  <Button variant="outline" size="sm">
                    <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
                  </Button>
                </Link>
              </div>

              {/* Medications */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Pill className="w-4 h-4" /> Medications ({summary.medications.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {summary.medications.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No medications</p>
                  ) : (
                    <div className="divide-y">
                      {summary.medications.map((med) => (
                        <div key={med.id} className="py-3 first:pt-0 last:pb-0">
                          <div className="flex items-start justify-between">
                            <div>
                              <p className="font-medium text-sm">{med.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {med.dosage} · {med.frequency}
                              </p>
                              {med.instructions && (
                                <p className="text-xs text-muted-foreground mt-0.5">{med.instructions}</p>
                              )}
                            </div>
                            <div className="flex gap-1 flex-wrap justify-end">
                              {(med.reminder_times ?? []).map((t) => (
                                <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Emergency symptoms */}
              {summary.emergency_symptoms.length > 0 && (
                <Card className="border-red-200 bg-red-50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-red-700 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Emergency Warning Signs
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5">
                      {summary.emergency_symptoms.map((s, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-red-800">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Follow-ups */}
              {summary.follow_up_requirements.length > 0 && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Follow-up Appointments</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {summary.follow_up_requirements.map((fu) => (
                      <div key={fu.id} className="flex items-start justify-between py-2 border-b last:border-0">
                        <div>
                          <p className="font-medium text-sm">{fu.specialty}</p>
                          {fu.instructions && <p className="text-xs text-muted-foreground">{fu.instructions}</p>}
                        </div>
                        {fu.deadline && (
                          <Badge variant="outline" className="text-xs shrink-0">
                            By {format(new Date(fu.deadline), 'dd MMM yyyy')}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
