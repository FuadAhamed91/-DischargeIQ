import { AlertCircle, AlertTriangle, Info, ShieldAlert } from 'lucide-react'
import { formatInTimeZone } from 'date-fns-tz'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * Shared vocabulary for alerts across the dashboard so severity always looks
 * and reads the same. Colour is never the only signal: every severity has an
 * icon and a text label, and each row also states the alert type.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low'

export const SEVERITY: Record<Severity, {
  label: string
  icon: typeof AlertCircle
  badge: string       // soft chip
  icon_color: string
  accent: string      // left border on list rows
  soft_bg: string
}> = {
  critical: { label: 'Critical', icon: ShieldAlert,    badge: 'bg-danger text-danger-foreground border-transparent',        icon_color: 'text-danger',  accent: 'border-l-danger',  soft_bg: 'bg-danger-soft/50' },
  high:     { label: 'High',     icon: AlertCircle,    badge: 'bg-danger-soft text-danger border-danger/20',    icon_color: 'text-danger',  accent: 'border-l-danger/70', soft_bg: 'bg-danger-soft/30' },
  medium:   { label: 'Medium',   icon: AlertTriangle,  badge: 'bg-warning-soft text-warning border-warning/30', icon_color: 'text-warning', accent: 'border-l-warning', soft_bg: 'bg-warning-soft/40' },
  low:      { label: 'Low',      icon: Info,           badge: 'bg-info-soft text-info border-info/20',          icon_color: 'text-info',    accent: 'border-l-info/60',  soft_bg: 'bg-info-soft/30' },
}

export const ALERT_TYPE_LABELS: Record<string, string> = {
  risk_red: 'Urgent symptom reported',
  risk_yellow: 'Symptom to check',
  escalation: 'Needs a nurse',
  missed_appointment: 'Missed appointment',
  unconfirmed_appointment: 'Appointment not confirmed',
  missed_medication: 'Missed medicines',
  delivery_failed: 'WhatsApp message not delivered',
}

export const ALERT_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
}

export function severityOf(value: string | null | undefined): Severity {
  return (value && value in SEVERITY ? value : 'low') as Severity
}

export function SeverityBadge({ severity, className }: { severity: string | null | undefined; className?: string }) {
  const sev = severityOf(severity)
  const cfg = SEVERITY[sev]
  const Icon = cfg.icon
  return (
    <Badge variant="outline" className={cn('gap-1 text-[11px] font-semibold', cfg.badge, className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {cfg.label}
    </Badge>
  )
}

export function AlertStatusBadge({ status }: { status: string }) {
  if (status === 'open') return null
  return (
    <Badge variant="secondary" className="text-[11px] font-medium text-muted-foreground">
      {ALERT_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

/** Hospital-timezone timestamp; deterministic on server and client (no hydration drift). */
export function alertTime(iso: string, tz: string, pattern = 'd MMM, HH:mm'): string {
  try { return formatInTimeZone(new Date(iso), tz, pattern) } catch { return '' }
}
