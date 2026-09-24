'use client'

import { CheckCircle, XCircle, Clock, CircleDashed, FileClock } from 'lucide-react'
import type { AppointmentBreakdown } from '@/lib/analytics/appointments'

/** Booked appointments by where they stand; the rows add up to the booked total. */
export function AppointmentFunnel({ booked, confirmed, waiting, notAsked, missed, toBook, confirmedRate }: AppointmentBreakdown) {
  const missedRate = booked > 0 ? Math.round((missed / booked) * 100) : 0

  const steps = [
    { label: 'Confirmed by the patient', value: confirmed, icon: CheckCircle, color: 'text-success', bg: 'bg-success-soft', bar: 'bg-success' },
    { label: 'Waiting for the patient', value: waiting, icon: Clock, color: 'text-warning', bg: 'bg-warning-soft', bar: 'bg-warning' },
    { label: 'Not asked yet', value: notAsked, icon: CircleDashed, color: 'text-muted-foreground', bg: 'bg-muted', bar: 'bg-muted-foreground/50' },
    { label: 'Missed', value: missed, icon: XCircle, color: 'text-danger', bg: 'bg-danger-soft', bar: 'bg-danger' },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">Booked</span>
        <span className="text-sm font-bold">{booked}</span>
      </div>

      {steps.map((step) => {
        const width = booked > 0 ? Math.round((step.value / booked) * 100) : 0
        const Icon = step.icon
        return (
          <div key={step.label}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className={`p-1 rounded ${step.bg}`}>
                  <Icon className={`w-3.5 h-3.5 ${step.color}`} aria-hidden="true" />
                </div>
                <span className="text-sm">{step.label}</span>
              </div>
              <span className="text-sm font-bold">{step.value}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${step.bar}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        )
      })}

      <div className="pt-2 flex items-center justify-between text-xs text-muted-foreground border-t mt-3">
        <span>Confirmed</span>
        <span className={`font-bold text-sm ${confirmedRate == null ? '' : confirmedRate >= 70 ? 'text-success' : confirmedRate >= 50 ? 'text-warning' : 'text-danger'}`}>
          {confirmedRate == null ? '—' : `${confirmedRate}%`}
        </span>
      </div>
      {missedRate > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Missed</span>
          <span className="font-bold text-sm text-danger">{missedRate}%</span>
        </div>
      )}
      {toBook > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {toBook} more from discharge letters still need a time booked
        </p>
      )}
    </div>
  )
}
