export const dynamic = 'force-dynamic'
export const metadata = { title: 'Patients' }

import Link from 'next/link'
import { NavLink } from '@/components/layout/nav-link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { fmt } from '@/lib/format'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RiskBadge } from '@/components/shared/risk-badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { Plus, Users, ChevronRight, Search, Bell } from 'lucide-react'
import { SUPPORTED_LANGUAGES } from '@/types/enums'
import type { RiskLevel, EpisodeStatus, LanguageCode } from '@/types/enums'

/** One row per care plan (episode): what a nurse follows up on. Older care plans live on the patient's history page. */
const FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'pending_review', label: 'Needs review' },
  { value: 'draft', label: 'Draft' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
] as const
type Filter = (typeof FILTERS)[number]['value']

const PAGE_SIZE = 20

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; search?: string; page?: string }>
}) {
  const { profile, hospital } = await requireSession()
  const params = await searchParams
  const filter: Filter = FILTERS.some((f) => f.value === params.status) ? (params.status as Filter) : 'active'
  // Commas and brackets would break the PostgREST filter below.
  const search = (params.search ?? '').replace(/[%,()*\\]/g, ' ').trim()
  const pageNum = Math.max(1, parseInt(params.page ?? '1') || 1)
  const supabase = await createClient()
  const tz = hospital.timezone
  const ownOnly = profile.role === 'nurse'

  let query = supabase
    .from('care_episodes')
    .select(
      `id, status, current_risk_level, discharge_date, created_at,
       patients!inner(id, full_name, mrn, phone_e164, preferred_language),
       profiles!care_episodes_assigned_nurse_id_fkey(full_name)`,
      { count: 'exact' },
    )
    .eq('hospital_id', profile.hospital_id)
  if (filter !== 'all') query = query.eq('status', filter)
  if (ownOnly) query = query.eq('assigned_nurse_id', profile.id)
  if (search) query = query.or(`full_name.ilike.%${search}%,mrn.ilike.%${search}%`, { referencedTable: 'patients' })
  // Red first, then yellow, then green (the enum's order); newest first within a colour.
  query = query
    .order('current_risk_level', { ascending: false })
    .order('created_at', { ascending: false })
    .range((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE - 1)

  let countsQuery = supabase.from('care_episodes').select('status').eq('hospital_id', profile.hospital_id)
  if (ownOnly) countsQuery = countsQuery.eq('assigned_nurse_id', profile.id)

  const [{ data: rows, count }, { data: statusRows }] = await Promise.all([query, countsQuery])

  const episodes = (rows ?? []).map((row) => ({
    id: row.id as string,
    status: row.status as EpisodeStatus,
    risk: row.current_risk_level as RiskLevel,
    dischargeDate: row.discharge_date as string | null,
    patient: row.patients as unknown as { id: string; full_name: string; mrn: string; phone_e164: string; preferred_language: LanguageCode },
    nurse: (row.profiles as unknown as { full_name: string } | null)?.full_name ?? null,
  }))

  const counts = new Map<string, number>()
  for (const r of statusRows ?? []) counts.set(r.status as string, (counts.get(r.status as string) ?? 0) + 1)
  const countFor = (f: Filter) => (f === 'all' ? statusRows?.length ?? 0 : counts.get(f) ?? 0)

  // What needs a nurse, and which phones are shared by a family — one query each for the page.
  const ids = episodes.map((e) => e.id)
  const phones = [...new Set(episodes.map((e) => e.patient.phone_e164))]
  const [{ data: alertRows }, { data: phoneRows }] = await Promise.all([
    ids.length
      ? supabase.from('alerts').select('episode_id').eq('status', 'open').in('episode_id', ids)
      : Promise.resolve({ data: [] as Array<{ episode_id: string }> }),
    phones.length
      ? supabase.from('patients').select('phone_e164').eq('hospital_id', profile.hospital_id).in('phone_e164', phones)
      : Promise.resolve({ data: [] as Array<{ phone_e164: string }> }),
  ])
  const openAlerts = new Map<string, number>()
  for (const a of alertRows ?? []) openAlerts.set(a.episode_id as string, (openAlerts.get(a.episode_id as string) ?? 0) + 1)
  const onPhone = new Map<string, number>()
  for (const p of phoneRows ?? []) onPhone.set(p.phone_e164 as string, (onPhone.get(p.phone_e164 as string) ?? 0) + 1)

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)
  const filterLabel = FILTERS.find((f) => f.value === filter)!.label
  const href = (next: { status?: Filter; page?: number }) => {
    const q = new URLSearchParams()
    q.set('status', next.status ?? filter)
    if (search) q.set('search', search)
    if (next.page && next.page > 1) q.set('page', String(next.page))
    return `/patients?${q.toString()}`
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Patients</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {countFor('active')} active
            {countFor('pending_review') > 0 && <> · <span className="font-medium text-warning">{countFor('pending_review')} waiting for review</span></>}
            {ownOnly && ' · assigned to you'}
          </p>
        </div>
        <Link href="/episodes/new" className={cn(buttonVariants())}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add patient
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Show patients" className="-mx-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ul className="flex items-center gap-1 px-1 pb-1">
            {FILTERS.map((f) => {
              const active = f.value === filter
              const n = countFor(f.value)
              if (f.value === 'draft' && n === 0 && !active) return null
              return (
                <li key={f.value}>
                  <Link
                    href={href({ status: f.value })}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-200',
                      active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {f.label}
                    <span className={cn('tnum text-xs', active ? 'text-primary-foreground/80' : 'text-muted-foreground/80')}>{n}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <form method="GET" role="search" className="relative w-full max-w-xs">
          <input type="hidden" name="status" value={filter} />
          <label htmlFor="patient-search" className="sr-only">Search patients by name or MRN</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="patient-search" name="search" type="search" defaultValue={search} placeholder="Search name or MRN…" className="pl-9" />
        </form>
      </div>

      <Card className="overflow-hidden py-0">
        {episodes.length === 0 ? (
          <EmptyState
            icon={Users}
            title={search ? `No ${filterLabel.toLowerCase()} patients match “${search}”` : filter === 'all' ? 'No patients yet' : `No ${filterLabel.toLowerCase()} patients`}
            description={filter === 'pending_review' ? 'Care plans appear here after the discharge letter is read, until a nurse approves them.' : 'Add a patient by uploading their discharge letter.'}
            action={
              <Link href="/episodes/new" className={cn(buttonVariants({ size: 'sm' }))}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Add patient
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Risk</TableHead>
                  {filter === 'all' && <TableHead className="hidden sm:table-cell">Status</TableHead>}
                  <TableHead className="hidden md:table-cell">Discharged</TableHead>
                  <TableHead className="hidden lg:table-cell">Nurse</TableHead>
                  <TableHead><span className="sr-only">Open</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {episodes.map((ep) => {
                  const alerts = openAlerts.get(ep.id) ?? 0
                  const shared = (onPhone.get(ep.patient.phone_e164) ?? 0) > 1
                  return (
                    <TableRow key={ep.id} className="group relative transition-colors hover:bg-muted/50">
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          {/* The whole row is the link (stretched pseudo-element); the name stays a real anchor. */}
                          <NavLink href={`/episodes/${ep.id}`} className="font-medium hover:underline focus-visible:underline after:absolute after:inset-0">
                            {ep.patient.full_name}
                          </NavLink>
                          {alerts > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-1.5 py-0.5 text-[11px] font-medium text-danger">
                              <Bell className="h-3 w-3" aria-hidden="true" />
                              {alerts} open alert{alerts === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <span>{SUPPORTED_LANGUAGES[ep.patient.preferred_language] ?? ep.patient.preferred_language}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tnum">{ep.patient.phone_e164}</span>
                          {shared && <Users className="h-3 w-3" aria-label="Phone shared with another patient" />}
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{ep.patient.mrn}</span>
                        </p>
                      </TableCell>
                      <TableCell><RiskBadge level={ep.risk} /></TableCell>
                      {filter === 'all' && <TableCell className="hidden sm:table-cell"><StatusBadge status={ep.status} /></TableCell>}
                      <TableCell className="hidden whitespace-nowrap text-sm tnum md:table-cell">{ep.dischargeDate ? fmt(ep.dischargeDate, 'd MMM yyyy', tz) : '—'}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{ep.nurse ?? 'Unassigned'}</TableCell>
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
            {pageNum > 1 && <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={href({ page: pageNum - 1 })}>Previous</Link>}
            {pageNum < totalPages && <Link className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))} href={href({ page: pageNum + 1 })}>Next</Link>}
          </div>
        </div>
      )}
    </div>
  )
}
