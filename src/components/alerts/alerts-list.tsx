'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Check, CheckCheck, Loader2, Radio, BellOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
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
    current_risk_level: string
    patients: { full_name: string; mrn: string } | null
  } | null
}

export type AlertsFilter = 'open' | 'acknowledged' | 'all'
const FILTERS: { value: AlertsFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'all', label: 'All' },
]

interface AlertsListProps {
  initialAlerts: Alert[]
  hospitalId: string
  tz: string
  /** The tab to open on, e.g. from the Overview's "acknowledged alerts still to resolve". */
  initialFilter?: AlertsFilter
}

export function AlertsList({ initialAlerts, hospitalId, tz, initialFilter = 'open' }: AlertsListProps) {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts)
  const [filter, setFilter] = useState<AlertsFilter>(initialFilter)
  const [busy, setBusy] = useState<Record<string, 'acknowledge' | 'resolve'>>({})
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const channel = supabase
      .channel(`alerts-list-${hospitalId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` },
        (payload) => {
          const newAlert = payload.new as Alert
          setAlerts((prev) => (prev.some((a) => a.id === newAlert.id) ? prev : [newAlert, ...prev]))
          const label = ALERT_TYPE_LABELS[newAlert.type] ?? newAlert.type
          if (newAlert.severity === 'critical') toast.error(`Critical alert — ${label}`, { duration: 10000 })
          else if (newAlert.severity === 'high' || newAlert.severity === 'medium') toast.warning(`New alert — ${label}`, { duration: 6000 })
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` },
        (payload) => {
          const updated = payload.new as Alert
          setAlerts((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated, care_episodes: a.care_episodes } : a)))
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [hospitalId, supabase])

  const transition = useCallback(async (alertId: string, status: 'acknowledged' | 'resolved') => {
    const action = status === 'acknowledged' ? 'acknowledge' : 'resolve'
    setBusy((b) => ({ ...b, [alertId]: action }))
    try {
      const res = await fetch(`/api/v1/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Optimistic local update; realtime will confirm
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? { ...a, status } : a)))
      toast.success(status === 'acknowledged' ? 'Alert acknowledged' : 'Alert resolved')
    } catch {
      toast.error(`Could not ${action} the alert. Please try again.`)
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[alertId]; return n })
    }
  }, [])

  const counts = {
    open: alerts.filter((a) => a.status === 'open').length,
    acknowledged: alerts.filter((a) => a.status === 'acknowledged').length,
    all: alerts.length,
  }
  const criticalOpen = alerts.filter((a) => a.status === 'open' && a.severity === 'critical').length
  const filtered = alerts.filter((a) => filter === 'all' || a.status === filter)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Filter alerts" className="flex items-center gap-1 -mx-1 overflow-x-auto px-1">
          {FILTERS.map((f) => {
            const active = filter === f.value
            return (
              <button
                key={f.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.value)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-200',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {f.label}
                <span className={cn('rounded-full px-1.5 text-[11px] tnum', active ? 'bg-white/20' : 'bg-muted-foreground/10',
                  f.value === 'open' && criticalOpen > 0 && !active && 'bg-danger text-danger-foreground')}>
                  {counts[f.value]}
                </span>
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="off">
          <Radio className="h-3.5 w-3.5 text-success motion-safe:animate-pulse" aria-hidden="true" /> Live
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center">
          <BellOff className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium">
            {filter === 'open' ? 'No open alerts' : filter === 'acknowledged' ? 'Nothing acknowledged' : 'No alerts'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {filter === 'open' ? 'Every patient is accounted for. New alerts appear here instantly.' : 'Alerts you have actioned will show here.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label={`${filter} alerts`}>
          {filtered.map((alert) => {
            const sev = severityOf(alert.severity)
            const cfg = SEVERITY[sev]
            const Icon = cfg.icon
            const patient = alert.care_episodes?.patients
            const episodeId = alert.care_episodes?.id ?? alert.episode_id
            const isOpen = alert.status === 'open'
            const pending = busy[alert.id]

            return (
              <li
                key={alert.id}
                className={cn(
                  'rounded-lg border border-l-4 bg-card p-4 transition-opacity duration-200',
                  cfg.accent, isOpen && sev !== 'low' && cfg.soft_bg, !isOpen && 'opacity-70',
                )}
                aria-busy={!!pending}
              >
                {/* On a phone the buttons sit under the text (lined up with it), so the text keeps the width */}
                <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
                  <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-card', cfg.icon_color)} aria-hidden="true">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={`/episodes/${episodeId}`} className="text-sm font-medium hover:underline focus-visible:underline">
                        {patient?.full_name ?? 'Patient'}
                      </Link>
                      {patient?.mrn && <span className="font-mono text-[11px] text-muted-foreground">{patient.mrn}</span>}
                      <SeverityBadge severity={sev} />
                      <AlertStatusBadge status={alert.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {ALERT_TYPE_LABELS[alert.type] ?? alert.type}
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <time dateTime={alert.created_at} className="tnum">{alertTime(alert.created_at, tz, 'EEE d MMM, HH:mm')}</time>
                    </p>
                  </div>
                  {isOpen && (
                    <div className="flex w-full gap-2 pl-11 sm:w-auto sm:shrink-0 sm:gap-1.5 sm:pl-0">
                      <Button size="sm" variant="outline" className="h-9 flex-1 sm:flex-none" disabled={!!pending} onClick={() => transition(alert.id, 'acknowledged')}>
                        {pending === 'acknowledge' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5" aria-hidden="true" />}
                        Acknowledge
                      </Button>
                      <Button size="sm" variant="ghost" className="h-9 flex-1 text-success hover:text-success sm:flex-none" disabled={!!pending} onClick={() => transition(alert.id, 'resolved')}>
                        {pending === 'resolve' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />}
                        Resolve
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
