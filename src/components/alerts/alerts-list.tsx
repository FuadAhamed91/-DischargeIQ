'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AlertCircle, AlertTriangle, CheckCircle, Clock, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

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

interface AlertsListProps {
  initialAlerts: Alert[]
  hospitalId: string
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'border-l-4 border-l-red-500 bg-red-50',
  high: 'border-l-4 border-l-orange-400 bg-orange-50',
  medium: 'border-l-4 border-l-yellow-400 bg-yellow-50',
  low: 'border-l-4 border-l-green-400 bg-green-50',
}

const SEVERITY_ICONS: Record<string, typeof AlertCircle> = {
  critical: AlertCircle,
  high: AlertCircle,
  medium: AlertTriangle,
  low: CheckCircle,
}

const SEVERITY_ICON_COLORS: Record<string, string> = {
  critical: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-500',
  low: 'text-green-500',
}

const TYPE_LABELS: Record<string, string> = {
  risk_red: 'Red Risk Alert',
  risk_yellow: 'Yellow Risk Alert',
  escalation: 'Nurse Escalation',
  missed_appointment: 'Missed Appointment',
  unconfirmed_appointment: 'Unconfirmed Appointment',
}

const SEVERITY_BADGE_COLORS: Record<string, string> = {
  critical: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-green-500 text-white',
}

export function AlertsList({ initialAlerts, hospitalId }: AlertsListProps) {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts)
  const [filter, setFilter] = useState<'all' | 'open' | 'acknowledged'>('open')
  const [acknowledging, setAcknowledging] = useState<string | null>(null)

  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('alerts-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` },
        (payload) => {
          const newAlert = payload.new as Alert
          setAlerts((prev) => [newAlert, ...prev])
          if (newAlert.severity === 'critical') {
            toast.error(`🚨 Critical alert — ${TYPE_LABELS[newAlert.type] ?? newAlert.type}`, { duration: 10000 })
          } else if (newAlert.severity === 'high' || newAlert.severity === 'medium') {
            toast.warning(`⚠️ Alert — ${TYPE_LABELS[newAlert.type] ?? newAlert.type}`, { duration: 6000 })
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` },
        (payload) => {
          const updated = payload.new as Alert
          setAlerts((prev) => prev.map((a) => a.id === updated.id ? { ...a, ...updated } : a))
        })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [hospitalId, supabase])

  const handleAcknowledge = useCallback(async (alertId: string) => {
    setAcknowledging(alertId)
    try {
      const res = await fetch(`/api/v1/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'acknowledged' }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Alert acknowledged')
    } catch {
      toast.error('Failed to acknowledge alert')
    } finally {
      setAcknowledging(null)
    }
  }, [])

  const handleResolve = useCallback(async (alertId: string) => {
    try {
      const res = await fetch(`/api/v1/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Alert resolved')
    } catch {
      toast.error('Failed to resolve alert')
    }
  }, [])

  const filtered = alerts.filter((a) => {
    if (filter === 'open') return a.status === 'open'
    if (filter === 'acknowledged') return a.status === 'acknowledged'
    return true
  })

  const openCount = alerts.filter((a) => a.status === 'open').length
  const criticalCount = alerts.filter((a) => a.status === 'open' && a.severity === 'critical').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['open', 'acknowledged', 'all'] as const).map((f) => (
            <Button key={f} size="sm" variant={filter === f ? 'default' : 'ghost'}
              onClick={() => setFilter(f)} className={filter === f ? 'bg-[#1C0770]' : ''}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'open' && openCount > 0 && (
                <Badge className={`ml-1.5 text-xs ${criticalCount > 0 ? 'bg-red-500' : 'bg-yellow-500'}`}>
                  {openCount}
                </Badge>
              )}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <RefreshCw className="w-3 h-3" /> Live
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No {filter} alerts</p>
      )}

      <div className="space-y-2">
        {filtered.map((alert) => {
          const sev = alert.severity ?? 'low'
          const Icon = SEVERITY_ICONS[sev] ?? CheckCircle
          const patient = alert.care_episodes?.patients
          const episodeId = alert.care_episodes?.id

          return (
            <Card key={alert.id} className={cn('overflow-hidden transition-opacity', SEVERITY_STYLES[sev], alert.status !== 'open' && 'opacity-60')}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${SEVERITY_ICON_COLORS[sev]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">{TYPE_LABELS[alert.type] ?? alert.type}</Badge>
                      <Badge className={`text-xs uppercase ${SEVERITY_BADGE_COLORS[sev]}`}>{sev}</Badge>
                      {patient && episodeId && (
                        <Link href={`/episodes/${episodeId}`} className="text-xs text-muted-foreground hover:underline">
                          {patient.full_name} · MRN {patient.mrn}
                        </Link>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {new Date(alert.created_at).toLocaleString('en-GB')}
                    </div>
                  </div>
                  {alert.status === 'open' && (
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        disabled={acknowledging === alert.id} onClick={() => handleAcknowledge(alert.id)}>
                        Acknowledge
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs text-green-700"
                        onClick={() => handleResolve(alert.id)}>
                        Resolve
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
