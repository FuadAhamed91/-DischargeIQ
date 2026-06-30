'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AlertCircle, AlertTriangle, CheckCircle, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

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

const SEVERITY_ICONS: Record<string, typeof AlertCircle> = {
  critical: AlertCircle,
  high: AlertCircle,
  medium: AlertTriangle,
  low: CheckCircle,
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-500',
  high: 'text-orange-500',
  medium: 'text-yellow-500',
  low: 'text-green-500',
}

const TYPE_LABELS: Record<string, string> = {
  risk_red: 'Red Risk Alert',
  risk_yellow: 'Yellow Risk Alert',
  escalation: 'Escalation',
  missed_appointment: 'Missed Appointment',
  unconfirmed_appointment: 'Unconfirmed Appointment',
}

const SEVERITY_BADGE_COLORS: Record<string, string> = {
  critical: 'bg-red-500 text-white',
  high: 'bg-orange-500 text-white',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-green-500 text-white',
}

export function RecentAlerts({ alerts: initialAlerts, hospitalId }: { alerts: Alert[], hospitalId: string }) {
  const [alerts, setAlerts] = useState(initialAlerts)
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('recent-alerts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` },
        (payload) => { setAlerts((prev) => [payload.new as Alert, ...prev].slice(0, 5)) })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [hospitalId, supabase])

  if (alerts.length === 0) {
    return <p className="text-sm text-muted-foreground px-4 pb-4">No recent alerts.</p>
  }

  return (
    <div className="divide-y">
      {alerts.slice(0, 5).map((alert) => {
        const sev = alert.severity ?? 'low'
        const Icon = SEVERITY_ICONS[sev] ?? CheckCircle
        const patient = alert.care_episodes?.patients
        const episodeId = alert.care_episodes?.id

        return (
          <div key={alert.id} className="flex items-start gap-3 px-4 py-3">
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${SEVERITY_COLORS[sev]}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge className={`text-xs ${SEVERITY_BADGE_COLORS[sev]}`}>{sev}</Badge>
                <span className="text-xs text-muted-foreground">{TYPE_LABELS[alert.type] ?? alert.type}</span>
                {patient && episodeId && (
                  <Link href={`/episodes/${episodeId}`} className="text-xs text-muted-foreground hover:underline truncate">
                    · {patient.full_name}
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground/60">
                <Clock className="w-3 h-3" />
                {new Date(alert.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            {alert.status === 'open' && (
              <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 shrink-0 animate-pulse" />
            )}
          </div>
        )
      })}
    </div>
  )
}
