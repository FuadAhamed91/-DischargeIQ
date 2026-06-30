export const dynamic = 'force-dynamic'

import { requireSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, Bell, CalendarCheck, TrendingUp } from 'lucide-react'

export const metadata = { title: 'Overview' }

export default async function OverviewPage() {
  const { profile } = await requireSession()
  const supabase = await createClient()

  // Active patients count
  const { count: activePatients } = await supabase
    .from('care_episodes')
    .select('*', { count: 'exact', head: true })
    .eq('hospital_id', profile.hospital_id)
    .eq('status', 'active')

  // Open alerts count
  const { count: openAlerts } = await supabase
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .eq('hospital_id', profile.hospital_id)
    .eq('status', 'open')

  // Critical alerts count
  const { count: criticalAlerts } = await supabase
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .eq('hospital_id', profile.hospital_id)
    .eq('status', 'open')
    .eq('severity', 'critical')

  // Appointments needing confirmation
  const { count: pendingAppointments } = await supabase
    .from('appointments')
    .select('*', { count: 'exact', head: true })
    .eq('hospital_id', profile.hospital_id)
    .eq('status', 'confirmation_pending')

  const stats = [
    {
      label: 'Active Patients',
      value: activePatients ?? 0,
      icon: Users,
      color: 'text-[#1C0770]',
      bg: 'bg-[#F0EDFF]',
    },
    {
      label: 'Open Alerts',
      value: openAlerts ?? 0,
      icon: Bell,
      color: criticalAlerts ? 'text-red-600' : 'text-amber-600',
      bg: criticalAlerts ? 'bg-red-50' : 'bg-amber-50',
      badge: criticalAlerts ? `${criticalAlerts} critical` : undefined,
    },
    {
      label: 'Pending Confirmations',
      value: pendingAppointments ?? 0,
      icon: CalendarCheck,
      color: 'text-[#1C0770]',
      bg: 'bg-[#F0EDFF]',
    },
    {
      label: 'Compliance Score',
      value: '—',
      icon: TrendingUp,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      subtitle: 'Available after 7 days',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Welcome back, {profile.full_name.split(' ')[0]}.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label} className="border shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.label}
                </CardTitle>
                <div className={`p-2 rounded-lg ${stat.bg}`}>
                  <Icon className={`w-4 h-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stat.value}</div>
                {stat.badge && (
                  <Badge variant="destructive" className="mt-1 text-xs">
                    {stat.badge}
                  </Badge>
                )}
                {stat.subtitle && (
                  <p className="text-xs text-muted-foreground mt-1">{stat.subtitle}</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Placeholder for charts — built in Phase 5 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Recent Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Alert feed will appear here. Coming in Phase 4.
            </p>
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Compliance Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Analytics charts will appear here. Coming in Phase 5.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
