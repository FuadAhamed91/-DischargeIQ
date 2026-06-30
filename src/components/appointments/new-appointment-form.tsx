'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

interface NewAppointmentFormProps {
  episodeId: string
  defaultSpecialty?: string
  defaultFollowUpId?: string
}

export function NewAppointmentForm({ episodeId, defaultSpecialty, defaultFollowUpId }: NewAppointmentFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [specialty, setSpecialty] = useState(defaultSpecialty ?? '')
  const [scheduledAt, setScheduledAt] = useState('')
  const [location, setLocation] = useState('')

  async function handleCreate() {
    if (!specialty || !scheduledAt) {
      toast.error('Specialty and date/time are required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          specialty,
          scheduled_at: new Date(scheduledAt).toISOString(),
          location: location || null,
          follow_up_id: defaultFollowUpId ?? null,
        }),
      })
      const json = await res.json() as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed to create')
      toast.success('Appointment created')
      setOpen(false)
      setSpecialty(defaultSpecialty ?? '')
      setScheduledAt('')
      setLocation('')
      router.refresh()
    } catch (err) {
      toast.error(String(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="w-3.5 h-3.5 mr-1.5" /> Add appointment
      </Button>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between py-3">
        <CardTitle className="text-sm">New Appointment</CardTitle>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setOpen(false)}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs mb-1 block">Specialty</Label>
          <Input
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            placeholder="e.g. Cardiology, Physiotherapy"
            className="h-8 text-sm"
          />
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
          <Input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Clinic name or room number"
            className="h-8 text-sm"
          />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleCreate} disabled={saving} style={{ backgroundColor: '#1C0770' }}>
            {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Plus className="w-3.5 h-3.5 mr-1.5" />}
            Create
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  )
}
