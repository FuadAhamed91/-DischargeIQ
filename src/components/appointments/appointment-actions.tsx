'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send, Check, X, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { clinicCity } from '@/components/appointments/book-follow-up'
import type { Appointment } from '@/types/database'

interface AppointmentActionsProps {
  episodeId: string
  appointment: Appointment
  /** Hospital timezone: the date-time field is edited in local clinic time. */
  timezone: string
}

const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback)

export function AppointmentActions({ episodeId, appointment, timezone }: AppointmentActionsProps) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  // A provisional slot from the discharge letter has no real time yet: open the editor straight away.
  const [editing, setEditing] = useState(appointment.time_tbc && appointment.status === 'scheduled')
  const [saving, setSaving] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const [specialty, setSpecialty] = useState(appointment.specialty)
  // datetime-local shows clinic wall-clock time, not the browser's or UTC
  // (slicing the ISO string showed 05:00 for a 09:00 Dubai slot and shifted it on every save).
  const [scheduledAt, setScheduledAt] = useState(formatInTimeZone(new Date(appointment.scheduled_at), timezone, "yyyy-MM-dd'T'HH:mm"))
  const [location, setLocation] = useState(appointment.location ?? '')

  const canSendConfirmation = ['scheduled', 'reschedule_pending'].includes(appointment.status) && !appointment.time_tbc
  const isConfirmed = appointment.status === 'confirmed'
  const isClosed = ['cancelled', 'missed'].includes(appointment.status)

  async function handleSendConfirmation() {
    setSending(true)
    try {
      const res = await fetch(
        `/api/v1/episodes/${episodeId}/appointments/${appointment.id}/send-confirmation`,
        { method: 'POST' },
      )
      const json = await res.json().catch(() => ({})) as { error?: string; message?: string }
      if (!res.ok) throw new Error(json.message ? `${json.error}: ${json.message}` : (json.error ?? 'Could not send the WhatsApp message'))
      toast.success('Sent. The patient is asked to confirm on WhatsApp.')
      router.refresh()
    } catch (err) {
      toast.error(errorText(err, 'Could not send the WhatsApp message'))
    } finally {
      setSending(false)
    }
  }

  async function handleSave() {
    if (!specialty.trim() || !scheduledAt) {
      toast.error('The clinic and the date and time are needed')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(
        `/api/v1/episodes/${episodeId}/appointments/${appointment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            specialty: specialty.trim(),
            scheduled_at: fromZonedTime(scheduledAt, timezone).toISOString(),
            location: location.trim() || null,
          }),
        },
      )
      if (!res.ok) throw new Error('Could not save the appointment')
      toast.success(appointment.time_tbc ? 'Time booked. Now ask the patient to confirm it.' : 'Appointment updated')
      setEditing(false)
      router.refresh()
    } catch (err) {
      toast.error(errorText(err, 'Could not save the appointment'))
    } finally {
      setSaving(false)
    }
  }

  async function handleCancel() {
    setCancelling(true)
    try {
      const res = await fetch(
        `/api/v1/episodes/${episodeId}/appointments/${appointment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled' }),
        },
      )
      if (!res.ok) throw new Error('Could not cancel the appointment')
      toast.success('Appointment cancelled')
      setCancelOpen(false)
      router.push(`/episodes/${episodeId}?tab=care-plan`)
      router.refresh()
    } catch (err) {
      toast.error(errorText(err, 'Could not cancel the appointment'))
      setCancelling(false)
    }
  }

  if (isConfirmed) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft p-3 text-sm text-success">
        <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
        The patient has confirmed this appointment.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {editing && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{appointment.time_tbc ? 'Book the time' : 'Change the appointment'}</CardTitle>
            {appointment.time_tbc && (
              <CardDescription>
                The discharge letter asks for this visit by {formatInTimeZone(new Date(appointment.scheduled_at), timezone, 'EEEE d MMMM')}.
                Enter the booked date, time and place. Then the patient can be asked to confirm it.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void handleSave() }}>
              <div className="grid gap-1.5">
                <Label htmlFor="appt-clinic">Clinic</Label>
                <Input id="appt-clinic" value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="h-10" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="appt-when">Date and time ({clinicCity(timezone)} time)</Label>
                <Input id="appt-when" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="h-10" required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="appt-place">Place <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="appt-place" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Cardiology Clinic, Floor 3" className="h-10" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving} aria-busy={saving} className="h-10">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
                  Save
                </Button>
                <Button type="button" variant="ghost" className="h-10" onClick={() => setEditing(false)} disabled={saving}>Close</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {!isClosed && (
        <div className="flex flex-wrap gap-2">
          {canSendConfirmation && (
            <Button type="button" onClick={handleSendConfirmation} disabled={sending} aria-busy={sending} className="h-10">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              Ask the patient to confirm
            </Button>
          )}
          {!editing && (
            <Button type="button" variant="outline" className="h-10" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden="true" /> {appointment.time_tbc ? 'Book the time' : 'Change'}
            </Button>
          )}
          <Button type="button" variant="ghost" className="h-10 text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
            <X className="h-4 w-4" aria-hidden="true" /> Cancel appointment
          </Button>
          {appointment.time_tbc && !editing && (
            <p className="basis-full text-xs text-muted-foreground">Book the time first. The patient is asked to confirm a real time, not the letter’s “by” date.</p>
          )}
        </div>
      )}

      <Dialog open={cancelOpen} onOpenChange={(open) => { if (!cancelling) setCancelOpen(open) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this {appointment.specialty} appointment?</DialogTitle>
            <DialogDescription>
              It moves to “Past and cancelled”. The patient is not sent a message about it, so tell them if they need to know.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelling}>Keep it</Button>
            <Button type="button" variant="destructive" onClick={handleCancel} disabled={cancelling} aria-busy={cancelling}>
              {cancelling && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Cancel appointment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
