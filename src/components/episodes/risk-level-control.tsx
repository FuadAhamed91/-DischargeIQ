'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RiskBadge } from '@/components/shared/risk-badge'
import { isLowering } from '@/lib/episodes/risk'
import { cn } from '@/lib/utils'
import type { RiskLevel } from '@/types/enums'

const LEVELS: Array<{ level: RiskLevel; hint: string; picked: string }> = [
  { level: 'green', hint: 'Doing well — nothing to follow up', picked: 'border-success/40 bg-success-soft' },
  { level: 'yellow', hint: 'A nurse should keep an eye on them', picked: 'border-warning/40 bg-warning-soft' },
  { level: 'red', hint: 'Needs urgent attention', picked: 'border-danger/40 bg-danger-soft' },
]

interface RiskLevelControlProps {
  episodeId: string
  level: RiskLevel
  /** Clinical role on an open episode. */
  canChange: boolean
}

/**
 * The patient's colour, and — for a nurse — the way to change it. Reports
 * raise it on their own; lowering it takes a note, which goes on the timeline
 * with the nurse's name.
 */
export function RiskLevelControl({ episodeId, level, canChange }: RiskLevelControlProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<RiskLevel>(level)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const lowering = isLowering(level, choice)
  const noteMissing = lowering && note.trim().length < 3

  function start() {
    setChoice(level)
    setNote('')
    setOpen(true)
  }

  async function save() {
    if (choice === level || noteMissing || saving) return
    setSaving(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/risk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: choice, from: level, note: note.trim() }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string; code?: string }
      if (!res.ok) {
        if (json.code === 'risk_changed_meanwhile') router.refresh()
        throw new Error(json.message ? `${json.error}: ${json.message}` : (json.error ?? 'Could not change the risk level'))
      }
      toast.success(lowering ? 'Risk level lowered — noted on the timeline' : 'Risk level changed')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the risk level')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <RiskBadge level={level} />
      {canChange && (
        <Button type="button" variant="ghost" size="sm" onClick={start} className="h-6 px-1.5 text-xs">
          Change
        </Button>
      )}
      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change risk level</DialogTitle>
            <DialogDescription>
              Triage results, emergency words and reported symptoms raise it on their own. Only a nurse lowers it — a new report can raise it again.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-2">
            <legend className="sr-only">Risk level</legend>
            {LEVELS.map((o) => (
              <label
                key={o.level}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
                  choice === o.level ? o.picked : 'hover:bg-muted',
                )}
              >
                <input
                  type="radio"
                  name={`risk-level-${episodeId}`}
                  value={o.level}
                  checked={choice === o.level}
                  onChange={() => setChoice(o.level)}
                  disabled={saving}
                  className="accent-brand"
                />
                <RiskBadge level={o.level} />
                <span className="text-xs text-muted-foreground">
                  {o.hint}{o.level === level ? ' (now)' : ''}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="grid gap-1.5">
            <Label htmlFor={`risk-note-${episodeId}`}>{lowering ? 'Why is it lower? (required)' : 'Note (optional)'}</Label>
            <Textarea
              id={`risk-note-${episodeId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={saving}
              placeholder={lowering ? 'e.g. Called the patient — the chest pain has settled, no warning signs.' : 'e.g. Family reports he is more confused today.'}
            />
            <p className="text-xs text-muted-foreground">Saved on the timeline with your name.</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button type="button" onClick={save} disabled={saving || choice === level || noteMissing} aria-busy={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
