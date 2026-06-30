'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  FileText, MessageCircle, Bell, Calendar, Mic, Bot, AlertTriangle,
  CheckCircle, Upload, ClipboardCheck, Send,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface TimelineEvent {
  id: string
  event_type: string
  payload: Record<string, unknown>
  risk_level: string | null
  created_at: string
}

const EVENT_CONFIG: Record<string, { icon: typeof FileText; color: string; bg: string; label: string }> = {
  discharge_uploaded:    { icon: Upload,        color: 'text-blue-600',   bg: 'bg-blue-100',   label: 'Discharge PDF uploaded' },
  extraction_completed:  { icon: FileText,      color: 'text-blue-600',   bg: 'bg-blue-100',   label: 'AI extraction completed' },
  summary_approved:      { icon: ClipboardCheck,color: 'text-[#1C0770]',  bg: 'bg-[#F0EDFF]',  label: 'Summary approved' },
  summary_sent:          { icon: Send,          color: 'text-[#30D5C8]',  bg: 'bg-teal-50',    label: 'Summary sent to patient' },
  whatsapp_inbound:      { icon: MessageCircle, color: 'text-gray-600',   bg: 'bg-gray-100',   label: 'Patient message received' },
  whatsapp_outbound:     { icon: Send,          color: 'text-gray-600',   bg: 'bg-gray-100',   label: 'Message sent to patient' },
  reminder_sent:         { icon: Bell,          color: 'text-amber-600',  bg: 'bg-amber-50',   label: 'Reminder sent' },
  reminder_response:     { icon: CheckCircle,   color: 'text-green-600',  bg: 'bg-green-50',   label: 'Patient responded to reminder' },
  appointment_confirmed: { icon: Calendar,      color: 'text-green-600',  bg: 'bg-green-50',   label: 'Appointment confirmed' },
  appointment_rescheduled:{ icon: Calendar,     color: 'text-amber-600',  bg: 'bg-amber-50',   label: 'Appointment rescheduled' },
  triage_completed:      { icon: Mic,           color: 'text-purple-600', bg: 'bg-purple-50',  label: 'Voice triage completed' },
  ai_response:           { icon: Bot,           color: 'text-[#1C0770]',  bg: 'bg-[#F0EDFF]',  label: 'AI answered patient question' },
  escalation_created:    { icon: AlertTriangle, color: 'text-red-600',    bg: 'bg-red-50',     label: 'Escalation created' },
  alert_acknowledged:    { icon: CheckCircle,   color: 'text-green-600',  bg: 'bg-green-50',   label: 'Alert acknowledged' },
}

const RISK_COLORS: Record<string, string> = {
  red: 'bg-red-500',
  yellow: 'bg-yellow-400',
  green: 'bg-green-500',
}

function getPayloadSummary(event: TimelineEvent): string | null {
  const p = event.payload
  switch (event.event_type) {
    case 'triage_completed':
      return p.transcript ? `"${String(p.transcript).slice(0, 100)}…"` : null
    case 'reminder_response':
      return p.response ? `Response: ${p.response}` : null
    case 'ai_response':
      return p.question ? `Q: "${String(p.question).slice(0, 80)}…"` : null
    case 'appointment_confirmed':
    case 'appointment_rescheduled':
      return p.specialty ? `${p.specialty}` : null
    default:
      return null
  }
}

interface EpisodeTimelineProps {
  initialEvents: TimelineEvent[]
  episodeId: string
}

export function EpisodeTimeline({ initialEvents, episodeId }: EpisodeTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>(initialEvents)
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel(`timeline-${episodeId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'patient_timeline_events',
        filter: `episode_id=eq.${episodeId}`,
      }, (payload) => {
        setEvents((prev) => [payload.new as TimelineEvent, ...prev])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [episodeId, supabase])

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">No timeline events yet.</p>
  }

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-5 top-3 bottom-3 w-px bg-border" />

      {events.map((event, idx) => {
        const config = EVENT_CONFIG[event.event_type] ?? { icon: FileText, color: 'text-gray-400', bg: 'bg-gray-100', label: event.event_type }
        const Icon = config.icon
        const summary = getPayloadSummary(event)

        return (
          <div key={event.id} className={`relative flex gap-4 ${idx < events.length - 1 ? 'pb-5' : ''}`}>
            {/* Icon */}
            <div className={`relative z-10 w-10 h-10 rounded-full ${config.bg} flex items-center justify-center shrink-0`}>
              <Icon className={`w-4 h-4 ${config.color}`} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 pt-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{config.label}</span>
                {event.risk_level && (
                  <span className={`inline-block w-2 h-2 rounded-full ${RISK_COLORS[event.risk_level] ?? 'bg-gray-400'}`} />
                )}
                {event.risk_level && (
                  <Badge variant="outline" className="text-xs capitalize">{event.risk_level}</Badge>
                )}
              </div>
              {summary && <p className="text-xs text-muted-foreground mt-0.5">{summary}</p>}
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                {new Date(event.created_at).toLocaleString('en-GB')}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
