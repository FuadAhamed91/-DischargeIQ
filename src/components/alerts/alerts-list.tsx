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
  message: string
  risk_level: string
  status: string
  created_at: string
  episode_id: string
  care_episodes: {
    id: string
    patients: { full_name: string; mrn: string } | null
  } | null
}

interface AlertsListProps {
  initialAlerts: Alert[]
  hospitalId: string
}

const RISK_STYLES = {
  red: 'border-l-4 border-l-red-500 bg-red-50',
  yellow: 'border-l-4 border-l-yellow-400 bg-yellow-50',
  green: 'border-l-4 border-l-green-400 bg-green-50',
}

const RISK_ICONS = {
  red: AlertCircle,
  yellow: AlertTriangle,
  green: CheckCircle,
}

const RISK_ICON_COLORS = {
  red: 'text-red-500',
  yellow: 'text-yellow-500',
  green: 'text-green-500',
}

const TYPE_LABELS: Record<string, string> = {
  symptom_reported: 'Symptom Reported',
  patient_question: 'Patient Question',
  unconfirmed_appointment: 'Unconfirmed Appointment',
  medication_missed: 'Medication Missed',
}

export function AlertsList({ initialAlerts, hospitalId }: AlertsListProps) {
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts)
  const [filter, setFilter] = useState<'all' | 'open' | 'acknowledged'>('open')
  const [acknowledging, setAcknowledging] = useState<string | null>(null)

  const supabase = createClient()

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('alerts-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'alerts',
          filter: `hospital_id=eq.${hospitalId}`,
        },
        (payload) => {
          const newAlert = payload.new as Alert
          setAlerts((prev) => [newAlert, ...prev])

          // Show toast for RED alerts
          if (newAlert.risk_level === 'red') {
            toast.error(`🚨 RED ALERT — ${newAlert.message.slice(0, 80)}`, {
              duration: 10000,
            })
          } else if (newAlert.risk_level === 'yellow') {
            toast.warning(`⚠️ Alert — ${newAlert.message.slice(0, 80)}`, {
              duration: 6000,
            })
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'alerts',
          filter: `hospital_id=eq.${hospitalId}`,
        },
        (payload) => {
          const updated = payload.new as Alert
          setAlerts((prev) => prev.map((a) => a.id === updated.id ? { ...a, ...updated } : a))
        },
      )
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
  const redCount = alerts.filter((a) => a.status === 'open' && a.risk_level === 'red').length

  return (
    <div className="space-y-4">
      {/* Filter tabs + counts */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['open', 'acknowledged', 'all'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? 'default' : 'ghost'}
              onClick={() => setFilter(f)}
              className={filter === f ? 'bg-[#1C0770]' : ''}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'open' && openCount > 0 && (
                <Badge className={`ml-1.5 text-xs ${redCount > 0 ? 'bg-red-500' : 'bg-yellow-500'}`}>
                  {openCount}
                </Badge>
              )}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <RefreshCw className="w-3 h-3" />
          Live
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-8">No {filter} alerts</p>
      )}

      <div className="space-y-2">
        {filtered.map((alert) => {
          const risk = (alert.risk_level as keyof typeof RISK_STYLES) ?? 'green'
          const Icon = RISK_ICONS[risk] ?? CheckCircle
          const patient = alert.care_episodes?.patients
          const episodeId = alert.care_episodes?.id

          return (
            <Card
              key={alert.id}
              className={cn('overflow-hidden transition-opacity', RISK_STYLES[risk], alert.status !== 'open' && 'opacity-60')}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${RISK_ICON_COLORS[risk]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        {TYPE_LABELS[alert.type] ?? alert.type}
                      </Badge>
                      <Badge className={`text-xs uppercase ${risk === 'red' ? 'bg-red-500' : risk === 'yellow' ? 'bg-yellow-500 text-black' : 'bg-green-500'}`}>
                        {risk}
                      </Badge>
                      {patient && episodeId && (
                        <Link href={`/episodes/${episodeId}`} className="text-xs text-muted-foreground hover:underline">
                          {patient.full_name} · MRN {patient.mrn}
                        </Link>
                      )}
                    </div>
                    <p className="text-sm mt-1.5 line-clamp-3">{alert.message}</p>
                    <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {new Date(alert.created_at).toLocaleString('en-GB')}
                    </div>
                  </div>
                  {alert.status === 'open' && (
                    <div className="flex flex-col gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={acknowledging === alert.id}
                        onClick={() => handleAcknowledge(alert.id)}
                      >
                        Acknowledge
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-green-700"
                        onClick={() => handleResolve(alert.id)}
                      >
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
