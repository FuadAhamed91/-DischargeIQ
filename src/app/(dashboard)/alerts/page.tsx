export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { requireSession } from '@/lib/auth/session'
import { Bell } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { AlertsList } from '@/components/alerts/alerts-list'
import type { AlertsFilter } from '@/components/alerts/alerts-list'

export async function generateMetadata() {
  return { title: 'Alerts' }
}

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams
  // ?status=acknowledged (from the Overview's reminders) opens that tab
  const initialFilter: AlertsFilter = status === 'acknowledged' || status === 'all' ? status : 'open'
  const { profile, hospital } = await requireSession()
  const supabase = await createClient()

  const { data: alerts } = await supabase
    .from('alerts')
    .select(`
      id, type, severity, status, created_at,
      episode_id,
      care_episodes(
        id,
        current_risk_level,
        patients(full_name, mrn)
      )
    `)
    .eq('hospital_id', profile.hospital_id)
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Alerts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Patients who need a nurse — reported symptoms, missed medicines, unconfirmed appointments and messages that did not arrive
        </p>
      </div>

      {(!alerts || alerts.length === 0) ? (
        <EmptyState
          icon={Bell}
          title="No alerts"
          description="Alerts appear here the moment a patient needs a nurse."
        />
      ) : (
        <AlertsList
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          initialAlerts={alerts as any}
          hospitalId={profile.hospital_id}
          tz={hospital.timezone}
          initialFilter={initialFilter}
        />
      )}
    </div>
  )
}
