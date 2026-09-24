'use client'

import { Download, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SAMPLE_LETTERS, sampleLetterFileName } from '@/lib/intake/sample-letters'

/** What a sample tile carries when dragged: dropped on the letter box, that letter is read. */
export const SAMPLE_LETTER_DRAG_TYPE = 'application/x-dischargeiq-sample-letter'

const letterUrl = (id: string, download = false) => `/api/v1/intake/sample-letters/${id}${download ? '?download=1' : ''}`

/** A sample letter as a file, printed with today's dates, ready for the same reading as an upload. */
export async function fetchSampleLetter(id: string): Promise<File> {
  const letter = SAMPLE_LETTERS.find((l) => l.id === id)
  if (!letter) throw new Error('No such sample letter')
  const res = await fetch(letterUrl(id), { cache: 'no-store' })
  if (!res.ok) throw new Error('Could not load the sample letter')
  return new File([await res.blob()], sampleLetterFileName(letter), { type: 'application/pdf' })
}

/**
 * Fictional patients' discharge letters under the drop box, for a demo:
 * click one, or drag it into the box, and it is read like an uploaded PDF.
 * Dragged out of the browser (Chrome), a tile saves as a PDF file.
 */
export function SampleLetterTiles({ onUse, disabled }: { onUse: (id: string) => void; disabled?: boolean }) {
  return (
    <section aria-labelledby="sample-letters" className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <h2 id="sample-letters" className="text-xs font-medium text-muted-foreground">or try a sample letter</h2>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {SAMPLE_LETTERS.map((letter) => {
          const name = letter.patient.full_name
          return (
            <li key={letter.id} className="relative">
              <button
                type="button"
                draggable={!disabled}
                disabled={disabled}
                onClick={() => onUse(letter.id)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy'
                  e.dataTransfer.setData(SAMPLE_LETTER_DRAG_TYPE, letter.id)
                  e.dataTransfer.setData('DownloadURL', `application/pdf:${sampleLetterFileName(letter)}:${new URL(letterUrl(letter.id), window.location.origin)}`)
                }}
                aria-label={`Use the sample letter for ${name}: ${letter.headline}`}
                className={cn(
                  'flex h-full w-full items-center gap-3 rounded-lg border bg-background p-3 pr-10 text-left transition-colors duration-150',
                  'hover:border-brand/50 hover:bg-brand-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  'cursor-grab active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-60',
                )}
              >
                <span className="flex h-10 w-9 shrink-0 flex-col items-center justify-center rounded-md bg-danger-soft text-danger" aria-hidden="true">
                  <FileText className="h-4 w-4" />
                  <span className="mt-0.5 text-[8px] font-bold leading-none tracking-wide">PDF</span>
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-snug">{name}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{letter.headline}</span>
                </span>
              </button>
              <a
                href={letterUrl(letter.id, true)}
                download={sampleLetterFileName(letter)}
                className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title="Download the PDF"
                aria-label={`Download ${name}’s letter`}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
              </a>
            </li>
          )
        })}
      </ul>
      <p className="text-xs text-muted-foreground">
        Click one, or drag it into the box. Fictional patients, discharged today.
      </p>
    </section>
  )
}
