'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { ExternalLink, QrCode } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { formatPhone } from '@/lib/format'
import { SANDBOX_JOIN_LINK, SANDBOX_JOIN_MESSAGE, SANDBOX_NUMBER, SANDBOX_QR } from '@/lib/whatsapp/sandbox'

const QUIET = 4 // the blank border a camera needs around the code, in modules
const SIZE = SANDBOX_QR.length + QUIET * 2
// Every dark module in one path, a run at a time along each row.
const QR_PATH = SANDBOX_QR.map((row, y) => {
  let d = ''
  for (let x = 0; x < row.length;) {
    if (row[x] !== '1') { x++; continue }
    let end = x
    while (end < row.length && row[end] === '1') end++
    d += `M${x + QUIET} ${y + QUIET}h${end - x}v1h${x - end}z`
    x = end
  }
  return d
}).join('')

/** Twilio's sandbox QR code. Always dark on white, whatever the theme, so every camera reads it. */
export function SandboxQr({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`QR code: opens WhatsApp to send “${SANDBOX_JOIN_MESSAGE}” to ${formatPhone(SANDBOX_NUMBER)}`}
      shapeRendering="crispEdges"
      className={cn('shrink-0 rounded-lg bg-white', className)}
    >
      <rect width={SIZE} height={SIZE} fill="#ffffff" />
      <path d={QR_PATH} fill="#0b1220" />
    </svg>
  )
}

/** Opens WhatsApp with the join message typed: the way in on the phone itself, where there is nothing to scan. */
export function OpenWhatsAppLink({ className }: { className?: string }) {
  return (
    <a
      href={SANDBOX_JOIN_LINK}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5', className)}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open WhatsApp
    </a>
  )
}

/** What to do with the code, and after it. `last` is the final step where it's read (default: add yourself as a patient). */
export function SandboxJoinSteps({ last, className }: { last?: ReactNode; className?: string }) {
  const steps: ReactNode[] = [
    <>Scan the code with your phone’s camera. On the phone itself, tap <b className="font-semibold text-foreground">Open WhatsApp</b>.</>,
    <>WhatsApp opens with <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] text-foreground">{SANDBOX_JOIN_MESSAGE}</code> already typed. Just send it.</>,
    <>Wait a few seconds for the reply saying you’re all set.</>,
    last ?? <>Add a patient with your own number: the care plan, the check-ins and the answers come to your WhatsApp. Reply like a patient would.</>,
  ]
  return (
    <ol className={cn('space-y-2', className)}>
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-2.5 text-sm leading-snug text-muted-foreground">
          <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-brand-foreground tnum" aria-hidden="true">
            {i + 1}
          </span>
          <span className="min-w-0">{step}</span>
        </li>
      ))}
    </ol>
  )
}

/** The code at full size, with the steps: from the sidebar, or from the smaller code on Add patient. */
export function SandboxJoinDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold leading-snug">Get the WhatsApp messages on your phone</DialogTitle>
          <DialogDescription>
            Join our WhatsApp test line once. Then add yourself as a patient and everything CareLoop sends comes to you.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
          <SandboxQr className="h-44 w-44 ring-1 ring-border" />
          <SandboxJoinSteps />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
          <span>
            WhatsApp <span className="font-medium text-foreground tnum">{formatPhone(SANDBOX_NUMBER)}</span>
          </span>
          <OpenWhatsAppLink />
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** A button that opens the code at full size. */
export function SandboxJoinButton({ className, children }: { className?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
      >
        {children ?? <><QrCode className="h-3.5 w-3.5" aria-hidden="true" /> Try it on your phone</>}
      </button>
      <SandboxJoinDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** On Add patient, under the number: the code at a glance, so a visitor can join before typing their number. */
export function SandboxJoinPanel({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-tour="sandbox-panel" className={cn('flex gap-4 rounded-lg border border-dashed border-brand/40 bg-brand-tint p-3.5', className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show the QR code bigger"
        className="h-fit shrink-0 rounded-lg ring-1 ring-border transition-shadow hover:ring-2 hover:ring-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SandboxQr className="h-24 w-24 sm:h-28 sm:w-28" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">Want the messages on your own phone?</p>
        <SandboxJoinSteps className="mt-2" last={<>Type your number above, starting with + and the country code.</>} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <OpenWhatsAppLink />
          <button type="button" onClick={() => setOpen(true)} className="rounded-md px-2 py-1 text-xs font-medium text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Show the code bigger
          </button>
        </div>
      </div>
      <SandboxJoinDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
