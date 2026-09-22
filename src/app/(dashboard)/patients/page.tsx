export const dynamic = 'force-dynamic'
export const metadata = { title: 'Patients' }

import Link from 'next/link'
import { NavLink } from '@/components/layout/nav-link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RiskBadge } from '@/components/shared/risk-badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { LanguageBadge } from '@/components/shared/language-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { Plus, Users, ChevronRight, Search } from 'lucide-react'
import type { RiskLevel, EpisodeStatus, LanguageCode } from '@/types/enums'

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string }>
}) {
  const { profile } = await requireSession()
  const { search = '', page = '1' } = await searchParams
  const supabase = await createClient()

  const pageNum = Math.max(1, parseInt(page))
  const limit = 20
  const offset = (pageNum - 1) * limit

  let query = supabase
    .from('patients')
    .select(
      `
      id, full_name, mrn, phone_e164, preferred_language, created_at,
      care_episodes(id, status, current_risk_level, discharge_date)
    `,
      { count: 'exact' },
    )
    .eq('hospital_id', profile.hospital_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (profile.role === 'nurse') {
    query = query.eq('assigned_nurse_id', profile.id)
  }

  if (search) {
    query = query.or(`full_name.ilike.%${search}%,mrn.ilike.%${search}%`)
  }

  const { data: patients, count } = await query

  // Numbers on this page that other patients of the hospital are registered
  // on too — a family phone. One query for the page, not one per row.
  const phones = [...new Set((patients ?? []).map((p) => p.phone_e164 as string))]
  const { data: sameNumberRows } = phones.length
    ? await supabase.from('patients').select('id, phone_e164').eq('hospital_id', profile.hospital_id).in('phone_e164', phones)
    : { data: [] as Array<{ id: string; phone_e164: string }> }
  const holdersByPhone = new Map<string, number>()
  for (const row of sameNumberRows ?? []) {
    holdersByPhone.set(row.phone_e164 as string, (holdersByPhone.get(row.phone_e164 as string) ?? 0) + 1)
  }

  const totalPages = Math.ceil((count ?? 0) / limit)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Patients</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {count ?? 0} total patient{count === 1 ? '' : 's'}
          </p>
        </div>
        <Link href="/episodes/new" className={cn(buttonVariants())}>
          <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
          New episode
        </Link>
      </div>

      {/* Search */}
      <form method="GET" role="search" className="relative max-w-sm">
        <label htmlFor="patient-search" className="sr-only">Search patients by name or MRN</label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id="patient-search"
          name="search"
          type="search"
          defaultValue={search}
          placeholder="Search by name or MRN…"
          className="pl-9"
        />
      </form>

      {/* Table */}
      <Card className="overflow-hidden">
        {!patients?.length ? (
          <EmptyState
            icon={Users}
            title="No patients yet"
            description="Create a new discharge episode to add your first patient."
            action={
              <Link href="/episodes/new" className={cn(buttonVariants({ size: 'sm' }))}>
                <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" /> New episode
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>MRN</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Episode status</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((patient) => {
                const activeEpisode = (patient.care_episodes as { id: string; status: EpisodeStatus; current_risk_level: RiskLevel; discharge_date: string }[])?.find(
                  (e) => e.status === 'active',
                ) ?? patient.care_episodes?.[0]

                return (
                  <TableRow key={patient.id} className="group relative hover:bg-muted/50 transition-colors">
                    <TableCell>
                      {/* Whole row is the link (stretched pseudo-element); the name stays a real anchor for keyboard + screen readers */}
                      <NavLink href={`/patients/${patient.id}`} className="font-medium hover:underline focus-visible:underline after:absolute after:inset-0" aria-label={`Open ${patient.full_name}`}>
                        {patient.full_name}
                      </NavLink>
                      <p className="flex items-center gap-1 text-xs text-muted-foreground tnum">
                        {patient.phone_e164}
                        {(holdersByPhone.get(patient.phone_e164) ?? 0) > 1 && (
                          <Users className="h-3 w-3" aria-label="Number shared with another patient" />
                        )}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {patient.mrn}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <LanguageBadge language={patient.preferred_language as LanguageCode} />
                    </TableCell>
                    <TableCell>
                      {activeEpisode ? (
                        <StatusBadge status={activeEpisode.status as EpisodeStatus} />
                      ) : (
                        <span className="text-xs text-muted-foreground">No episode</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {activeEpisode ? (
                        <RiskBadge level={activeEpisode.current_risk_level as RiskLevel} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {pageNum} of {totalPages}</span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={`?page=${pageNum - 1}&search=${encodeURIComponent(search)}`}>Previous</Link>
            )}
            {pageNum < totalPages && (
              <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={`?page=${pageNum + 1}&search=${encodeURIComponent(search)}`}>Next</Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
