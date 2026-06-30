export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { RiskBadge } from '@/components/shared/risk-badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { LanguageBadge } from '@/components/shared/language-badge'
import { EpisodeTimeline } from '@/components/patients/episode-timeline'
import { MedicationAdherence } from '@/components/patients/medication-adherence'
import { ArrowLeft, Pencil, User, Calendar, Pill, AlertTriangle, ChevronRight, Mic, Bot, Activity } from 'lucide-react'
import { format } from 'date-fns'
import type { RiskLevel, EpisodeStatus, SummaryStatus, LanguageCode } from '@/types/enums'
import type { Medication, FollowUpRequirement } from '@/types/database'

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

  // Timeline, triage assessments, AI interactions
  const [
    { data: timelineEvents },
    { data: triageAssessments },
    { data: aiInteractions },
    { data: reminderJobs },
    { count: positiveResponses },
    { data: appointments },
  ] = await Promise.all([
    supabase.from('patient_timeline_events').select('id, event_type, payload, risk_level, created_at').eq('episode_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('triage_assessments').select('id, risk_level, inbound_text, matched_symptoms, reasoning, created_at').eq('episode_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('ai_interactions').select('id, input_text, output_text, confidence, escalated, model, created_at').eq('episode_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('reminder_jobs').select('status, schedule_id').eq('episode_id', id),
    supabase.from('patient_timeline_events').select('*', { count: 'exact', head: true }).eq('episode_id', id).eq('event_type', 'reminder_response'),
    supabase.from('appointments').select('id, specialty, scheduled_at, status').eq('episode_id', id).order('scheduled_at', { ascending: true }),
  ])

  const patient = episode.patients as { id: string; full_name: string; phone_e164: string; preferred_language: string; mrn: string; date_of_birth: string | null }
  const nurse = episode.profiles as { id: string; full_name: string } | null
  const summary = (episode.discharge_summaries as unknown[])?.[0] as {
    id: string; status: SummaryStatus; approved_at: string | null; nurse_notes: string | null;
    emergency_symptoms: string[]; lifestyle_instructions: string[]; restrictions: string[]; activities: string[];
    medications: Medication[]; follow_up_requirements: FollowUpRequirement[]
  } | null
  const documents = (episode.discharge_documents ?? []) as { id: string; original_filename: string; extraction_status: string; created_at: string }[]
  const openAlerts = ((episode.alerts ?? []) as { id: string; type: string; severity: string; status: string; created_at: string }[]).filter((a) => a.status === 'open')

  // Compliance score
  const totalJobs = reminderJobs?.length ?? 0
  const posRes = positiveResponses ?? 0
  const reminderRate = totalJobs > 0 ? Math.round((posRes / totalJobs) * 100) : null
  const redTriages = triageAssessments?.filter((t) => t.risk_level === 'red').length ?? 0
  const totalTriages = triageAssessments?.length ?? 0
  const riskScore = totalTriages > 0 ? Math.round(((totalTriages - redTriages) / totalTriages) * 100) : 80
  const completedAppts = appointments?.filter((a) => a.status === 'confirmed' || a.status === 'completed').length ?? 0
  const totalAppts = appointments?.length ?? 0
  const apptRate = totalAppts > 0 ? Math.round((completedAppts / totalAppts) * 100) : 80
  const complianceScore = episode.compliance_score != null
    ? Number(episode.compliance_score)
    : reminderRate != null
      ? Math.round(reminderRate * 0.6 + riskScore * 0.3 + apptRate * 0.1)
      : null

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
            <p className="text-sm font-medium text-red-700">{openAlerts.length} open alert{openAlerts.length > 1 ? 's' : ''}</p>
            <p className="text-xs text-red-600">Review alerts immediately</p>
          </div>
          <Link href="/alerts"><Button size="sm" variant="destructive">View alerts</Button></Link>
        </div>
      )}

      {/* Top stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Compliance</p>
            <p className={`text-2xl font-bold mt-0.5 ${complianceScore === null ? 'text-muted-foreground' : complianceScore >= 80 ? 'text-green-600' : complianceScore >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
              {complianceScore !== null ? `${complianceScore}%` : '—'}
            </p>
            {complianceScore !== null && <Progress value={complianceScore} className="h-1 mt-1.5" />}
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Risk level</p>
            <div className="mt-1.5"><RiskBadge level={episode.current_risk_level as RiskLevel} /></div>
            <p className="text-xs text-muted-foreground mt-1">{totalTriages} triage assessments</p>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Reminders</p>
            <p className={`text-2xl font-bold mt-0.5 ${reminderRate === null ? 'text-muted-foreground' : reminderRate >= 70 ? 'text-green-600' : 'text-amber-600'}`}>
              {reminderRate !== null ? `${reminderRate}%` : '—'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{posRes}/{totalJobs} responded</p>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Appointments</p>
            <p className="text-2xl font-bold mt-0.5">{completedAppts}/{totalAppts}</p>
            <p className="text-xs text-muted-foreground mt-1">confirmed</p>
          </CardContent>
        </Card>
      </div>

      {/* Main tabs */}
      <Tabs defaultValue="summary">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="triage">
            Triage
            {redTriages > 0 && <span className="ml-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">{redTriages}</span>}
          </TabsTrigger>
          <TabsTrigger value="chat">AI Chat</TabsTrigger>
        </TabsList>

        {/* ── SUMMARY TAB ─────────────────────────────────────────── */}
        <TabsContent value="summary" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Episode Info</CardTitle>
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
                  <Separator />
                  <MedicationAdherence
                    medications={summary?.medications ?? []}
                    reminderJobs={reminderJobs ?? []}
                    positiveResponses={posRes}
                  />
                </CardContent>
              </Card>

              {/* Documents */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Documents</CardTitle>
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
                      <Button variant="outline" size="sm" className="w-full text-xs">Upload discharge PDF</Button>
                    </Link>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-2 space-y-4">
              {!summary ? (
                <Card>
                  <CardContent className="py-16 text-center">
                    <Pill className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="font-medium">No discharge summary yet</p>
                    <p className="text-sm text-muted-foreground mb-4">Upload the discharge PDF to extract the summary</p>
                    <Link href={`/episodes/${id}/review`}><Button style={{ backgroundColor: '#1C0770' }} size="sm">Upload PDF</Button></Link>
                  </CardContent>
                </Card>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={summary.status} />
                      {summary.approved_at && <span className="text-xs text-muted-foreground">Approved {format(new Date(summary.approved_at), 'dd MMM yyyy')}</span>}
                    </div>
                    <Link href={`/episodes/${id}/review`}><Button variant="outline" size="sm"><Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit</Button></Link>
                  </div>

                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base flex items-center gap-2"><Pill className="w-4 h-4" /> Medications ({summary.medications.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {summary.medications.length === 0 ? <p className="text-sm text-muted-foreground">No medications</p> : (
                        <div className="divide-y">
                          {summary.medications.map((med) => (
                            <div key={med.id} className="py-3 first:pt-0 last:pb-0">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="font-medium text-sm">{med.name}</p>
                                  <p className="text-xs text-muted-foreground">{med.dosage} · {med.frequency}</p>
                                  {med.instructions && <p className="text-xs text-muted-foreground mt-0.5">{med.instructions}</p>}
                                </div>
                                <div className="flex gap-1 flex-wrap justify-end">
                                  {(med.reminder_times ?? []).map((t) => <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {summary.emergency_symptoms.length > 0 && (
                    <Card className="border-red-200 bg-red-50">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Emergency Warning Signs</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1.5">
                          {summary.emergency_symptoms.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-red-800">
                              <span className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />{s}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  {summary.follow_up_requirements.length > 0 && (
                    <Card>
                      <CardHeader className="pb-3"><CardTitle className="text-base">Follow-up Appointments</CardTitle></CardHeader>
                      <CardContent className="space-y-2">
                        {summary.follow_up_requirements.map((fu) => (
                          <div key={fu.id} className="flex items-start justify-between py-2 border-b last:border-0">
                            <div>
                              <p className="font-medium text-sm">{fu.specialty}</p>
                              {fu.instructions && <p className="text-xs text-muted-foreground">{fu.instructions}</p>}
                            </div>
                            {fu.deadline && <Badge variant="outline" className="text-xs shrink-0">By {format(new Date(fu.deadline), 'dd MMM yyyy')}</Badge>}
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </div>
          </div>
        </TabsContent>

        {/* ── TIMELINE TAB ─────────────────────────────────────────── */}
        <TabsContent value="timeline" className="mt-4">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4" /> Patient Timeline
                <span className="text-xs font-normal text-muted-foreground ml-auto">Live updates</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <EpisodeTimeline initialEvents={(timelineEvents ?? []) as unknown as Parameters<typeof EpisodeTimeline>[0]['initialEvents']} episodeId={id} />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── TRIAGE TAB ─────────────────────────────────────────── */}
        <TabsContent value="triage" className="mt-4">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Mic className="w-4 h-4" /> Voice Triage History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(!triageAssessments || triageAssessments.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-6">No triage assessments yet.</p>
              ) : (
                <div className="space-y-4">
                  {triageAssessments.map((t) => (
                    <div key={t.id} className={`p-4 rounded-xl border-l-4 ${t.risk_level === 'red' ? 'border-l-red-500 bg-red-50' : t.risk_level === 'yellow' ? 'border-l-yellow-400 bg-yellow-50' : 'border-l-green-400 bg-green-50'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <Badge className={`text-xs uppercase ${t.risk_level === 'red' ? 'bg-red-500' : t.risk_level === 'yellow' ? 'bg-yellow-500 text-black' : 'bg-green-500'}`}>
                          {t.risk_level}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{format(new Date(t.created_at), 'dd MMM yyyy HH:mm')}</span>
                      </div>
                      {t.inbound_text && <p className="text-sm italic mb-2">"{t.inbound_text.slice(0, 200)}"</p>}
                      {t.reasoning && <p className="text-xs text-muted-foreground">{t.reasoning}</p>}
                      {Array.isArray(t.matched_symptoms) && t.matched_symptoms.length > 0 && (
                        <div className="flex gap-1 flex-wrap mt-2">
                          {(t.matched_symptoms as string[]).map((s, i) => <Badge key={i} variant="outline" className="text-xs">{s}</Badge>)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── AI CHAT TAB ─────────────────────────────────────────── */}
        <TabsContent value="chat" className="mt-4">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="w-4 h-4" /> AI Chat Log
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(!aiInteractions || aiInteractions.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-6">No AI interactions yet.</p>
              ) : (
                <div className="space-y-4">
                  {aiInteractions.map((ai) => (
                    <div key={ai.id} className="space-y-2 p-4 rounded-xl bg-muted/40 border">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{ai.model}</Badge>
                        {ai.escalated && <Badge variant="destructive" className="text-xs">Escalated</Badge>}
                        {ai.confidence != null && (
                          <Badge variant="secondary" className="text-xs">{Math.round(Number(ai.confidence) * 100)}% confidence</Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">{format(new Date(ai.created_at), 'dd MMM HH:mm')}</span>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground font-medium">Patient asked:</p>
                        <p className="text-sm">{ai.input_text}</p>
                      </div>
                      {ai.output_text && (
                        <div className="space-y-1 border-t pt-2">
                          <p className="text-xs text-muted-foreground font-medium">AI responded:</p>
                          <p className="text-sm text-[#1C0770]">{ai.output_text}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Appointments quick-view */}
      {appointments && appointments.length > 0 && (
        <Card className="border shadow-sm">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4" /> Appointments</CardTitle>
            <Link href={`/episodes/${id}/appointments`} className="text-xs text-[#1C0770] hover:underline flex items-center gap-0.5">
              Manage <ChevronRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {appointments.slice(0, 3).map((appt) => (
                <div key={appt.id} className="flex items-center justify-between py-1.5 border-b last:border-0">
                  <div>
                    <p className="text-sm font-medium">{appt.specialty}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(appt.scheduled_at), 'dd MMM yyyy HH:mm')}</p>
                  </div>
                  <StatusBadge status={appt.status as EpisodeStatus} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
