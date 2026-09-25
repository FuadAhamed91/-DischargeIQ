'use client'

import { Download, FileText, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SAMPLE_LETTERS, sampleLetterAge, sampleLetterFileName } from '@/lib/intake/sample-letters'

/** What a demo letter carries when dragged: dropped on the letter box, that letter is read. */
export const SAMPLE_LETTER_DRAG_TYPE = 'application/x-careloop-sample-letter'

const letterUrl = (id: string, download = false) => `/api/v1/intake/sample-letters/${id}${download ? '?download=1' : ''}`

/** The letters are printed with today as the discharge day; ages are counted to it. */
const TODAY = new Date().toISOString().slice(0, 10)

/** A demo letter as a file, printed with today's dates, ready for the same reading as an upload. */
export async function fetchSampleLetter(id: string): Promise<File> {
  const letter = SAMPLE_LETTERS.find((l) => l.id === id)
  if (!letter) throw new Error('No such demo letter')
  const res = await fetch(letterUrl(id), { cache: 'no-store' })
  if (!res.ok) throw new Error('Could not load the demo letter')
  return new File([await res.blob()], sampleLetterFileName(letter), { type: 'application/pdf' })
}

/**
 * Beside the letter box: three fictional patients' discharge letters, as PDF
 * files to drag into the box (a click works too, for touch screens). Each is
 * read like an uploaded PDF. Dragged out of the browser (Chrome), a letter
 * saves as a file; the download button does the same.
 */
export function SampleLetterPanel({
  onUse, onDragChange, disabled,
}: {
  onUse: (id: string) => void
  /** True while a letter is being dragged, so the box can say where to drop it. */
  onDragChange?: (dragging: boolean) => void
  disabled?: boolean
}) {
  return (
    <aside aria-labelledby="demo-letters" className="rounded-lg bg-card p-4 ring-1 ring-border">
      <h2 id="demo-letters" className="text-sm font-semibold">Demo discharge letters</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Drag one into the box. Fictional patients, discharged today.</p>
      <ul className="mt-3 space-y-2">
        {SAMPLE_LETTERS.map((letter) => {
          const p = letter.patient
          return (
            <li key={letter.id} className="relative">
              <button
                type="button"
                data-tour={`sample-letter-${letter.id}`}
                draggable={!disabled}
                disabled={disabled}
                onClick={() => onUse(letter.id)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy'
                  e.dataTransfer.setData(SAMPLE_LETTER_DRAG_TYPE, letter.id)
                  e.dataTransfer.setData('DownloadURL', `application/pdf:${sampleLetterFileName(letter)}:${new URL(letterUrl(letter.id), window.location.origin)}`)
                  onDragChange?.(true)
                }}
                onDragEnd={() => onDragChange?.(false)}
                aria-label={`Demo letter for ${p.full_name}, ${letter.headline}. Drag it into the box, or press to use it.`}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border bg-background py-3 pl-1.5 pr-10 text-left transition-colors duration-150',
                  'hover:border-brand/50 hover:bg-brand-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'cursor-grab active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                <span className="flex h-11 w-9 shrink-0 flex-col items-center justify-center rounded-md bg-danger-soft text-danger" aria-hidden="true">
                  <FileText className="h-4 w-4" />
                  <span className="mt-0.5 text-[8px] font-bold leading-none tracking-wide">PDF</span>
                </span>
                <span className="min-w-0 pl-1">
                  <span className="block text-sm font-medium leading-snug">{p.full_name}</span>
                  <span className="block text-xs leading-snug text-muted-foreground">
                    {sampleLetterAge(letter, TODAY)} · {p.gender === 'female' ? 'Female' : 'Male'} · {letter.department}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-foreground/80">{letter.headline}</span>
                </span>
              </button>
              <a
                href={letterUrl(letter.id, true)}
                download={sampleLetterFileName(letter)}
                className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Download the PDF"
                aria-label={`Download ${p.full_name}’s letter`}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </a>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
