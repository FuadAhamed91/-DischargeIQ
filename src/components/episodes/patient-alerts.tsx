'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ALERT_TYPE_LABELS, SEVERITY, SeverityBadge, alertTime, severityOf } from '@/components/alerts/alert-primitives'
import { cn } from '@/lib/utils'

export interface PatientAlert {
  id: string
  type: string
  severity: string
  created_at: string
}

const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/**
 * This patient's open alerts, on their own page: what happened, how urgent,
 * and Acknowledge / Resolve right there. The reason for each is on the
 * Activity tab.
 */
export function PatientAlerts({ alerts: initial, timezone }: { alerts: PatientAlert[]; timezone: string }) {
  const [alerts, setAlerts] = useState(() =>
    [...initial].sort((a, b) => (RANK[a.severity] ?? 9) - (RANK[b.severity] ?? 9) || b.created_at.localeCompare(a.created_at)))
  const [busy, setBusy] = useState<Record<string, 'acknowledged' | 'resolved'>>({})

  async function settle(id: string, status: 'acknowledged' | 'resolved') {
    setBusy((b) => ({ ...b, [id]: status }))
    try {
      const res = await fetch(`/api/v1/alerts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setAlerts((prev) => prev.filter((a) => a.id !== id))
      toast.success(status === 'acknowledged' ? 'Alert acknowledged' : 'Alert resolved')
    } catch {
      toast.error('Could not update the alert. Please try again.')
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[id]; return n })
    }
  }

  if (alerts.length === 0) return null

  return (
    <section aria-labelledby="patient-alerts" data-tour="patient-alerts" className="rounded-lg border border-danger/30 bg-danger-soft/40">
      <h2 id="patient-alerts" className="border-b border-danger/20 px-4 py-2.5 text-sm font-semibold text-danger">
        {alerts.length} open alert{alerts.length === 1 ? '' : 's'} for this patient
      </h2>
      <ul className="divide-y divide-danger/15">
        {alerts.map((a) => {
          const sev = SEVERITY[severityOf(a.severity)]
          return (
            <li key={a.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 border-l-4 px-4 py-2.5', sev.accent)}>
              <SeverityBadge severity={a.severity} />
              <span className="text-sm font-medium">{ALERT_TYPE_LABELS[a.type] ?? a.type}</span>
              <span className="text-xs text-muted-foreground tnum">{alertTime(a.created_at, timezone)}</span>
              <span className="ml-auto flex gap-2">
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={Boolean(busy[a.id])} onClick={() => settle(a.id, 'acknowledged')}>
                  {busy[a.id] === 'acknowledged' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  Acknowledge
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-8" disabled={Boolean(busy[a.id])} onClick={() => settle(a.id, 'resolved')}>
                  {busy[a.id] === 'resolved' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  Resolve
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
