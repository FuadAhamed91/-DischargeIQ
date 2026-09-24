export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { resolveCheckinTime } from '@/lib/reminders/checkin'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/status-badge'
import { SummaryReviewForm, type ReviewSummary } from '@/components/episodes/summary-review-form'
import { DischargeUpload } from '@/components/episodes/discharge-upload'
import { SUPPORTED_LANGUAGES } from '@/types/enums'
import type { LanguageCode } from '@/types/enums'

export async function generateMetadata() {
  return { title: 'Review care plan' }
}

/** The roles the summary routes accept (PATCH, approve, send). */
const REVIEWERS = ['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse']
const OPEN_EPISODE = ['draft', 'pending_review', 'active']

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { profile, hospital } = await requireSession()
  const { id } = await params
  const carePlanTab = `/episodes/${id}?tab=care-plan`

  if (!REVIEWERS.includes(profile.role)) redirect(carePlanTab)

  const supabase = await createClient()

  const { data: episode } = await supabase
    .from('care_episodes')
    .select(`
      id, status,
      patients(full_name, phone_e164, preferred_language),
      discharge_summaries(
        id, status, nurse_notes,
        emergency_symptoms, lifestyle_instructions, restrictions, activities,
        medications(id, name, dosage, frequency, instructions, reminder_times, sort_order),
        follow_up_requirements(id, specialty, deadline, instructions)
      )
    `)
    .eq('id', id)
    .single()

  if (!episode) notFound()

  // One-to-one embed: PostgREST returns an object, older code expected an array — accept both
  const rawSummary = episode.discharge_summaries as unknown
  const summary = (Array.isArray(rawSummary) ? rawSummary[0] : rawSummary) as ReviewSummary | null
  // A care plan the patient already has, or a follow-up that has ended, is read on the patient's page.
  if (summary?.status === 'sent' || !OPEN_EPISODE.includes(episode.status)) redirect(carePlanTab)

  const patient = episode.patients as unknown as { full_name: string; phone_e164: string; preferred_language: string }
  const firstName = patient.full_name.split(' ')[0]

  return (
    <div className="max-w-4xl space-y-5">
      <Link href={carePlanTab} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {patient.full_name}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Review care plan</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {summary
              ? `Check what was read from the discharge letter and fix anything that’s wrong. Nothing goes to ${firstName} until you send it.`
              : `Upload ${firstName}’s discharge letter. The medicines, warning signs, follow-ups and instructions are filled in from it for you to check.`}
          </p>
        </div>
        {summary && <StatusBadge status={summary.status} />}
      </div>

      {summary ? (
        <SummaryReviewForm
          episodeId={id}
          summary={summary}
          patient={{
            name: patient.full_name,
            phone: patient.phone_e164,
            languageName: SUPPORTED_LANGUAGES[patient.preferred_language as LanguageCode] ?? patient.preferred_language,
          }}
          checkinTime={resolveCheckinTime(hospital.settings)}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Discharge letter</CardTitle>
            <CardDescription>A PDF of up to 20 MB. Scanned images can’t be read yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <DischargeUpload episodeId={id} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
