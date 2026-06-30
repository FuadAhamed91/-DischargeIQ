export const dynamic = 'force-dynamic'
export const metadata = { title: 'Patients' }

import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RiskBadge } from '@/components/shared/risk-badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { LanguageBadge } from '@/components/shared/language-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { Plus, Users, ChevronRight } from 'lucide-react'
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

  const totalPages = Math.ceil((count ?? 0) / limit)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Patients</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {count ?? 0} total patients
          </p>
        </div>
        <Link href="/episodes/new">
          <Button style={{ backgroundColor: '#1C0770' }}>
            <Plus className="w-4 h-4 mr-2" />
            New episode
          </Button>
        </Link>
      </div>

      {/* Search */}
      <form method="GET">
        <Input
          name="search"
          defaultValue={search}
          placeholder="Search by name or MRN…"
          className="max-w-sm"
        />
      </form>

      {/* Table */}
      <Card>
        {!patients?.length ? (
          <EmptyState
            icon={Users}
            title="No patients yet"
            description="Create a new discharge episode to add your first patient."
            action={
              <Link href="/episodes/new">
                <Button style={{ backgroundColor: '#1C0770' }}>
                  <Plus className="w-4 h-4 mr-2" /> New episode
                </Button>
              </Link>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>MRN</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Episode status</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((patient) => {
                const activeEpisode = (patient.care_episodes as { id: string; status: EpisodeStatus; current_risk_level: RiskLevel; discharge_date: string }[])?.find(
                  (e) => e.status === 'active',
                ) ?? patient.care_episodes?.[0]

                return (
                  <TableRow key={patient.id} className="group">
                    <TableCell>
                      <div>
                        <p className="font-medium">{patient.full_name}</p>
                        <p className="text-xs text-muted-foreground">{patient.phone_e164}</p>
                      </div>
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
                      <Link href={`/patients/${patient.id}`}>
                        <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100">
                          View <ChevronRight className="w-3.5 h-3.5 ml-1" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {pageNum} of {totalPages}</span>
          <div className="flex gap-2">
            {pageNum > 1 && (
              <Link href={`?page=${pageNum - 1}&search=${search}`}>
                <Button variant="outline" size="sm">Previous</Button>
              </Link>
            )}
            {pageNum < totalPages && (
              <Link href={`?page=${pageNum + 1}&search=${search}`}>
                <Button variant="outline" size="sm">Next</Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
