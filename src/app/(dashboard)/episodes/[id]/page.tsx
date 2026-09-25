export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNowStrict } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/shared/status-badge'
import { EpisodeTimeline } from '@/components/patients/episode-timeline'
import { ConversationTranscript, type TranscriptMessage, type SharedNumberPatient } from '@/components/patients/conversation-transcript'
import { summariseNumberSession } from '@/lib/whatsapp/number-session'
import { countCheckinAnswers } from '@/lib/analytics/checkins'
import { ArrowLeft, Pencil, Pill, AlertTriangle, ChevronRight, CalendarDays, FileText, MessageCircle, ClipboardList, History, Upload, Send } from 'lucide-react'
import { fmt } from '@/lib/format'
import { cn } from '@/lib/utils'
import { readConversationState } from '@/lib/whatsapp/fsm'
import { LiveRefresh } from '@/components/shared/live-refresh'
import { CarePlanDeliveryBanner, CarePlanResendButton } from '@/components/episodes/care-plan-delivery'
import { RiskLevelControl } from '@/components/episodes/risk-level-control'
import { PatientAlerts, type PatientAlert } from '@/components/episodes/patient-alerts'
import { SendCheckinButton } from '@/components/episodes/send-checkin-button'
import { PatientSimulator } from '@/components/episodes/patient-simulator'
import { isSampleMrn } from '@/lib/intake/sample-letters'
import { BookFollowUp } from '@/components/appointments/book-follow-up'
import { CARE_PLAN_KIND, summariseCarePlanMessage } from '@/lib/whatsapp/care-plan'
import { SUPPORTED_LANGUAGES } from '@/types/enums'
import type { RiskLevel, EpisodeStatus, SummaryStatus, LanguageCode, AppointmentStatus } from '@/types/enums'
import type { Medication, FollowUpRequirement } from '@/types/database'

export async function generateMetadata() {
  return { title: 'Patient' }
}

const OPEN_EPISODE = ['draft', 'pending_review', 'active']
const TABS = ['conversation', 'care-plan', 'activity']

