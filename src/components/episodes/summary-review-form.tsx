'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, Loader2, CheckCircle, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import type { DischargeSummary, Medication, FollowUpRequirement } from '@/types/database'

interface SummaryReviewFormProps {
  episodeId: string
  summary: DischargeSummary & {
    medications: Medication[]
    follow_up_requirements: FollowUpRequirement[]
  }
}

export function SummaryReviewForm({ episodeId, summary }: SummaryReviewFormProps) {
  const router = useRouter()

  const [medications, setMedications] = useState(summary.medications)
  const [followUps, setFollowUps] = useState(summary.follow_up_requirements)
  const [emergencySymptoms, setEmergencySymptoms] = useState<string[]>(summary.emergency_symptoms)
  const [lifestyleInstructions, setLifestyleInstructions] = useState<string[]>(summary.lifestyle_instructions)
  const [restrictions, setRestrictions] = useState<string[]>(summary.restrictions)
  const [activities, setActivities] = useState<string[]>(summary.activities)
  const [nurseNotes, setNurseNotes] = useState(summary.nurse_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [sending, setSending] = useState(false)
  const [summaryStatus, setSummaryStatus] = useState(summary.status)

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/summary`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nurse_notes: nurseNotes,
          emergency_symptoms: emergencySymptoms,
          lifestyle_instructions: lifestyleInstructions,
          restrictions,
          activities,
          medications: medications.map((m, i) => ({ ...m, sort_order: i })),
          follow_up_requirements: followUps,
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      toast.success('Summary saved')
    } catch {
      toast.error('Failed to save summary')
    } finally {
      setSaving(false)
    }
  }

  async function handleApprove() {
    // Client-side guard — must have at least something meaningful
    const hasMedications = medications.some((m) => m.name.trim() !== '')
    const hasSymptoms = emergencySymptoms.some((s) => s.trim() !== '')
    const hasInstructions = lifestyleInstructions.some((i) => i.trim() !== '')
    const hasRestrictions = restrictions.some((r) => r.trim() !== '')

    if (!hasMedications && !hasSymptoms && !hasInstructions && !hasRestrictions) {
      toast.error('Cannot approve an empty summary. Please add at least one medication, emergency symptom, or instruction before approving.')
      return
    }

    setApproving(true)
    try {
      await handleSave()
      const res = await fetch(`/api/v1/episodes/${episodeId}/summary/approve`, { method: 'POST' })
      const json = await res.json() as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Approval failed')
      toast.success('Summary approved — ready to send to patient')
      setSummaryStatus('approved')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve summary')
    } finally {
      setApproving(false)
    }
  }

  async function handleSendToPatient() {
    setSending(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/summary/send`, { method: 'POST' })
      const json = await res.json() as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Send failed')
      toast.success('Discharge instructions sent to patient via WhatsApp ✅')
      setSummaryStatus('sent')
      router.push(`/episodes/${episodeId}`)
      router.refresh()
    } catch (err) {
      toast.error(String(err) || 'Failed to send to patient')
    } finally {
      setSending(false)
    }
  }

  function addMedication() {
    setMedications((prev) => [
      ...prev,
      { id: crypto.randomUUID(), summary_id: summary.id, hospital_id: summary.hospital_id, name: '', dosage: '', frequency: '', instructions: '', reminder_times: [], sort_order: prev.length, created_at: '' },
    ])
  }

  function updateMedication(index: number, field: keyof Medication, value: string | string[]) {
    setMedications((prev) => prev.map((m, i) => i === index ? { ...m, [field]: value } : m))
  }

  function removeMedication(index: number) {
    setMedications((prev) => prev.filter((_, i) => i !== index))
  }

  function addFollowUp() {
    setFollowUps((prev) => [
      ...prev,
      { id: crypto.randomUUID(), summary_id: summary.id, hospital_id: summary.hospital_id, specialty: '', deadline: null, instructions: null, created_at: '' },
    ])
  }

  function updateFollowUp(index: number, field: keyof FollowUpRequirement, value: string | null) {
    setFollowUps((prev) => prev.map((f, i) => i === index ? { ...f, [field]: value } : f))
  }

  function removeFollowUp(index: number) {
    setFollowUps((prev) => prev.filter((_, i) => i !== index))
  }

  function updateListItem(list: string[], setList: (v: string[]) => void, index: number, value: string) {
    setList(list.map((item, i) => i === index ? value : item))
  }

  function removeListItem(list: string[], setList: (v: string[]) => void, index: number) {
    setList(list.filter((_, i) => i !== index))
  }

  const isApproved = summaryStatus === 'approved' || summaryStatus === 'sent'
  const isSent = summaryStatus === 'sent'

  return (
    <div className="space-y-6">
      {isSent && (
        <div className="flex items-center gap-2 p-3 bg-info-soft border border-info/30 rounded-lg text-sm text-info">
          <Send className="w-4 h-4" />
          Discharge instructions have been sent to the patient via WhatsApp.
        </div>
      )}
      {isApproved && !isSent && (
        <div className="flex items-center gap-2 p-3 bg-success-soft border border-success/30 rounded-lg text-sm text-success">
          <CheckCircle className="w-4 h-4" />
          Summary approved — click &quot;Send to Patient&quot; to deliver instructions via WhatsApp.
        </div>
      )}

      {/* Medications */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle className="text-base">Medications</CardTitle>
          <Button size="sm" variant="outline" onClick={addMedication}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {medications.length === 0 && (
            <p className="text-sm text-muted-foreground">No medications extracted. Add them manually.</p>
          )}
          {medications.map((med, i) => (
            <div key={med.id} className="grid grid-cols-12 gap-2 items-start p-3 bg-muted/30 rounded-lg">
              <div className="col-span-3">
                <Label className="text-xs mb-1 block">Medication name</Label>
                <Input value={med.name} onChange={(e) => updateMedication(i, 'name', e.target.value)} placeholder="e.g. Metformin" className="h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs mb-1 block">Dosage</Label>
                <Input value={med.dosage} onChange={(e) => updateMedication(i, 'dosage', e.target.value)} placeholder="500mg" className="h-8 text-sm" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs mb-1 block">Frequency</Label>
                <Input value={med.frequency} onChange={(e) => updateMedication(i, 'frequency', e.target.value)} placeholder="Twice daily" className="h-8 text-sm" />
              </div>
              <div className="col-span-4">
                <Label className="text-xs mb-1 block">Instructions</Label>
                <Input value={med.instructions ?? ''} onChange={(e) => updateMedication(i, 'instructions', e.target.value)} placeholder="Take with food" className="h-8 text-sm" />
              </div>
              <div className="col-span-1 pt-5">
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => removeMedication(i)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Follow-up Requirements */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle className="text-base">Follow-up Appointments</CardTitle>
          <Button size="sm" variant="outline" onClick={addFollowUp}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {followUps.length === 0 && (
            <p className="text-sm text-muted-foreground">No follow-up requirements extracted.</p>
          )}
          {followUps.map((fu, i) => (
            <div key={fu.id} className="grid grid-cols-12 gap-2 items-start p-3 bg-muted/30 rounded-lg">
              <div className="col-span-4">
                <Label className="text-xs mb-1 block">Specialty</Label>
                <Input value={fu.specialty} onChange={(e) => updateFollowUp(i, 'specialty', e.target.value)} placeholder="Cardiology" className="h-8 text-sm" />
              </div>
              <div className="col-span-3">
                <Label className="text-xs mb-1 block">Deadline</Label>
                <Input type="date" value={fu.deadline ?? ''} onChange={(e) => updateFollowUp(i, 'deadline', e.target.value || null)} className="h-8 text-sm" />
              </div>
              <div className="col-span-4">
                <Label className="text-xs mb-1 block">Instructions</Label>
                <Input value={fu.instructions ?? ''} onChange={(e) => updateFollowUp(i, 'instructions', e.target.value || null)} placeholder="Optional notes" className="h-8 text-sm" />
              </div>
              <div className="col-span-1 pt-5">
                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => removeFollowUp(i)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Emergency Symptoms */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle className="text-base flex items-center gap-2">
            Emergency Warning Signs
            <Badge variant="destructive" className="text-xs font-normal">Important</Badge>
          </CardTitle>
          <Button size="sm" variant="outline" onClick={() => setEmergencySymptoms((p) => [...p, ''])}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {emergencySymptoms.length === 0 && (
            <p className="text-sm text-muted-foreground">No emergency symptoms extracted. Add them manually.</p>
          )}
          {emergencySymptoms.map((s, i) => (
            <div key={i} className="flex gap-2">
              <Input value={s} onChange={(e) => updateListItem(emergencySymptoms, setEmergencySymptoms, i, e.target.value)} placeholder="e.g. Severe chest pain" className="h-8 text-sm" />
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-destructive hover:text-destructive" onClick={() => removeListItem(emergencySymptoms, setEmergencySymptoms, i)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Lifestyle + Restrictions + Activities */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Lifestyle Instructions', items: lifestyleInstructions, setItems: setLifestyleInstructions, placeholder: 'e.g. Rest for 2 weeks' },
          { label: 'Restrictions', items: restrictions, setItems: setRestrictions, placeholder: 'e.g. No driving' },
          { label: 'Recommended Activities', items: activities, setItems: setActivities, placeholder: 'e.g. Short daily walks' },
        ].map(({ label, items, setItems, placeholder }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between py-4">
              <CardTitle className="text-sm">{label}</CardTitle>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setItems((p) => [...p, ''])}>
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input value={item} onChange={(e) => updateListItem(items, setItems, i, e.target.value)} placeholder={placeholder} className="h-7 text-xs" />
                  <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" onClick={() => removeListItem(items, setItems, i)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
              {items.length === 0 && <p className="text-xs text-muted-foreground">None extracted</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Nurse Notes */}
      <Card>
        <CardHeader className="py-4">
          <CardTitle className="text-base">Nurse Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={nurseNotes}
            onChange={(e) => setNurseNotes(e.target.value)}
            placeholder="Add any additional notes or context for this patient…"
            rows={3}
          />
        </CardContent>
      </Card>

      <Separator />

      {/* Action buttons */}
      <div className="flex gap-3 justify-end pb-4">
        {!isSent && (
          <Button variant="outline" onClick={handleSave} disabled={saving || approving || sending}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Save changes
          </Button>
        )}
        {!isApproved && (
          <Button
            onClick={handleApprove}
            disabled={saving || approving || sending}
            style={{ backgroundColor: 'var(--brand)' }}
          >
            {approving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
            Approve summary
          </Button>
        )}
        {isApproved && !isSent && (
          <Button
            onClick={handleSendToPatient}
            disabled={sending}
            className="bg-success hover:bg-success/90 text-white"
          >
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Send to Patient via WhatsApp
          </Button>
        )}
      </div>
    </div>
  )
}
