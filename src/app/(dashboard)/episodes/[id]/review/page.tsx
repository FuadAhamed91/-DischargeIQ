export const dynamic = 'force-dynamic'

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { ArrowLeft, FileText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/status-badge'
import { SummaryReviewForm } from '@/components/episodes/summary-review-form'
import { DischargeUpload } from '@/components/episodes/discharge-upload'
import type { SummaryStatus } from '@/types/enums'

export async function generateMetadata() {
  return { title: 'Review care plan' }
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { profile } = await requireSession()
  const { id } = await params

  if (!['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'].includes(profile.role)) {
    redirect('/')
  }

  const supabase = await createClient()

  const { data: episode } = await supabase
    .from('care_episodes')
    .select(`
      id, status, hospital_id,
      patients(full_name, mrn, preferred_language),
      discharge_summaries(
        id, status, version, nurse_notes,
        emergency_symptoms, lifestyle_instructions, restrictions, activities,
        approved_at,
        medications(*),
        follow_up_requirements(*)
      )
    `)
    .eq('id', id)
    .single()

  if (!episode) notFound()

  const patient = episode.patients as unknown as { full_name: string; mrn: string; preferred_language: string }
  // One-to-one embed: PostgREST returns an object, older code expected an array — accept both
  const rawSummary = episode.discharge_summaries as unknown
  const summary = (Array.isArray(rawSummary) ? rawSummary[0] : rawSummary) as {
    id: string; status: SummaryStatus; version: number; nurse_notes: string | null;
    emergency_symptoms: string[]; lifestyle_instructions: string[]; restrictions: string[]; activities: string[];
    approved_at: string | null; medications: unknown[]; follow_up_requirements: unknown[]
    hospital_id?: string
  } | null

  return (
    <div className="max-w-4xl space-y-5">
      <Link href={`/episodes/${id}`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> Back to {patient.full_name}
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review care plan</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {patient.full_name} · MRN {patient.mrn}
          </p>
        </div>
        {summary && (
          <div className="flex items-center gap-2">
            <StatusBadge status={summary.status} />
            {summary.version > 1 && <span className="text-xs text-muted-foreground">Version {summary.version}</span>}
          </div>
        )}
      </div>

      {/* No summary yet — show upload */}
      {!summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" /> Upload the discharge letter
            </CardTitle>
            <CardDescription>
              Drop the PDF and the medicines, instructions, appointments and warning signs are filled in for you to check.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DischargeUpload episodeId={id} />
          </CardContent>
        </Card>
      )}

      {/* Summary review form */}
      {summary && (
        <SummaryReviewForm
          episodeId={id}
          summary={{
            ...summary,
            episode_id: id,
            hospital_id: episode.hospital_id,
            source_language: 'en',
            version: summary.version,
            approved_by: null,
            created_at: '',
            updated_at: '',
            medications: summary.medications as never,
            follow_up_requirements: summary.follow_up_requirements as never,
          }}
        />
      )}
    </div>
  )
}
