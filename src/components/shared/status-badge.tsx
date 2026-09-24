import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { EpisodeStatus, SummaryStatus, AppointmentStatus } from '@/types/enums'

type AnyStatus = EpisodeStatus | SummaryStatus | AppointmentStatus

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  // Episode
  draft:          { label: 'Draft',           className: 'bg-muted text-muted-foreground border-border' },
  pending_review: { label: 'Needs review',    className: 'bg-warning-soft text-warning border-warning/30' },
  active:         { label: 'Active',          className: 'bg-info-soft text-info border-info/20' },
  completed:      { label: 'Completed',       className: 'bg-success-soft text-success border-success/20' },
  cancelled:      { label: 'Cancelled',       className: 'bg-muted text-muted-foreground/70 border-border line-through decoration-muted-foreground/40' },
  // Summary
  approved:       { label: 'Approved',        className: 'bg-success-soft text-success border-success/20' },
  sent:           { label: 'Sent',            className: 'bg-brand-soft text-brand border-brand/15' },
  // Appointment
  scheduled:            { label: 'Scheduled',          className: 'bg-info-soft text-info border-info/20' },
  confirmation_pending: { label: 'Awaiting confirmation', className: 'bg-warning-soft text-warning border-warning/30' },
  confirmed:            { label: 'Confirmed',          className: 'bg-success-soft text-success border-success/20' },
  reschedule_pending:   { label: 'Asked to reschedule', className: 'bg-warning-soft text-warning border-warning/30' },
  rescheduled:          { label: 'Rescheduled',        className: 'bg-teal-soft text-teal-foreground border-teal/30' },
  missed:               { label: 'Missed',             className: 'bg-danger-soft text-danger border-danger/20' },
}

interface StatusBadgeProps {
  status: AnyStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-muted text-muted-foreground border-border' }
  return (
    <Badge variant="outline" className={cn('font-medium whitespace-nowrap', config.className, className)}>
      {config.label}
    </Badge>
  )
}
