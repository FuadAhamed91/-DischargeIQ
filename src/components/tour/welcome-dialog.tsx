'use client'

import { ArrowRight, ClipboardCheck, FileText, HeartPulse, MessageCircle, RotateCcw, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { siteConfig } from '@/config/site'

const JOURNEY = [
  { icon: FileText, title: 'Drop in a discharge letter', text: 'AI reads the PDF: medicines, follow-ups, warning signs.' },
  { icon: ClipboardCheck, title: 'Approve the care plan', text: 'It goes to the patient on WhatsApp, in their language.' },
  { icon: MessageCircle, title: 'Be the patient', text: 'Reply on your own WhatsApp, or right on the page, and watch the AI answer or alert a nurse.' },
]

/**
 * The first thing a visitor sees: what CareLoop is for, and a guided
 * two-minute tour through it. Opens by itself once per browser, and from the
 * Tour button at the top at any time (where it also resumes a tour left half-way).
 */
export function WelcomeDialog({ open, inProgress, onStart, onResume, onDismiss, onClose }: {
  open: boolean
  /** A tour was left half-way: offer to carry on. */
  inProgress: boolean
  onStart: () => void
  onResume: () => void
  /** "I'll explore on my own" (or, with a tour under way, "End the tour"). */
  onDismiss: () => void
  /** Esc or a click outside: just close it. */
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        {/* The brand band */}
        <div className="relative overflow-hidden bg-brand px-6 pb-6 pt-7 text-brand-foreground">
          <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 right-16 h-40 w-40 rounded-full bg-white/5" />
          <div className="relative flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25" aria-hidden="true">
              <HeartPulse className="h-5 w-5" />
            </span>
            <span className="text-sm font-semibold tracking-tight">{siteConfig.name}</span>
          </div>
          <DialogTitle className="relative mt-5 text-2xl font-semibold leading-tight tracking-tight text-brand-foreground">
            Send a patient home, and know the moment they need you
          </DialogTitle>
          <DialogDescription className="relative mt-2 text-sm leading-relaxed text-brand-foreground/85">
            Patients leave hospital with a letter they rarely read. {siteConfig.name} turns it into a care plan on WhatsApp,
            in their language, and tells nurses who needs help before it becomes a readmission.
          </DialogDescription>
        </div>

        {/* The journey the tour walks through */}
        <div className="px-6 py-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">In the 2-minute tour you will</p>
          <ol className="mt-3 space-y-3">
            {JOURNEY.map((step, i) => (
              <li key={step.title} className="flex animate-tour-rise items-start gap-3" style={{ animationDelay: `${120 + i * 110}ms` }}>
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
                  <step.icon className="h-4 w-4" aria-hidden="true" />
                  <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-brand-foreground tnum" aria-hidden="true">
                    {i + 1}
                  </span>
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="block text-sm font-medium">{step.title}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" aria-hidden="true" />
            Keep your phone handy: scan one code and the care plan comes to your own WhatsApp. Or use our test phone. The patients are fictional, so click anything you like.
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t bg-muted/30 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <Button type="button" variant="ghost" onClick={onDismiss} className="text-muted-foreground">
            {inProgress ? 'End the tour' : 'I’ll explore on my own'}
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {inProgress && (
              <Button type="button" variant="outline" onClick={onStart}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Start over
              </Button>
            )}
            <Button type="button" size="lg" onClick={inProgress ? onResume : onStart} className="h-10 px-4" autoFocus>
              {inProgress ? 'Resume the tour' : 'Start the tour'} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
