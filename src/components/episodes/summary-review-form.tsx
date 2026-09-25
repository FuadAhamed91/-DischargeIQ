'use client'

import { useEffect, useState } from 'react'
import type { Dispatch, ElementType, ReactNode, SetStateAction } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CalendarDays, ListChecks, Loader2, NotebookPen, Pill, Plus, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CARE_PLAN_MESSAGE_INSTRUCTIONS, CARE_PLAN_MESSAGE_WARNINGS } from '@/lib/whatsapp/care-plan-limits'
import { cn } from '@/lib/utils'
import { signalTour } from '@/lib/tour/signals'
import type { FollowUpRequirement, Medication } from '@/types/database'
import type { SummaryStatus } from '@/types/enums'

/** The care plan as the review page loads it. */
export interface ReviewSummary {
  status: SummaryStatus
  nurse_notes: string | null
  emergency_symptoms: string[]
  lifestyle_instructions: string[]
  restrictions: string[]
  activities: string[]
  medications: Array<Pick<Medication, 'id' | 'name' | 'dosage' | 'frequency' | 'instructions' | 'reminder_times' | 'sort_order'>>
  follow_up_requirements: Array<Pick<FollowUpRequirement, 'id' | 'specialty' | 'deadline' | 'instructions'>>
}

interface SummaryReviewFormProps {
  episodeId: string
  summary: ReviewSummary
  /** Who receives the care plan: named in the confirmation before it is sent. */
  patient: { name: string; phone: string; languageName: string }
  /** Hospital-local time of the nightly check-in, "HH:MM". */
  checkinTime: string
}

interface MedicineRow { key: string; name: string; dosage: string; frequency: string; instructions: string; reminder_times: string[] }
interface VisitRow { key: string; specialty: string; deadline: string; instructions: string }
interface LineRow { key: string; text: string }
type Rows<T> = Dispatch<SetStateAction<T[]>>

/** What a save sends: blank rows dropped, text trimmed. */
interface Plan {
  medicines: MedicineRow[]
  visits: VisitRow[]
  warnings: LineRow[]
  activity: LineRow[]
  avoid: LineRow[]
  lifestyle: LineRow[]
}

const toLines = (items: string[], prefix: string): LineRow[] => items.map((text, i) => ({ key: `${prefix}-${i}`, text }))
const hasText = (...values: string[]) => values.some((v) => v.trim() !== '')
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback)

// From `sm` up a medicine or follow-up is one row under column headings; below it, a small card.
const MEDICINE_COLUMNS = 'sm:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,1.1fr)_minmax(0,1.8fr)_2.25rem]'
const VISIT_COLUMNS = 'sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.8fr)_2.25rem]'
const FIELD = 'h-10 sm:h-9'

/**
 * The care plan read from the discharge letter, for a nurse to correct and
 * send. One main action — Approve and send — saves, approves and sends in a
 * single step after a confirmation that says exactly who gets what.
 */
