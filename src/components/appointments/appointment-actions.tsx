'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send, Check, X, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { Appointment } from '@/types/database'

interface AppointmentActionsProps {
  episodeId: string
  appointment: Appointment
  /** Hospital timezone: the date-time field is edited in local clinic time. */
  timezone: string
}

export function AppointmentActions({ episodeId, appointment, timezone }: AppointmentActionsProps) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  // A provisional slot from the discharge letter has no real time yet: open the editor straight away.
  const [editing, setEditing] = useState(appointment.time_tbc && appointment.status === 'scheduled')
  const [saving, setSaving] = useState(false)

  const [specialty, setSpecialty] = useState(appointment.specialty)
  // datetime-local shows clinic wall-clock time, not the browser's or UTC
  // (slicing the ISO string showed 05:00 for a 09:00 Dubai slot and shifted it on every save).
  const [scheduledAt, setScheduledAt] = useState(formatInTimeZone(new Date(appointment.scheduled_at), timezone, "yyyy-MM-dd'T'HH:mm"))
  const [location, setLocation] = useState(appointment.location ?? '')

  const canSendConfirmation = ['scheduled', 'reschedule_pending'].includes(appointment.status) && !appointment.time_tbc
  const isConfirmed = appointment.status === 'confirmed'

  async function handleSendConfirmation() {
    setSending(true)
    try {
      const res = await fetch(
        `/api/v1/episodes/${episodeId}/appointments/${appointment.id}/send-confirmation`,
        { method: 'POST' },
      )
      const json = await res.json() as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed to send')
      toast.success('Confirmation request sent to patient via WhatsApp ✅')
      router.refresh()
    } catch (err) {
      toast.error(String(err))
    } finally {
      setSending(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(
        `/api/v1/episodes/${episodeId}/appointments/${appointment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            specialty,
            scheduled_at: fromZonedTime(scheduledAt, timezone).toISOString(),
            location: location || null,
          }),
        },
      )
      if (!res.ok) throw new Error('Save failed')
      toast.success(appointment.time_tbc ? 'Time booked — you can now ask the patient to confirm' : 'Appointment updated')
      setEditing(false)
      router.refresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel() {
    if (!confirm('Cancel this appointment?')) return
    const res = await fetch(
      `/api/v1/episodes/${episodeId}/appointments/${appointment.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      },
    )
    if (res.ok) {
      toast.success('Appointment cancelled')
      router.push(`/episodes/${episodeId}`)
      router.refresh()
    } else {
      toast.error('Failed to cancel')
    }
  }

  return (
    <div className="space-y-4">
      {/* Edit form */}
      {editing ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{appointment.time_tbc ? 'Book the appointment time' : 'Edit Appointment'}</CardTitle>
            {appointment.time_tbc && (
              <p className="text-sm text-muted-foreground">
                The discharge summary asks for this visit by {formatInTimeZone(new Date(appointment.scheduled_at), timezone, 'EEEE d MMMM')}. Enter the booked date, time and place; then the patient can be asked to confirm.
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs mb-1 block">Specialty</Label>
              <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Date &amp; Time ({timezone})</Label>
              <Input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Location (optional)</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Clinic / room" className="h-8 text-sm" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleSave} disabled={saving} style={{ backgroundColor: 'var(--brand)' }}>
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Action buttons */}
      {!isConfirmed && (
        <div className="flex flex-wrap gap-2">
          {canSendConfirmation && (
            <Button
              onClick={handleSendConfirmation}
              disabled={sending}
              className="bg-success hover:bg-success/90 text-success-foreground"
            >
              {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              Send WhatsApp Confirmation
            </Button>
          )}
          {!editing && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="w-4 h-4 mr-2" /> {appointment.time_tbc ? 'Book time' : 'Edit appointment'}
            </Button>
          )}
          {appointment.time_tbc && !editing && (
            <p className="basis-full text-xs text-muted-foreground">Book the time first — the patient is asked to confirm a real slot, not the letter’s “by” date.</p>
          )}
          {!['cancelled', 'missed'].includes(appointment.status) && (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={handleCancel}>
              <X className="w-4 h-4 mr-2" /> Cancel appointment
            </Button>
          )}
        </div>
      )}

      {isConfirmed && (
        <div className="flex items-center gap-2 p-3 bg-success-soft border border-success/30 rounded-lg text-sm text-success">
          <Check className="w-4 h-4" />
          Patient has confirmed this appointment.
        </div>
      )}
    </div>
  )
}
