import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { EpisodeStatus, SummaryStatus, AppointmentStatus } from '@/types/enums'

type AnyStatus = EpisodeStatus | SummaryStatus | AppointmentStatus

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  // Episode
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100' },
  pending_review: { label: 'Pending Review', className: 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100' },
  active: { label: 'Active', className: 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100' },
  completed: { label: 'Completed', className: 'bg-green-100 text-green-700 border-green-200 hover:bg-green-100' },
  cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-100' },
  // Summary
  approved: { label: 'Approved', className: 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
  sent: { label: 'Sent', className: 'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-100' },
  // Appointment
  scheduled: { label: 'Scheduled', className: 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100' },
  confirmation_pending: { label: 'Awaiting Confirm', className: 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100' },
  confirmed: { label: 'Confirmed', className: 'bg-green-100 text-green-700 border-green-200 hover:bg-green-100' },
  reschedule_pending: { label: 'Reschedule Pending', className: 'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100' },
  rescheduled: { label: 'Rescheduled', className: 'bg-cyan-100 text-cyan-700 border-cyan-200 hover:bg-cyan-100' },
  missed: { label: 'Missed', className: 'bg-red-100 text-red-700 border-red-200 hover:bg-red-100' },
}

interface StatusBadgeProps {
  status: AnyStatus
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: 'bg-slate-100 text-slate-600' }
  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  )
}