export function SummaryReviewForm({ episodeId, summary, patient, checkinTime }: SummaryReviewFormProps) {
  const router = useRouter()
  const firstName = patient.name.split(' ')[0]

  const [medicines, setMedicines] = useState<MedicineRow[]>(() =>
    [...summary.medications]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({ key: m.id, name: m.name, dosage: m.dosage, frequency: m.frequency, instructions: m.instructions ?? '', reminder_times: m.reminder_times ?? [] })))
  const [visits, setVisits] = useState<VisitRow[]>(() =>
    summary.follow_up_requirements.map((f) => ({ key: f.id, specialty: f.specialty, deadline: f.deadline ?? '', instructions: f.instructions ?? '' })))
  const [warnings, setWarnings] = useState(() => toLines(summary.emergency_symptoms, 'warning'))
  const [activity, setActivity] = useState(() => toLines(summary.activities, 'activity'))
  const [avoid, setAvoid] = useState(() => toLines(summary.restrictions, 'avoid'))
  const [lifestyle, setLifestyle] = useState(() => toLines(summary.lifestyle_instructions, 'lifestyle'))
  const [nurseNotes, setNurseNotes] = useState(summary.nurse_notes ?? '')
  const [status, setStatus] = useState(summary.status)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<'save' | 'send' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})
  // The row just added gets the cursor.
  const [newRow, setNewRow] = useState<string | null>(null)

  // Reloading or closing the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function clearError(key: string) {
    setRowErrors((errors) => {
      if (!(key in errors)) return errors
      const rest = { ...errors }
      delete rest[key]
      return rest
    })
  }

  function editRow<T extends { key: string }>(set: Rows<T>, key: string, patch: Partial<T>) {
    set((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setDirty(true)
    clearError(key)
  }

  function addRow<T extends { key: string }>(set: Rows<T>, row: Omit<T, 'key'>) {
    const key = crypto.randomUUID()
    set((rows) => [...rows, { ...row, key } as T])
    setNewRow(key)
    setDirty(true)
  }

  function removeRow<T extends { key: string }>(set: Rows<T>, key: string) {
    set((rows) => rows.filter((r) => r.key !== key))
    setDirty(true)
    clearError(key)
  }

  /** The plan as it would be saved, or null (with the rows flagged) when a row has text but no name. */
  function readyPlan(): Plan | null {
    const trimmed = (rows: LineRow[]) => rows.filter((r) => hasText(r.text)).map((r) => ({ ...r, text: r.text.trim() }))
    const plan: Plan = {
      medicines: medicines.filter((m) => hasText(m.name, m.dosage, m.frequency, m.instructions)),
      visits: visits.filter((v) => hasText(v.specialty, v.deadline, v.instructions)),
      warnings: trimmed(warnings),
      activity: trimmed(activity),
      avoid: trimmed(avoid),
      lifestyle: trimmed(lifestyle),
    }
    const errors: Record<string, string> = {}
    for (const m of plan.medicines) if (!m.name.trim()) errors[m.key] = 'Add the medicine’s name, or remove this row.'
    for (const v of plan.visits) if (!v.specialty.trim()) errors[v.key] = 'Add the clinic, or remove this row.'
    setRowErrors(errors)
    if (Object.keys(errors).length > 0) {
      toast.error('A row is missing its name. Fill it in or remove the row.')
      return null
    }
    return plan
  }

  async function save(plan: Plan) {
    const res = await fetch(`/api/v1/episodes/${episodeId}/summary`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        medications: plan.medicines.map((m, i) => ({
          name: m.name.trim(),
          dosage: m.dosage.trim(),
          frequency: m.frequency.trim(),
          instructions: m.instructions.trim() || null,
          reminder_times: m.reminder_times,
          sort_order: i,
        })),
        follow_up_requirements: plan.visits.map((v) => ({
          specialty: v.specialty.trim(),
          deadline: v.deadline || null,
          instructions: v.instructions.trim() || null,
        })),
        emergency_symptoms: plan.warnings.map((r) => r.text),
        activities: plan.activity.map((r) => r.text),
        restrictions: plan.avoid.map((r) => r.text),
        lifestyle_instructions: plan.lifestyle.map((r) => r.text),
        nurse_notes: nurseNotes.trim() || null,
      }),
    })
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(json.error ?? 'Could not save the care plan')
    }
    // The form now shows exactly what was saved: blank rows are gone.
    setMedicines(plan.medicines)
    setVisits(plan.visits)
    setWarnings(plan.warnings)
    setActivity(plan.activity)
    setAvoid(plan.avoid)
    setLifestyle(plan.lifestyle)
    setDirty(false)
    setStatus('pending_review')
  }

  async function saveDraft() {
    const plan = readyPlan()
    if (!plan) return
    setBusy('save')
    try {
      await save(plan)
      toast.success('Saved. Nothing has been sent to the patient.')
      router.refresh()
    } catch (err) {
      toast.error(errorText(err, 'Could not save the care plan'))
    } finally {
      setBusy(null)
    }
  }

  function askToSend() {
    const plan = readyPlan()
    if (!plan) return
    const lines = plan.medicines.length + plan.warnings.length + plan.activity.length + plan.avoid.length + plan.lifestyle.length
    if (lines === 0) {
      toast.error('Add at least one medicine, warning sign or instruction before sending.')
      return
    }
    setConfirming(true)
    signalTour('careplan:confirm')
  }

  async function approveAndSend() {
    const plan = readyPlan()
    if (!plan) {
      setConfirming(false)
      return
    }
    setBusy('send')
    try {
      // Edits are saved and approved first; an approved plan nobody has touched goes straight out.
      if (dirty || status !== 'approved') {
        await save(plan)
        const approved = await fetch(`/api/v1/episodes/${episodeId}/summary/approve`, { method: 'POST' })
        const json = (await approved.json().catch(() => ({}))) as { error?: string }
        if (!approved.ok) throw new Error(json.error ?? 'Could not approve the care plan')
        setStatus('approved')
      }
      const sent = await fetch(`/api/v1/episodes/${episodeId}/summary/send`, { method: 'POST' })
      const json = (await sent.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!sent.ok) throw new Error(json.message ? `${json.error}: ${json.message}` : (json.error ?? 'Could not send the care plan'))
      setConfirming(false)
      toast.success(`Care plan sent to ${firstName} on WhatsApp`)
      signalTour('careplan:sent')
      router.push(`/episodes/${episodeId}`)
      router.refresh()
    } catch (err) {
      setConfirming(false)
      setBusy(null)
      toast.error(errorText(err, 'Could not send the care plan'), { duration: 10_000 })
      signalTour('careplan:failed', errorText(err, 'Could not send the care plan'))
      router.refresh()
    }
  }

  const count = {
    medicines: medicines.filter((m) => hasText(m.name)).length,
    warnings: warnings.filter((r) => hasText(r.text)).length,
    visits: visits.filter((v) => hasText(v.specialty)).length,
    instructions: [activity, avoid, lifestyle].reduce((n, rows) => n + rows.filter((r) => hasText(r.text)).length, 0),
  }
  const statusLine = dirty ? 'Unsaved changes'
    : status === 'approved' ? 'Approved, not sent yet'
      : 'Nothing has been sent to the patient yet'
  const sendLabel = status === 'approved' && !dirty ? `Send to ${firstName}` : 'Approve and send'

  const instructionGroups = [
    { title: 'Activity', rows: activity, set: setActivity, placeholder: 'e.g. Walk for 10 minutes twice a day', add: 'Add activity' },
    { title: 'Avoid', rows: avoid, set: setAvoid, placeholder: 'e.g. No driving for 2 weeks', add: 'Add something to avoid' },
    { title: 'Lifestyle', rows: lifestyle, set: setLifestyle, placeholder: 'e.g. Eat less salt', add: 'Add lifestyle advice' },
  ]

  return (
    <div className="space-y-4">
      <Section icon={Pill} title="Medicines" count={count.medicines} tourId="review-medicines">
        {medicines.length === 0 ? (
          <Empty>No medicines were found in the letter.</Empty>
        ) : (
          <>
            <div aria-hidden="true" className={cn('mb-1.5 hidden gap-2 text-xs font-medium text-muted-foreground sm:grid', MEDICINE_COLUMNS)}>
              <span>Medicine</span><span>Dose</span><span>How often</span><span>How to take it</span>
            </div>
            <ul className="space-y-3 sm:space-y-2">
              {medicines.map((m) => {
                const id = `medicine-${m.key}`
                const error = rowErrors[m.key]
                return (
                  <li key={m.key} className="relative rounded-lg border p-3 sm:rounded-none sm:border-0 sm:p-0">
                    <div className={cn('grid grid-cols-2 gap-2', MEDICINE_COLUMNS)}>
                      <RowField id={`${id}-name`} label="Medicine" className="col-span-2 pr-11 sm:col-span-1 sm:pr-0">
                        <Input
                          id={`${id}-name`}
                          value={m.name}
                          onChange={(e) => editRow(setMedicines, m.key, { name: e.target.value })}
                          placeholder="e.g. Aspirin"
                          autoFocus={newRow === m.key}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? `${id}-error` : undefined}
                          className={FIELD}
                        />
                      </RowField>
                      <RowField id={`${id}-dose`} label="Dose">
                        <Input id={`${id}-dose`} value={m.dosage} onChange={(e) => editRow(setMedicines, m.key, { dosage: e.target.value })} placeholder="e.g. 75 mg" className={FIELD} />
                      </RowField>
                      <RowField id={`${id}-often`} label="How often">
                        <Input id={`${id}-often`} value={m.frequency} onChange={(e) => editRow(setMedicines, m.key, { frequency: e.target.value })} placeholder="e.g. Once a day" className={FIELD} />
                      </RowField>
                      <RowField id={`${id}-how`} label="How to take it" className="col-span-2 sm:col-span-1">
                        <Input id={`${id}-how`} value={m.instructions} onChange={(e) => editRow(setMedicines, m.key, { instructions: e.target.value })} placeholder="e.g. After food" className={FIELD} />
                      </RowField>
                      <RemoveButton
                        label={`Remove ${m.name.trim() || 'this medicine'}`}
                        onClick={() => removeRow(setMedicines, m.key)}
                        className="absolute right-2 top-2 sm:static"
                      />
                    </div>
                    {error && <p id={`${id}-error`} className="mt-1.5 text-xs text-danger">{error}</p>}
                  </li>
                )
              })}
            </ul>
          </>
        )}
        <AddButton onClick={() => addRow(setMedicines, { name: '', dosage: '', frequency: '', instructions: '', reminder_times: [] })}>
          Add medicine
        </AddButton>
      </Section>

      <Section
        icon={AlertTriangle}
        iconClassName="text-danger"
        title="Warning signs: go to emergency"
        count={count.warnings}
        description={count.warnings > CARE_PLAN_MESSAGE_WARNINGS
          ? `Only the first ${CARE_PLAN_MESSAGE_WARNINGS} fit in the WhatsApp message. The assistant knows all of them if ${firstName} asks.`
          : undefined}
      >
        <LineList
          rows={warnings}
          label="Warning sign"
          placeholder="e.g. Chest pain that does not go away"
          empty="No warning signs were found in the letter."
          newRow={newRow}
          onEdit={(key, text) => editRow(setWarnings, key, { text })}
          onRemove={(key) => removeRow(setWarnings, key)}
          onEnter={() => addRow(setWarnings, { text: '' })}
        />
        <AddButton onClick={() => addRow(setWarnings, { text: '' })}>Add warning sign</AddButton>
      </Section>

      <Section
        icon={CalendarDays}
        title="Follow-up appointments"
        count={count.visits}
        description="Give each visit the date the letter asks for. It then shows on Appointments, ready to book."
      >
        {visits.length === 0 ? (
          <Empty>No follow-up appointments were found in the letter.</Empty>
        ) : (
          <>
            <div aria-hidden="true" className={cn('mb-1.5 hidden gap-2 text-xs font-medium text-muted-foreground sm:grid', VISIT_COLUMNS)}>
              <span>Clinic</span><span>By date</span><span>Note</span>
            </div>
            <ul className="space-y-3 sm:space-y-2">
              {visits.map((v) => {
                const id = `visit-${v.key}`
                const error = rowErrors[v.key]
                return (
                  <li key={v.key} className="relative rounded-lg border p-3 sm:rounded-none sm:border-0 sm:p-0">
                    <div className={cn('grid grid-cols-1 gap-2', VISIT_COLUMNS)}>
                      <RowField id={`${id}-clinic`} label="Clinic" className="pr-11 sm:pr-0">
                        <Input
                          id={`${id}-clinic`}
                          value={v.specialty}
                          onChange={(e) => editRow(setVisits, v.key, { specialty: e.target.value })}
                          placeholder="e.g. Cardiology"
                          autoFocus={newRow === v.key}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={error ? `${id}-error` : undefined}
                          className={FIELD}
                        />
                      </RowField>
                      <RowField id={`${id}-date`} label="By date">
                        <Input id={`${id}-date`} type="date" value={v.deadline} onChange={(e) => editRow(setVisits, v.key, { deadline: e.target.value })} className={FIELD} />
                      </RowField>
                      <RowField id={`${id}-note`} label="Note">
                        <Input id={`${id}-note`} value={v.instructions} onChange={(e) => editRow(setVisits, v.key, { instructions: e.target.value })} placeholder="e.g. Bring your blood test results" className={FIELD} />
                      </RowField>
                      <RemoveButton
                        label={`Remove ${v.specialty.trim() || 'this follow-up'}`}
                        onClick={() => removeRow(setVisits, v.key)}
                        className="absolute right-2 top-2 sm:static"
                      />
                    </div>
                    {error && <p id={`${id}-error`} className="mt-1.5 text-xs text-danger">{error}</p>}
                  </li>
                )
              })}
            </ul>
          </>
        )}
        <AddButton onClick={() => addRow(setVisits, { specialty: '', deadline: '', instructions: '' })}>Add follow-up</AddButton>
      </Section>

      <Section
        icon={ListChecks}
        title="Instructions"
        count={count.instructions}
        description={`The WhatsApp message includes the first ${CARE_PLAN_MESSAGE_INSTRUCTIONS} lifestyle lines. The assistant uses all of these to answer ${firstName}’s questions.`}
      >
        <div className="space-y-5">
          {instructionGroups.map((g) => (
            <div key={g.title}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.title}</h3>
              <LineList
                rows={g.rows}
                label={g.title}
                placeholder={g.placeholder}
                empty="None yet."
                newRow={newRow}
                onEdit={(key, text) => editRow(g.set, key, { text })}
                onRemove={(key) => removeRow(g.set, key)}
                onEnter={() => addRow(g.set, { text: '' })}
              />
              <AddButton onClick={() => addRow(g.set, { text: '' })}>{g.add}</AddButton>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={NotebookPen} title="Nurse notes" description="Only staff see these. They are not sent to the patient.">
        <Label htmlFor="nurse-notes" className="sr-only">Nurse notes</Label>
        <Textarea
          id="nurse-notes"
          value={nurseNotes}
          onChange={(e) => { setNurseNotes(e.target.value); setDirty(true) }}
          rows={3}
          placeholder="e.g. His daughter helps with his medicines."
        />
      </Section>

      {/* Always in reach while scrolling a long plan. */}
      <div className="sticky bottom-3 z-10 rounded-lg border bg-card p-3 shadow-lg md:bottom-4">
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="w-full text-xs text-muted-foreground sm:mr-auto sm:w-auto">{statusLine}</p>
          <Button type="button" variant="outline" className="h-10 flex-1 sm:flex-none" onClick={saveDraft} disabled={busy !== null || !dirty}>
            {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Save draft
          </Button>
          <Button type="button" className="h-10 flex-1 sm:flex-none" onClick={askToSend} disabled={busy !== null} data-tour="review-send">
            <Send className="h-4 w-4" aria-hidden="true" /> {sendLabel}
          </Button>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={(open) => { if (busy !== 'send') setConfirming(open) }}>
        <DialogContent data-tour="review-confirm">
          <DialogHeader>
            <DialogTitle>Send the care plan to {patient.name}?</DialogTitle>
            <DialogDescription>
              It goes to <span className="font-medium text-foreground tnum">{patient.phone}</span> on WhatsApp, in {patient.languageName}.
              After that, {firstName} gets a check-in message every evening at {checkinTime}.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid grid-cols-2 gap-2">
            <Tally label="Medicines" value={count.medicines} />
            <Tally label="Warning signs" value={count.warnings} />
            <Tally label="Follow-ups" value={count.visits} />
            <Tally label="Instructions" value={count.instructions} />
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={busy === 'send'}>Cancel</Button>
            <Button type="button" onClick={approveAndSend} disabled={busy === 'send'} aria-busy={busy === 'send'}>
              {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              {busy === 'send' ? 'Sending…' : 'Send care plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Section({ icon: Icon, iconClassName, title, count, description, tourId, children }: {
  icon: ElementType
  iconClassName?: string
  title: string
  count?: number
  description?: string
  /** What the guided tour calls it (components/tour). */
  tourId?: string
  children: ReactNode
}) {
  return (
    <Card data-tour={tourId}>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2 text-base font-medium">
            <Icon className={cn('h-4 w-4 text-muted-foreground', iconClassName)} aria-hidden="true" />
            {title}
            {count ? <span className="text-sm font-normal text-muted-foreground tnum">{count}</span> : null}
          </h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** A field in a medicine or follow-up row: labelled on a phone, under a column heading from `sm` up. */
function RowField({ id, label, className, children }: { id: string; label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('space-y-1 sm:space-y-0', className)}>
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground sm:sr-only">{label}</Label>
      {children}
    </div>
  )
}

function LineList({ rows, label, placeholder, empty, newRow, onEdit, onRemove, onEnter }: {
  rows: LineRow[]
  label: string
  placeholder: string
  empty: string
  newRow: string | null
  onEdit: (key: string, text: string) => void
  onRemove: (key: string) => void
  /** Enter starts the next line. */
  onEnter: () => void
}) {
  if (rows.length === 0) return <Empty>{empty}</Empty>
  return (
    <ul className="space-y-2">
      {rows.map((row, i) => (
        <li key={row.key} className="flex items-center gap-2">
          <Input
            value={row.text}
            onChange={(e) => onEdit(row.key, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                onEnter()
              }
            }}
            placeholder={placeholder}
            aria-label={`${label} ${i + 1}`}
            autoFocus={newRow === row.key}
            className={FIELD}
          />
          <RemoveButton label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onRemove(row.key)} />
        </li>
      ))}
    </ul>
  )
}

function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button type="button" variant="ghost" onClick={onClick} className="-ml-2 mt-2 h-9 text-brand hover:text-brand">
      <Plus className="h-4 w-4" aria-hidden="true" /> {children}
    </Button>
  )
}

function RemoveButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-lg"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn('shrink-0 text-muted-foreground hover:bg-danger-soft hover:text-danger', className)}
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
    </Button>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

function Tally({ label, value }: { label: string; value: number }) {
  return (
    <li className="rounded-md border px-3 py-2">
      <span className="block text-lg font-semibold leading-tight tnum">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </li>
  )
}
