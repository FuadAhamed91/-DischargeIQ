'use client'

import { useEffect, useRef } from 'react'
import { FileText, HandGrab } from 'lucide-react'

export interface DemoBox { top: number; left: number; width: number; height: number }

const GHOST_W = 196
const GHOST_H = 54

/**
 * Shows the move the tour asks for: a copy of the demo letter lifts off its
 * tile, travels to the letter box and drops in, then again, until the judge
 * does it. Drawn above the dimmed page and never in the way of the real drag.
 */
export function DragDemo({ from, to, label }: { from: DemoBox; to: DemoBox; label: string }) {
  const ghost = useRef<HTMLDivElement>(null)
  const landing = useRef<HTMLDivElement>(null)

  // Whole pixels: the animation restarts only when the page really moved.
  const sx = Math.round(from.left + from.width / 2 - GHOST_W / 2)
  const sy = Math.round(from.top + from.height / 2 - GHOST_H / 2)
  const ex = Math.round(to.left + to.width / 2 - GHOST_W / 2)
  const ey = Math.round(to.top + to.height / 2 - GHOST_H / 2)

  useEffect(() => {
    const el = ghost.current
    const ring = landing.current
    if (!el || !ring) return
    // An arc, lifted over the page between the tile and the box.
    const mx = Math.round((sx + ex) / 2)
    const my = Math.round(Math.min(sy, ey) - 56)
    const at = (x: number, y: number, extra = '') => `translate(${x}px, ${y}px) ${extra}`
    const flight = el.animate(
      [
        { offset: 0, opacity: 0, transform: at(sx, sy, 'scale(1)') },
        { offset: 0.1, opacity: 1, transform: at(sx, sy, 'scale(1)') },
        { offset: 0.2, opacity: 1, transform: at(sx, sy - 6, 'scale(1.06) rotate(-3deg)') },
        { offset: 0.48, opacity: 1, transform: at(mx, my, 'scale(1.06) rotate(-2deg)') },
        { offset: 0.72, opacity: 1, transform: at(ex, ey, 'scale(1.06) rotate(0deg)') },
        { offset: 0.8, opacity: 1, transform: at(ex, ey, 'scale(0.9)') },
        { offset: 0.9, opacity: 0, transform: at(ex, ey, 'scale(0.9)') },
        { offset: 1, opacity: 0, transform: at(ex, ey, 'scale(0.9)') },
      ],
      { duration: 3400, iterations: Infinity, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' },
    )
    // The box lights up as the letter lands.
    const glow = ring.animate(
      [
        { offset: 0, opacity: 0 },
        { offset: 0.7, opacity: 0 },
        { offset: 0.78, opacity: 1 },
        { offset: 0.95, opacity: 0 },
        { offset: 1, opacity: 0 },
      ],
      { duration: 3400, iterations: Infinity },
    )
    return () => { flight.cancel(); glow.cancel() }
  }, [sx, sy, ex, ey])

  return (
    <>
      <div
        ref={landing}
        aria-hidden="true"
        className="pointer-events-none fixed z-[82] rounded-xl border-2 border-dashed border-brand bg-brand/10 opacity-0"
        style={{ left: to.left, top: to.top, width: to.width, height: to.height }}
      />
      <div
        ref={ghost}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-[82] opacity-0"
        style={{ width: GHOST_W, height: GHOST_H }}
      >
        <div className="flex h-full items-center gap-2.5 rounded-xl border border-brand/40 bg-card px-2.5 shadow-2xl ring-4 ring-brand/15">
          <span className="flex h-10 w-8 shrink-0 flex-col items-center justify-center rounded-md bg-danger-soft text-danger">
            <FileText className="h-4 w-4" />
            <span className="mt-0.5 text-[8px] font-bold leading-none tracking-wide">PDF</span>
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-foreground">{label}</span>
            <span className="block text-xs text-muted-foreground">Discharge letter</span>
          </span>
        </div>
        <HandGrab className="absolute -bottom-4 right-3 h-7 w-7 fill-white text-slate-900 drop-shadow-md" strokeWidth={1.6} />
      </div>
    </>
  )
}
