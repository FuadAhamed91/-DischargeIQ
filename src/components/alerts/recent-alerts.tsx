'use client'

import { useEffect, useMemo, useState } from 'react'
import { NavLink } from '@/components/layout/nav-link'
import { createClient } from '@/lib/supabase/client'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SEVERITY, ALERT_TYPE_LABELS, SeverityBadge, AlertStatusBadge, alertTime, severityOf } from './alert-primitives'

interface Alert {
  id: string
  type: string
  severity: string
  status: string
  created_at: string
  episode_id: string
  care_episodes: {
    id: string
    patients: { full_name: string; mrn: string } | null
  } | null
}

interface RecentAlertsProps {
  alerts: Alert[]
  hospitalId: string
  tz: string
  /** Only alerts nobody has handled yet: one leaves the list as soon as it is acknowledged or resolved. */
  openOnly?: boolean
  limit?: number
}

export function RecentAlerts({ alerts: initialAlerts, hospitalId, tz, openOnly = false, limit = 5 }: RecentAlertsProps) {
  const [alerts, setAlerts] = useState(initialAlerts)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const channel = supabase
      .channel(`recent-alerts-${hospitalId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` },
        (payload) => { setAlerts((prev) => [payload.new as Alert, ...prev]) })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` },
        (payload) => {
          const updated = payload.new as Partial<Alert> & { id: string }
          setAlerts((prev) => openOnly && updated.status && updated.status !== 'open'
            ? prev.filter((a) => a.id !== updated.id)
            : prev.map((a) => (a.id === updated.id ? { ...a, ...updated, care_episodes: a.care_episodes } : a)))
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [hospitalId, openOnly, supabase])

  if (alerts.length === 0 && openOnly) {
    return (
      <div className="flex flex-col items-center px-5 pb-1 pt-6 text-center">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true">
          <Check className="h-5 w-5" />
        </span>
        <p className="mt-2.5 text-sm font-medium">All clear</p>
        <p className="mt-0.5 max-w-sm text-xs text-muted-foreground">
          No patient needs a nurse right now. New alerts appear here the moment they happen.
        </p>
      </div>
    )
  }

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-3 px-5 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true">
          <Check className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium">No alerts yet</p>
          <p className="text-xs text-muted-foreground">Reported symptoms, missed medicines and unconfirmed appointments show here.</p>
        </div>
      </div>
    )
  }

  return (
    <ul className="divide-y border-b">
      {alerts.slice(0, limit).map((alert) => {
        const sev = severityOf(alert.severity)
        const Icon = SEVERITY[sev].icon
        const patient = alert.care_episodes?.patients
        const episodeId = alert.care_episodes?.id ?? alert.episode_id
        const isOpen = alert.status === 'open'

        return (
          <li key={alert.id}>
            <NavLink
              href={`/episodes/${episodeId}`}
              className={cn(
                'group flex items-center gap-3 px-5 py-3 transition-colors duration-200 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none',
                !isOpen && 'opacity-70',
              )}
            >
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', SEVERITY[sev].soft_bg)} aria-hidden="true">
                <Icon className={cn('h-4 w-4', SEVERITY[sev].icon_color)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{patient?.full_name ?? 'Patient'}</span>
                  <AlertStatusBadge status={alert.status} />
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {ALERT_TYPE_LABELS[alert.type] ?? alert.type} · {alertTime(alert.created_at, tz)}
                </span>
              </span>
              <SeverityBadge severity={sev} className="hidden sm:inline-flex" />
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </NavLink>
          </li>
        )
      })}
    </ul>
  )
}
