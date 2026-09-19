'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send, Check, X, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import type { Appointment } from '@/types/database'

interface AppointmentActionsProps {
  episodeId: string
  appointment: Appointment
}

export function AppointmentActions({ episodeId, appointment }: AppointmentActionsProps) {
  const router = useRouter()
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const [specialty, setSpecialty] = useState(appointment.specialty)
  const [scheduledAt, setScheduledAt] = useState(
    appointment.scheduled_at.slice(0, 16), // datetime-local format
  )
  const [location, setLocation] = useState(appointment.location ?? '')

  const canSendConfirmation = ['scheduled', 'reschedule_pending'].includes(appointment.status)
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
            scheduled_at: new Date(scheduledAt).toISOString(),
            location: location || null,
          }),
        },
      )
      if (!res.ok) throw new Error('Save failed')
      toast.success('Appointment updated')
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
            <CardTitle className="text-base">Edit Appointment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs mb-1 block">Specialty</Label>
              <Input value={specialty} onChange={(e) => setSpecialty(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Date &amp; Time</Label>
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
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              Send WhatsApp Confirmation
            </Button>
          )}
          {!editing && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="w-4 h-4 mr-2" /> Edit appointment
            </Button>
          )}
          {!['cancelled', 'missed'].includes(appointment.status) && (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={handleCancel}>
              <X className="w-4 h-4 mr-2" /> Cancel appointment
            </Button>
          )}
        </div>
      )}

      {isConfirmed && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          <Check className="w-4 h-4" />
          Patient has confirmed this appointment.
        </div>
      )}
    </div>
  )
}
