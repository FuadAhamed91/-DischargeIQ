export const dynamic = 'force-dynamic'
export const metadata = { title: 'Episodes' }

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { fmt } from '@/lib/format'
import { buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RiskBadge } from '@/components/shared/risk-badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { LanguageBadge } from '@/components/shared/language-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { Plus, FileText, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RiskLevel, EpisodeStatus, LanguageCode } from '@/types/enums'

const STATUS_FILTERS: { value: 'all' | EpisodeStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'draft', label: 'Draft' },
  { value: 'completed', label: 'Completed' },
]

export default async function EpisodesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const { profile, hospital } = await requireSession()
  const { status = 'active', page = '1' } = await searchParams
  const supabase = await createClient()
  const tz = hospital.timezone

  const filter = STATUS_FILTERS.some((f) => f.value === status) ? status : 'active'
  const pageNum = Math.max(1, parseInt(page) || 1)
  const limit = 20
  const offset = (pageNum - 1) * limit

  let query = supabase
    .from('care_episodes')
    .select(
      `id, status, current_risk_level, discharge_date, compliance_score, created_at,
       patients(id, full_name, mrn, preferred_language),
       profiles!care_episodes_assigned_nurse_id_fkey(full_name)`,
      { count: 'exact' },
    )
    .eq('hospital_id', profile.hospital_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (filter !== 'all') query = query.eq('status', filter)
  if (profile.role === 'nurse') query = query.eq('assigned_nurse_id', profile.id)

  const { data: episodes, count } = await query
  const totalPages = Math.ceil((count ?? 0) / limit)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Episodes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {count ?? 0} {filter === 'all' ? 'total' : STATUS_FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} episode{count === 1 ? '' : 's'}
          </p>
        </div>
        <Link href="/episodes/new" className={cn(buttonVariants())}>
          <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> New episode
        </Link>
      </div>

      {/* Status filter */}
      <nav aria-label="Filter episodes by status" className="-mx-1 overflow-x-auto">
        <ul className="flex items-center gap-1 px-1 pb-1">
          {STATUS_FILTERS.map((f) => {
            const active = f.value === filter
            return (
              <li key={f.value}>
                <Link
                  href={f.value === 'all' ? '/episodes?status=all' : `/episodes?status=${f.value}`}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex h-8 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-200',
                    active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {f.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <Card className="overflow-hidden">
        {!episodes || episodes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={filter === 'all' ? 'No episodes yet' : `No ${STATUS_FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} episodes`}
            description="An episode starts when a nurse uploads a discharge summary for a patient."
            action={<Link href="/episodes/new" className={cn(buttonVariants({ size: 'sm' }))}>New episode</Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Discharged</TableHead>
                  <TableHead className="text-right">Compliance</TableHead>
                  <TableHead>Nurse</TableHead>
                  <TableHead><span className="sr-only">Open</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {episodes.map((ep) => {
                  const patient = ep.patients as unknown as { id: string; full_name: string; mrn: string; preferred_language: string } | null
                  const nurse = ep.profiles as unknown as { full_name: string } | null
                  const score = ep.compliance_score == null ? null : Math.round(Number(ep.compliance_score))
                  return (
                    <TableRow key={ep.id} className="group relative hover:bg-muted/50 transition-colors">
                      <TableCell>
                        <Link href={`/episodes/${ep.id}`} className="font-medium hover:underline focus-visible:underline after:absolute after:inset-0" aria-label={`Open episode for ${patient?.full_name ?? 'patient'}`}>
                          {patient?.full_name ?? 'Unknown patient'}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2">
                          <Badge variant="outline" className="font-mono text-[11px]">{patient?.mrn ?? '—'}</Badge>
                          {patient && <LanguageBadge language={patient.preferred_language as LanguageCode} />}
                        </div>
                      </TableCell>
                      <TableCell><StatusBadge status={ep.status as EpisodeStatus} /></TableCell>
                      <TableCell><RiskBadge level={ep.current_risk_level as RiskLevel} /></TableCell>
                      <TableCell className="whitespace-nowrap text-sm tnum">{fmt(ep.discharge_date, 'd MMM yyyy', tz)}</TableCell>
                      <TableCell className="text-right tnum">
                        {score == null ? <span className="text-muted-foreground">—</span> : (
                          <span className={cn('font-medium', score >= 75 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-danger')}>{score}%</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{nurse?.full_name ?? 'Unassigned'}</TableCell>
                      <TableCell className="text-right">
                        <ChevronRight className="inline h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {pageNum} of {totalPages}</span>
          <div className="flex gap-2">
            {pageNum > 1 && <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={`?status=${filter}&page=${pageNum - 1}`}>Previous</Link>}
            {pageNum < totalPages && <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={`?status=${filter}&page=${pageNum + 1}`}>Next</Link>}
          </div>
        </div>
      )}
    </div>
  )
}