/** A patient's page: who they are, what needs a nurse now, and three tabs — the conversation, the care plan, and everything that happened. */
export default async function EpisodeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  /** ?tab=conversation or ?tab=activity opens that tab; otherwise the page opens on the care plan. */
  searchParams: Promise<{ tab?: string }>
}) {
  const { hospital, profile } = await requireSession()
  const tz = hospital.timezone
  const [{ id }, { tab }] = await Promise.all([params, searchParams])
  const canAct = ['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse', 'case_manager'].includes(profile.role)
  // The care plan itself is reviewed and sent by the roles the summary routes accept.
  const canReview = ['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'].includes(profile.role)
  const supabase = await createClient()

  // Everything keys off the route id, so the episode row and its satellite
  // queries go out together: one round trip instead of several.
  const [
    { data: episode },
    { data: timelineEvents },
    { data: reminderJobs },
    answeredCount,
    { data: appointments },
    { data: conversation },
    { data: transcriptRows },
  ] = await Promise.all([
    supabase
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
        discharge_documents(id, original_filename, created_at),
        alerts(id, type, severity, status, created_at)
      `)
      .eq('id', id)
      .single(),
    supabase.from('patient_timeline_events').select('id, event_type, payload, risk_level, created_at').eq('episode_id', id).order('created_at', { ascending: false }).limit(50),
    supabase.from('reminder_jobs').select('status').eq('episode_id', id),
    countCheckinAnswers(supabase, { hospitalId: hospital.id, episodeId: id }),
    supabase.from('appointments').select('id, specialty, scheduled_at, status, time_tbc, location, follow_up_id').eq('episode_id', id).order('scheduled_at', { ascending: true }),
    supabase.from('whatsapp_conversations').select('id, conversation_state, last_message_at').eq('episode_id', id).maybeSingle(),
    // The newest 200 messages (a long conversation would otherwise show its oldest), put back in order below.
    supabase
      .from('whatsapp_messages')
      .select('id, direction, message_type, content, status, metadata, media_storage_path, created_at, whatsapp_conversations!inner(episode_id)')
      .eq('whatsapp_conversations.episode_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  if (!episode) notFound()

  const transcript: TranscriptMessage[] = (transcriptRows ?? []).map((row) => {
    const { whatsapp_conversations, ...m } = row
    void whatsapp_conversations
    return m as TranscriptMessage
  }).reverse()
  const conversationState = readConversationState(conversation?.conversation_state)
  // Whether the care plan actually reached the patient (Twilio delivery receipts land on the message row).
  const lastCarePlanRow = [...transcript].reverse().find((m) => m.direction === 'outbound' && m.metadata?.kind === CARE_PLAN_KIND)
  const carePlanDelivery = lastCarePlanRow ? summariseCarePlanMessage(lastCarePlanRow) : null

  const patient = episode.patients as { id: string; full_name: string; phone_e164: string; preferred_language: string; mrn: string }
  const firstName = patient.full_name.split(' ')[0]

  // Shared WhatsApp number (other patients on it, what the routing remembers),
  // and whether this patient has care plans before this one.
  const [{ data: sharedRows }, { data: numberSessionRow }, { count: earlierCarePlans }] = await Promise.all([
    supabase
      .from('care_episodes')
      .select('id, patients!inner(id, full_name, phone_e164)')
      .eq('hospital_id', hospital.id)
      .eq('patients.phone_e164', patient.phone_e164)
      .in('status', ['active', 'pending_review'])
      .neq('id', id),
    supabase
      .from('whatsapp_number_sessions')
      .select('active_patient_id, active_until, pending_choice')
      .eq('hospital_id', hospital.id)
      .eq('wa_phone', patient.phone_e164)
      .maybeSingle(),
    supabase.from('care_episodes').select('id', { count: 'exact', head: true }).eq('patient_id', patient.id).neq('id', id),
  ])
  const sharedWith: SharedNumberPatient[] = (sharedRows ?? []).map((row) => {
    const p = (Array.isArray(row.patients) ? row.patients[0] : row.patients) as { id: string; full_name: string }
    return { episodeId: row.id as string, patientId: p.id, patientName: p.full_name }
  })
  const numberSession = summariseNumberSession(numberSessionRow as Parameters<typeof summariseNumberSession>[0])
  const nurse = episode.profiles as { id: string; full_name: string } | null
  // discharge_summaries.episode_id is UNIQUE, so PostgREST embeds ONE object (not an array). Accept either shape.
  const rawSummary = episode.discharge_summaries as unknown
  const summary = (Array.isArray(rawSummary) ? rawSummary[0] : rawSummary) as {
    id: string; status: SummaryStatus; approved_at: string | null; nurse_notes: string | null;
    emergency_symptoms: string[]; lifestyle_instructions: string[]; restrictions: string[]; activities: string[];
    medications: Medication[]; follow_up_requirements: FollowUpRequirement[]
  } | null
  const documents = (episode.discharge_documents ?? []) as { id: string; original_filename: string; created_at: string }[]
  const openAlerts = ((episode.alerts ?? []) as (PatientAlert & { status: string })[]).filter((a) => a.status === 'open')

  // At a glance
  const checkinsSent = (reminderJobs ?? []).filter((j) => j.status === 'sent').length
  const checkinsAnswered = Math.min(answeredCount ?? 0, checkinsSent)
  // Server-rendered once per request: "now" is the request time.
  const since = new Date().getTime() - 12 * 3600_000
  const upcoming = (appointments ?? []).filter((a) => Date.parse(a.scheduled_at) >= since && !['cancelled', 'missed', 'completed'].includes(a.status))
  const nextAppointment = upcoming[0] ?? null
  const lastInbound = [...transcript].reverse().find((m) => m.direction === 'inbound') ?? null

  const episodeOpen = OPEN_EPISODE.includes(episode.status)
  const canMessage = canAct && ['pending_review', 'active'].includes(episode.status)
  // One main button, when there is something to do before the patient hears from us.
  const nextStep = !episodeOpen || !canReview ? null
    : !summary ? { label: 'Upload discharge letter', icon: Upload }
      : summary.status === 'draft' || summary.status === 'pending_review' ? { label: 'Review care plan', icon: Pencil }
        : summary.status === 'approved' ? { label: 'Send care plan', icon: Send }
          : null
  const defaultTab = tab && TABS.includes(tab) ? tab : 'care-plan'

  const sentOn = carePlanDelivery?.createdAt ?? null
  const delivered = carePlanDelivery?.status === 'delivered' || carePlanDelivery?.status === 'read'
  const planStatus = !summary ? null
    : summary.status === 'sent'
      ? `Sent to ${firstName}${sentOn ? ` on ${fmt(sentOn, 'd MMM yyyy', tz)}` : ''} · ${delivered ? (carePlanDelivery?.status === 'read' ? 'read' : 'delivered') : carePlanDelivery?.status === 'failed' ? 'not delivered' : 'waiting for WhatsApp to confirm delivery'}`
      : summary.status === 'approved' ? 'Approved — not sent to the patient yet'
        : 'Waiting for a nurse to review — nothing has been sent to the patient'
  const bookedFollowUps = new Set((appointments ?? []).map((a) => a.follow_up_id).filter(Boolean))
  const needsDate = (summary?.follow_up_requirements ?? []).filter((f) => !bookedFollowUps.has(f.id))
  const instructions = summary
    ? [
        { title: 'Activity', items: summary.activities },
        { title: 'Avoid', items: summary.restrictions },
        { title: 'Lifestyle', items: summary.lifestyle_instructions },
      ].filter((g) => g.items.length > 0)
    : []

  return (
    <div className="max-w-5xl space-y-5">
      {/* Patient-side events (confirmations, check-in answers, triage, alerts) re-render the page live */}
      <LiveRefresh episodeId={id} events={['appointment_confirmed', 'appointment_rescheduled', 'reminder_response', 'triage_completed', 'escalation_created', 'summary_sent', 'risk_changed']} />
      <Link href="/patients" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Patients
      </Link>

      {/* Who */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{patient.full_name}</h1>
            {episode.status !== 'active' && <StatusBadge status={episode.status as EpisodeStatus} />}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span>{SUPPORTED_LANGUAGES[patient.preferred_language as LanguageCode] ?? patient.preferred_language}</span>
            <span aria-hidden="true">·</span>
            <span className="tnum">{patient.phone_e164}</span>
            <span aria-hidden="true">·</span>
            <span>MRN <span className="font-mono">{patient.mrn}</span></span>
            {episode.discharge_date && <><span aria-hidden="true">·</span><span>Discharged {fmt(episode.discharge_date, 'd MMM yyyy', tz)}</span></>}
            <span aria-hidden="true">·</span>
            <span>Nurse: {nurse?.full_name ?? 'unassigned'}</span>
            {(earlierCarePlans ?? 0) > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <Link href={`/patients/${patient.id}`} className="underline underline-offset-2 hover:text-foreground">
                  {earlierCarePlans} earlier care plan{earlierCarePlans === 1 ? '' : 's'}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Risk</p>
            <RiskLevelControl episodeId={id} level={episode.current_risk_level as RiskLevel} canChange={canMessage} />
          </div>
          {canAct && episode.status === 'active' && <SendCheckinButton episodeId={id} />}
          {nextStep && (
            <Link href={`/episodes/${id}/review`} className={cn(buttonVariants())}>
              <nextStep.icon className="h-4 w-4" aria-hidden="true" /> {nextStep.label}
            </Link>
          )}
        </div>
      </div>

      {/* What needs a nurse now */}
      {carePlanDelivery?.status === 'failed' && (
        <CarePlanDeliveryBanner episodeId={id} delivery={carePlanDelivery} patientName={patient.full_name} timezone={tz} />
      )}
      {/* Keyed on the alerts, so a live refresh that brings a new one shows it */}
      {openAlerts.length > 0 && <PatientAlerts key={openAlerts.map((a) => a.id).join()} alerts={openAlerts} timezone={tz} />}

      {/* At a glance */}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-card px-4 py-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Nightly check-ins</dt>
          <dd className="mt-0.5 font-medium">{checkinsSent === 0 ? 'None sent yet' : `${checkinsAnswered} of ${checkinsSent} answered`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Next appointment</dt>
          <dd className="mt-0.5 font-medium">
            {nextAppointment
              ? <>{nextAppointment.specialty} · {nextAppointment.time_tbc
                  ? <>due by {fmt(nextAppointment.scheduled_at, 'd MMM', tz)} <span className="font-normal text-muted-foreground">(time to confirm)</span></>
                  : fmt(nextAppointment.scheduled_at, 'EEE d MMM, HH:mm', tz)}</>
              : <span className="font-normal text-muted-foreground">None booked</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Last message from {firstName}</dt>
          <dd className="mt-0.5 font-medium">
            {lastInbound ? `${formatDistanceToNowStrict(new Date(lastInbound.created_at))} ago` : <span className="font-normal text-muted-foreground">No messages yet</span>}
          </dd>
        </div>
      </dl>

      <Tabs defaultValue={defaultTab}>
        {/* Below `sm` the icons drop so all three tabs fit a phone screen */}
        <TabsList variant="line" className="w-full justify-start border-b pb-0">
          <TabsTrigger value="conversation" data-tour="tab-conversation" className="flex-none px-2.5 sm:px-3 max-sm:[&>svg]:hidden">
            <MessageCircle aria-hidden="true" /> Conversation
            {transcript.length > 0 && <span className="text-xs text-muted-foreground tnum">{transcript.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="care-plan" className="flex-none px-2.5 sm:px-3 max-sm:[&>svg]:hidden"><ClipboardList aria-hidden="true" /> Care plan</TabsTrigger>
          <TabsTrigger value="activity" className="flex-none px-2.5 sm:px-3 max-sm:[&>svg]:hidden"><History aria-hidden="true" /> Activity</TabsTrigger>
        </TabsList>

        {/* ── CONVERSATION ─────────────────────────────────────────── */}
        <TabsContent value="conversation" className="mt-4">
          <Card>
            <CardContent>
              <ConversationTranscript
                episodeId={id}
                initialMessages={transcript}
                conversationId={conversation?.id ?? null}
                patientId={patient.id}
                patientName={patient.full_name}
                patientPhone={patient.phone_e164}
                patientLanguage={patient.preferred_language as LanguageCode}
                conversationState={conversationState}
                sharedWith={sharedWith}
                numberSession={numberSession}
                canSend={canMessage}
                currentUserId={profile.id}
              />
            </CardContent>
          </Card>
          {/* Demo patients only: write as the patient, since nobody here holds their phone */}
          {canMessage && isSampleMrn(patient.mrn) && (
            <div className="mt-4">
              <PatientSimulator
                episodeId={id}
                conversationId={conversation?.id ?? null}
                patientName={patient.full_name}
                language={patient.preferred_language as LanguageCode}
              />
            </div>
          )}
        </TabsContent>

        {/* ── CARE PLAN ────────────────────────────────────────────── */}
        <TabsContent value="care-plan" className="mt-4">
          {!summary ? (
            <Card>
              <CardContent className="py-14 text-center">
                <FileText className="mx-auto mb-3 h-9 w-9 text-muted-foreground" aria-hidden="true" />
                <p className="font-medium">{episodeOpen ? 'No care plan yet' : 'No care plan was recorded'}</p>
                <p className="mb-4 text-sm text-muted-foreground">
                  {episodeOpen ? 'Upload the discharge letter and the care plan is filled in from it.' : 'This patient’s follow-up has ended.'}
                </p>
                {canReview && episodeOpen && (
                  <Link href={`/episodes/${id}/review`} className={cn(buttonVariants({ size: 'sm' }))}>
                    <Upload className="h-4 w-4" aria-hidden="true" /> Upload discharge letter
                  </Link>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <StatusBadge status={summary.status} />
                  <span className="text-muted-foreground">{planStatus}</span>
                </div>
                <div className="flex items-center gap-2">
                  {/* Sent, but WhatsApp never confirmed it reached the patient (old message, or no receipt yet) */}
                  {summary.status === 'sent' && !delivered && carePlanDelivery?.status !== 'failed' && <CarePlanResendButton episodeId={id} />}
                  {/* Once sent, the plan is what the patient has: it is read here, not edited. */}
                  {canReview && episodeOpen && summary.status !== 'sent' && (
                    <Link href={`/episodes/${id}/review`} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Review
                    </Link>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-4 lg:col-span-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base"><Pill className="h-4 w-4" aria-hidden="true" /> Medicines <span className="text-sm font-normal text-muted-foreground">{summary.medications.length}</span></CardTitle>
                    </CardHeader>
                    <CardContent>
                      {summary.medications.length === 0 ? <p className="text-sm text-muted-foreground">No medicines</p> : (
                        <ul className="divide-y">
                          {summary.medications.map((med) => (
                            <li key={med.id} className="py-2.5 first:pt-0 last:pb-0">
                              <p className="text-sm font-medium">{med.name} <span className="font-normal text-muted-foreground">{med.dosage}</span></p>
                              <p className="text-xs text-muted-foreground">{med.frequency}{med.instructions ? ` — ${med.instructions}` : ''}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>

                  {summary.emergency_symptoms.length > 0 && (
                    <Card className="border-danger/30 bg-danger-soft">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base text-danger"><AlertTriangle className="h-4 w-4" aria-hidden="true" /> Warning signs — go to emergency</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ul className="space-y-1.5">
                          {summary.emergency_symptoms.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-danger">
                              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />{s}
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  )}

                  {instructions.length > 0 && (
                    <Card>
                      <CardHeader><CardTitle className="text-base">Instructions</CardTitle></CardHeader>
                      <CardContent className="space-y-3">
                        {instructions.map((g) => (
                          <div key={g.title}>
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</p>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                              {g.items.map((item, i) => <li key={i}>{item}</li>)}
                            </ul>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}

                  {summary.nurse_notes && (
                    <Card>
                      <CardHeader><CardTitle className="text-base">Nurse notes</CardTitle></CardHeader>
                      <CardContent><p className="whitespace-pre-wrap text-sm">{summary.nurse_notes}</p></CardContent>
                    </Card>
                  )}
                </div>

                <div className="space-y-4">
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="h-4 w-4" aria-hidden="true" /> Appointments</CardTitle>
                      <Link href="/appointments" className="text-xs text-brand hover:underline">All</Link>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {(appointments ?? []).length === 0 && needsDate.length === 0 && <p className="text-sm text-muted-foreground">No follow-up appointments.</p>}
                      {(appointments ?? []).length > 0 && (
                        <ul className="-mx-2">
                          {(appointments ?? []).map((appt) => (
                            <li key={appt.id}>
                              <Link href={`/episodes/${id}/appointments/${appt.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">{appt.specialty}</span>
                                  <span className="block text-xs text-muted-foreground">
                                    {appt.time_tbc ? <>Due by {fmt(appt.scheduled_at, 'd MMM yyyy', tz)} · time to confirm</> : fmt(appt.scheduled_at, 'EEE d MMM, HH:mm', tz)}
                                  </span>
                                </span>
                                <span className="flex shrink-0 items-center gap-1">
                                  <StatusBadge status={appt.status as AppointmentStatus} />
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                      {needsDate.length > 0 && (
                        <div className="rounded-md border border-dashed px-3 py-2">
                          <p className="text-xs font-medium text-warning">Needs a date</p>
                          <ul className="mt-1 space-y-2">
                            {needsDate.map((f) => (
                              <li key={f.id} className="flex items-start justify-between gap-2">
                                <span className="min-w-0 text-sm">
                                  {f.specialty}
                                  {f.instructions && <span className="block text-xs text-muted-foreground">{f.instructions}</span>}
                                </span>
                                {/* Sent: the letter's plan is fixed, so the visit is booked directly. */}
                                {canAct && episodeOpen && summary.status === 'sent' && (
                                  <BookFollowUp episodeId={id} followUp={{ id: f.id, specialty: f.specialty, instructions: f.instructions }} timezone={tz} />
                                )}
                              </li>
                            ))}
                          </ul>
                          {canReview && episodeOpen && summary.status !== 'sent' && (
                            <Link href={`/episodes/${id}/review`} className="mt-1.5 inline-block text-xs text-brand hover:underline">Add a date in the care plan</Link>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" aria-hidden="true" /> Discharge letter</CardTitle></CardHeader>
                    <CardContent>
                      {documents.length === 0 ? <p className="text-sm text-muted-foreground">Entered by hand — no letter uploaded.</p> : (
                        <ul className="space-y-1">
                          {documents.map((doc) => (
                            <li key={doc.id} className="text-sm">
                              <span className="block truncate font-medium" title={doc.original_filename}>{doc.original_filename}</span>
                              <span className="text-xs text-muted-foreground">Uploaded {fmt(doc.created_at, 'd MMM yyyy', tz)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── ACTIVITY ─────────────────────────────────────────────── */}
        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent>
              <EpisodeTimeline initialEvents={(timelineEvents ?? []) as unknown as Parameters<typeof EpisodeTimeline>[0]['initialEvents']} episodeId={id} timezone={tz} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
