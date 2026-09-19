import { Pill, TrendingUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'

interface Medication {
  id: string
  name: string
  dosage: string
  frequency: string
  reminder_times: string[]
}

interface ReminderJob {
  status: string
  schedule_id: string
}

interface MedicationAdherenceProps {
  medications: Medication[]
  reminderJobs: ReminderJob[]
  positiveResponses: number
}

export function MedicationAdherence({ medications, reminderJobs, positiveResponses }: MedicationAdherenceProps) {
  const totalJobs = reminderJobs.length
  const rate = totalJobs > 0 ? Math.round((positiveResponses / totalJobs) * 100) : null

  const rateColor =
    rate === null ? 'text-muted-foreground' :
    rate >= 80 ? 'text-success' :
    rate >= 50 ? 'text-warning' : 'text-danger'

  return (
    <div className="space-y-4">
      {/* Overall rate */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Overall adherence</span>
        </div>
        <span className={`text-lg font-bold ${rateColor}`}>
          {rate !== null ? `${rate}%` : '—'}
        </span>
      </div>
      {rate !== null && (
        <Progress value={rate} className="h-2" />
      )}
      {totalJobs > 0 && (
        <p className="text-xs text-muted-foreground">
          {positiveResponses} of {totalJobs} reminders acknowledged
        </p>
      )}

      {/* Per-medication */}
      <div className="space-y-3 pt-2">
        {medications.map((med) => (
          <div key={med.id} className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <Pill className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">{med.name}</p>
                <p className="text-xs text-muted-foreground">{med.dosage} · {med.frequency}</p>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {(med.reminder_times ?? []).map((t) => (
                    <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {medications.length === 0 && (
        <p className="text-sm text-muted-foreground">No medications on record.</p>
      )}
    </div>
  )
}
