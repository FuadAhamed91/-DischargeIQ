'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  FileText, MessageCircle, Bell, BellRing, Calendar, Mic, Bot, AlertTriangle,
  CheckCircle, Upload, ClipboardCheck, Send, Activity, Stethoscope,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface TimelineEvent {
  id: string
  event_type: string
  payload: Record<string, unknown>
  risk_level: string | null
  created_at: string
}

interface EventConfig {
  icon: typeof FileText
  color: string
  bg: string
  label: string
}

const EVENT_CONFIG: Record<string, EventConfig> = {
  discharge_uploaded:    { icon: Upload,        color: 'text-info',   bg: 'bg-info-soft',   label: 'Discharge PDF uploaded' },
  extraction_completed:  { icon: FileText,      color: 'text-info',   bg: 'bg-info-soft',   label: 'AI extraction completed' },
  summary_approved:      { icon: ClipboardCheck,color: 'text-brand',  bg: 'bg-brand-soft',  label: 'Summary approved' },
  summary_sent:          { icon: Send,          color: 'text-teal',  bg: 'bg-teal-soft',    label: 'Summary sent to patient' },
  whatsapp_inbound:      { icon: MessageCircle, color: 'text-muted-foreground',   bg: 'bg-muted',   label: 'Patient message received' },
  whatsapp_outbound:     { icon: Send,          color: 'text-muted-foreground',   bg: 'bg-muted',   label: 'Message sent to patient' },
  reminder_sent:         { icon: Bell,          color: 'text-warning',  bg: 'bg-warning-soft',   label: 'Reminder sent' },
  reminder_response:     { icon: CheckCircle,   color: 'text-success',  bg: 'bg-success-soft',   label: 'Patient responded to reminder' },
  appointment_confirmed: { icon: Calendar,      color: 'text-success',  bg: 'bg-success-soft',   label: 'Appointment confirmed' },
  appointment_rescheduled:{ icon: Calendar,     color: 'text-warning',  bg: 'bg-warning-soft',   label: 'Appointment rescheduled' },
  triage_completed:      { icon: Stethoscope,   color: 'text-brand', bg: 'bg-brand-soft',  label: 'Triage completed' },
  ai_response:           { icon: Bot,           color: 'text-brand',  bg: 'bg-brand-soft',  label: 'AI answered patient question' },
  escalation_created:    { icon: AlertTriangle, color: 'text-danger',    bg: 'bg-danger-soft',     label: 'Escalation created' },
  alert_acknowledged:    { icon: CheckCircle,   color: 'text-success',  bg: 'bg-success-soft',   label: 'Alert acknowledged' },
  risk_changed:          { icon: Activity,      color: 'text-brand',    bg: 'bg-brand-soft',     label: 'Risk level changed by a nurse' },
}

// 'triage_completed' has two writers: recordTriage() in webhook-handler.ts for a real
// triage ({ transcript, source, ... }), and the log_timeline_on_alert trigger
// (migration 00003) for EVERY alert, triage or not ({ alert_id, alert_type, severity }).
const TRIAGE_CONFIG: Record<'alert' | 'voice' | 'symptom_report', EventConfig> = {
  alert:          { icon: BellRing,    color: 'text-danger', bg: 'bg-danger-soft', label: 'Alert raised' },
  voice:          { icon: Mic,         color: 'text-brand',  bg: 'bg-brand-soft',  label: 'Voice note triaged' },
  symptom_report: { icon: Stethoscope, color: 'text-brand',  bg: 'bg-brand-soft',  label: 'Symptom report triaged' },
}

const ALERT_TYPES: Record<string, string> = {
  risk_red: 'Red risk',
  risk_yellow: 'Yellow risk',
  escalation: 'Escalation',
  missed_medication: 'Missed medicines',
  delivery_failed: 'Message not delivered',
  unconfirmed_appointment: 'Appointment not confirmed',
  missed_appointment: 'Missed appointment',
}

const RISK_COLORS: Record<string, string> = {
  red: 'bg-danger',
  yellow: 'bg-warning',
  green: 'bg-success',
}

function getEventConfig(event: TimelineEvent): EventConfig {
  const p = event.payload
  switch (event.event_type) {
    case 'triage_completed':
      if (p.alert_id) {
        const type = typeof p.alert_type === 'string' ? (ALERT_TYPES[p.alert_type] ?? p.alert_type) : null
        return type ? { ...TRIAGE_CONFIG.alert, label: `Alert raised: ${type}` } : TRIAGE_CONFIG.alert
      }
      if (p.source === 'voice') return TRIAGE_CONFIG.voice
      if (p.source === 'text' || p.source === 'nightly_checkin') return TRIAGE_CONFIG.symptom_report
      return EVENT_CONFIG.triage_completed
    default:
      return EVENT_CONFIG[event.event_type] ?? { icon: FileText, color: 'text-muted-foreground', bg: 'bg-muted', label: event.event_type }
  }
}

function getPayloadSummary(event: TimelineEvent): string | null {
  const p = event.payload
  switch (event.event_type) {
    case 'triage_completed':
      if (p.alert_id) return p.severity ? `Severity: ${p.severity}` : null
      return p.transcript ? `"${String(p.transcript).slice(0, 100)}…"` : null
    case 'reminder_response':
      return p.response ? `Response: ${p.response}` : null
    case 'ai_response':
      return p.question ? `Q: "${String(p.question).slice(0, 80)}…"` : null
    case 'appointment_confirmed':
    case 'appointment_rescheduled':
      return p.specialty ? `${p.specialty}` : null
    case 'risk_changed': {
      // "red → green · Fuad Ahamed: “Called him — the pain has settled”"
      const who = typeof p.changed_by === 'string' ? ` · ${p.changed_by}` : ''
      const note = typeof p.note === 'string' && p.note ? `: “${p.note}”` : ''
      return `${p.from} → ${p.to}${who}${note}`
    }
    case 'whatsapp_inbound': {
      // On a shared number: how the message was matched to this patient, and who typed it.
      const routing = p.routing as { via?: string } | undefined
      const parts: string[] = []
      if (routing?.via && routing.via !== 'only') parts.push(INBOUND_ROUTING[routing.via] ?? routing.via)
      if (typeof p.sender_name === 'string' && p.sender_name) parts.push(`typed by ${p.sender_name}`)
      return parts.length ? parts.join(' · ') : null
    }
    default:
      return null
  }
}

const INBOUND_ROUTING: Record<string, string> = {
  choice: 'shared number: sender chose this patient',
  name: 'shared number: named in the message',
  reply: 'shared number: reply to the pending question',
  recent: 'shared number: last patient written about',
  emergency: 'shared number: emergency, best guess',
  fallback: 'shared number: best guess',
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
        const config = getEventConfig(event)
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
                  <span className={`inline-block w-2 h-2 rounded-full ${RISK_COLORS[event.risk_level] ?? 'bg-muted-foreground/40'}`} />
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
