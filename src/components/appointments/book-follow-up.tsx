'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { fromZonedTime } from 'date-fns-tz'
import { CalendarPlus, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface BookFollowUpProps {
  episodeId: string
  followUp: { id: string; specialty: string; instructions: string | null }
  /** Hospital timezone: the time is typed in clinic time, whatever the browser's. */
  timezone: string
}

/** "Dubai" from "Asia/Dubai", for the field label. */
export function clinicCity(timezone: string) {
  return timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone
}

/**
 * A follow-up the letter gave no date for, once the care plan has gone out:
 * book the visit straight away. The appointment is linked to the follow-up,
 * so it leaves "Needs a date"; the patient is asked to confirm from the
 * appointment's page.
 */
export function BookFollowUp({ episodeId, followUp, timezone }: BookFollowUpProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [when, setWhen] = useState('')
  const [place, setPlace] = useState('')
  const [saving, setSaving] = useState(false)
  const whenId = `book-${followUp.id}-when`
  const placeId = `book-${followUp.id}-place`

  function start() {
    setWhen('')
    setPlace('')
    setOpen(true)
  }

  async function book() {
    if (!when || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specialty: followUp.specialty,
          scheduled_at: fromZonedTime(when, timezone).toISOString(),
          location: place.trim() || undefined,
          follow_up_id: followUp.id,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: { id: string }; error?: string }
      if (!res.ok || !json.data) throw new Error(json.error ?? 'Could not book the appointment')
      const appointmentId = json.data.id
      setOpen(false)
      toast.success(`${followUp.specialty} booked`, {
        description: 'Next, ask the patient to confirm it on WhatsApp.',
        action: { label: 'Open', onClick: () => router.push(`/episodes/${episodeId}/appointments/${appointmentId}`) },
        duration: 8000,
      })
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not book the appointment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={start} className="h-8">
        <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" /> Book
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Book {followUp.specialty}</DialogTitle>
            <DialogDescription>{followUp.instructions ?? 'The discharge letter gave no date for this visit.'}</DialogDescription>
          </DialogHeader>
          <form
            id={`book-${followUp.id}`}
            className="grid gap-4"
            onSubmit={(e) => { e.preventDefault(); void book() }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor={whenId}>Date and time ({clinicCity(timezone)} time)</Label>
              <Input id={whenId} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required className="h-10" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={placeId}>Place <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id={placeId} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Cardiology Clinic, Floor 3" className="h-10" />
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" form={`book-${followUp.id}`} disabled={!when || saving} aria-busy={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Book
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
