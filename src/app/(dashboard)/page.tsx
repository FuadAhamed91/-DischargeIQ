export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { requireSession } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import { Users, Bell, CalendarCheck, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RealtimeAlertsBanner } from '@/components/alerts/realtime-alerts-banner'
import { RecentAlerts } from '@/components/alerts/recent-alerts'

export const metadata = { title: 'Overview' }

export default async function OverviewPage() {
  const { profile } = await requireSession()
  const supabase = await createClient()

  const [
    { count: activePatients },
    { count: openAlerts },
    { count: criticalAlerts },
    { count: pendingAppointments },
  ] = await Promise.all([
    supabase.from('care_episodes').select('*', { count: 'exact', head: true }).eq('hospital_id', profile.hospital_id).eq('status', 'active'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', profile.hospital_id).eq('status', 'open'),
    supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', profile.hospital_id).eq('status', 'open').eq('severity', 'critical'),
    supabase.from('appointments').select('*', { count: 'exact', head: true }).eq('hospital_id', profile.hospital_id).eq('status', 'confirmation_pending'),
  ])

  const { data: recentAlerts } = await supabase
    .from('alerts')
    .select(`id, type, severity, status, created_at, episode_id, care_episodes(id, patients(full_name, mrn))`)
    .eq('hospital_id', profile.hospital_id)
    .order('created_at', { ascending: false })
    .limit(5)

  const stats = [
    { label: 'Active Patients', value: activePatients ?? 0, icon: Users, color: 'text-[#1C0770]', bg: 'bg-[#F0EDFF]', href: '/patients' },
    { label: 'Open Alerts', value: openAlerts ?? 0, icon: Bell, color: (criticalAlerts ?? 0) > 0 ? 'text-red-600' : 'text-amber-600', bg: (criticalAlerts ?? 0) > 0 ? 'bg-red-50' : 'bg-amber-50', href: '/alerts', urgent: (criticalAlerts ?? 0) > 0 },
    { label: 'Pending Confirmations', value: pendingAppointments ?? 0, icon: CalendarCheck, color: 'text-[#1C0770]', bg: 'bg-[#F0EDFF]', href: '/appointments' },
    { label: 'Compliance Score', value: '—', icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50', subtitle: 'Available after 7 days' },
  ]

  return (
    <div className="space-y-6">
      <RealtimeAlertsBanner hospitalId={profile.hospital_id} initialRedCount={criticalAlerts ?? 0} />

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground text-sm mt-1">Welcome back, {profile.full_name.split(' ')[0]}.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          const card = (
            <Card key={stat.label} className={`border shadow-sm transition-shadow hover:shadow-md ${'urgent' in stat && stat.urgent ? 'ring-2 ring-red-400' : ''}`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{stat.label}</CardTitle>
                <div className={`p-2 rounded-lg ${stat.bg}`}><Icon className={`w-4 h-4 ${stat.color}`} /></div>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${'urgent' in stat && stat.urgent ? 'text-red-600' : ''}`}>{stat.value}</div>
                {'subtitle' in stat && stat.subtitle && <p className="text-xs text-muted-foreground mt-1">{stat.subtitle}</p>}
              </CardContent>
            </Card>
          )
          return 'href' in stat && stat.href ? <Link key={stat.label} href={stat.href}>{card}</Link> : <div key={stat.label}>{card}</div>
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Recent Alerts</CardTitle>
            <Link href="/alerts" className="text-xs text-[#1C0770] hover:underline">View all</Link>
          </CardHeader>
          <CardContent className="p-0">
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <RecentAlerts alerts={(recentAlerts ?? []) as any} hospitalId={profile.hospital_id} />
          </CardContent>
        </Card>
        <Card className="border shadow-sm">
          <CardHeader><CardTitle className="text-base">Compliance Trends</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Analytics charts coming in Phase 6.</p></CardContent>
        </Card>
      </div>
    </div>
  )
}
