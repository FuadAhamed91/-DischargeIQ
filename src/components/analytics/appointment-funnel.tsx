'use client'

import { Calendar, CheckCircle, XCircle, Clock } from 'lucide-react'

interface FunnelProps {
  total: number
  confirmed: number
  missed: number
  pending: number
}

export function AppointmentFunnel({ total, confirmed, missed, pending }: FunnelProps) {
  const completionRate = total > 0 ? Math.round((confirmed / total) * 100) : 0
  const missedRate = total > 0 ? Math.round((missed / total) * 100) : 0

  const steps = [
    { label: 'Total scheduled', value: total, icon: Calendar, color: 'text-brand', bg: 'bg-brand-soft' },
    { label: 'Confirmed', value: confirmed, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Pending confirmation', value: pending, icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50' },
    { label: 'Missed', value: missed, icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' },
  ]

  return (
    <div className="space-y-3">
      {steps.map((step) => {
        const width = total > 0 ? Math.round((step.value / total) * 100) : 0
        const Icon = step.icon
        return (
          <div key={step.label}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className={`p-1 rounded ${step.bg}`}>
                  <Icon className={`w-3.5 h-3.5 ${step.color}`} />
                </div>
                <span className="text-sm">{step.label}</span>
              </div>
              <span className="text-sm font-bold">{step.value}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${step.bg.replace('bg-', 'bg-').replace('-50', '-400').replace('brand-soft', 'brand')}`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        )
      })}

      <div className="pt-2 flex items-center justify-between text-xs text-muted-foreground border-t mt-3">
        <span>Completion rate</span>
        <span className={`font-bold text-sm ${completionRate >= 70 ? 'text-green-600' : completionRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
          {completionRate}%
        </span>
      </div>
      {missedRate > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Missed rate</span>
          <span className="font-bold text-sm text-red-600">{missedRate}%</span>
        </div>
      )}
    </div>
  )
}
