'use client'

import { Sparkles } from 'lucide-react'
import { useTour } from './tour-provider'

/** In the header, always: opens the welcome, to start the tour again or resume it. */
export function TourButton() {
  const { enabled, running, completed, openWelcome } = useTour()
  if (!enabled) return null
  return (
    <button
      type="button"
      data-tour="tour-button"
      onClick={openWelcome}
      aria-label={running ? 'Guided tour, in progress' : 'Take the guided tour'}
      title={running ? 'Resume or restart the guided tour' : 'Take the guided tour'}
      className="relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-brand/30 bg-brand-tint px-2.5 text-sm font-medium text-brand transition-colors duration-200 hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">Tour</span>
      {/* Until the tour has been done once, a dot asks for it */}
      {!completed && !running && (
        <span className="absolute -right-1 -top-1 flex h-2.5 w-2.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
        </span>
      )}
    </button>
  )
}
