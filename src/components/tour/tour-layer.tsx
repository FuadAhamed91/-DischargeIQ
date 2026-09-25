'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Keyboard, Loader2, MousePointer2, MousePointerClick, Sparkles, WandSparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CHAPTERS, TOUR_STEPS, resolve, type Placement, type TourContext, type TourStep } from './tour-steps'
import { DragDemo, type DemoBox } from './drag-demo'

type Box = DemoBox

const PAD = 8      // between the element and the edge of its spotlight
const GAP = 14     // between the spotlight and the card
const MARGIN = 12  // the card stays this far inside the window
const CARD_W = 344
/** A step with a QR code beside its steps. */
const WIDE_W = 460
/** A step's element may take a moment to render; after this the card stops waiting and centres. */
const SETTLE_MS = 700

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const coarsePointer = () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

function visibleBox(selector: string | undefined): Box | null {
  if (!selector) return null
  const el = document.querySelector(selector)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5
const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && near(a.top, b.top) && near(a.left, b.left) && near(a.width, b.width) && near(a.height, b.height))
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/** The spotlight around an element, kept inside the window. */
function holeFor(box: Box, vw: number, vh: number): Box {
  const left = clamp(box.left - PAD, 0, vw)
  const top = clamp(box.top - PAD, 0, vh)
  const right = clamp(box.left + box.width + PAD, 0, vw)
  const bottom = clamp(box.top + box.height + PAD, 0, vh)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

interface Placed { left: number; top: number; width: number; side: Placement | null; arrow: number }

/** Beside the spotlight on the first side with room; otherwise over the page, on the roomier side. */
function placeCard(hole: Box | null, size: { w: number; h: number }, vw: number, vh: number, prefs: Placement[]): Placed {
  if (vw < 640) {
    // A phone: a sheet along the bottom, or the top when the element is low on the screen.
    const low = hole ? hole.top + hole.height / 2 > vh * 0.55 : false
    return { left: MARGIN, top: low ? 72 : vh - size.h - MARGIN, width: vw - MARGIN * 2, side: null, arrow: 0 }
  }
  if (!hole) return { left: (vw - size.w) / 2, top: Math.max(MARGIN, (vh - size.h) / 2), width: size.w, side: null, arrow: 0 }
  const order = [...prefs, ...(['bottom', 'top', 'right', 'left'] as Placement[]).filter((p) => !prefs.includes(p))]
  const cx = hole.left + hole.width / 2
  const cy = hole.top + hole.height / 2
  for (const side of order) {
    if (side === 'bottom' || side === 'top') {
      const top = side === 'bottom' ? hole.top + hole.height + GAP : hole.top - GAP - size.h
      if (top < MARGIN || top + size.h > vh - MARGIN) continue
      const left = clamp(cx - size.w / 2, MARGIN, vw - size.w - MARGIN)
      return { left, top, width: size.w, side, arrow: clamp(cx - left, 22, size.w - 22) }
    }
    const left = side === 'right' ? hole.left + hole.width + GAP : hole.left - GAP - size.w
    if (left < MARGIN || left + size.w > vw - MARGIN) continue
    const top = clamp(cy - size.h / 2, MARGIN, vh - size.h - MARGIN)
    return { left, top, width: size.w, side, arrow: clamp(cy - top, 22, size.h - 22) }
  }
  // No room beside it (a big element on a small screen): over the page, where it hides the least of it.
  const spots: Array<[number, number]> = []
  for (const left of [MARGIN, vw - size.w - MARGIN]) {
    for (const top of [MARGIN, clamp(cy - size.h / 2, MARGIN, vh - size.h - MARGIN), vh - size.h - MARGIN]) spots.push([left, top])
  }
  const hidden = ([left, top]: [number, number]) =>
    Math.max(0, Math.min(left + size.w, hole.left + hole.width) - Math.max(left, hole.left))
    * Math.max(0, Math.min(top + size.h, hole.top + hole.height) - Math.max(top, hole.top))
  const [left, top] = spots.reduce((best, spot) => (hidden(spot) < hidden(best) ? spot : best))
  return { left, top, width: size.w, side: null, arrow: 0 }
}

/** Scrolls the page (the one scroller, #main) so the element and its card fit. */
function bringIntoView(selector: string, side: Placement | undefined, cardH: number) {
  const el = document.querySelector(selector)
  const main = document.getElementById('main')
  if (!el || !main || !main.contains(el)) return
  const m = main.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const room = cardH + GAP + PAD + MARGIN
  let delta = 0
  if (side === 'bottom' && (r.top < m.top + 8 || r.bottom + room > m.bottom)) delta = r.top - (m.top + 20)
  else if (side === 'top' && (r.top - room < m.top || r.bottom > m.bottom - 8)) delta = r.bottom - (m.bottom - 20)
  else if (side !== 'bottom' && side !== 'top' && (r.top < m.top + 8 || r.bottom > m.bottom - 8)) {
    delta = r.height > m.height - 40 ? r.top - (m.top + 20) : r.top + r.height / 2 - (m.top + m.height / 2)
  }
  if (Math.abs(delta) > 4) main.scrollBy({ top: delta, behavior: reducedMotion() ? 'auto' : 'smooth' })
}

interface TourLayerProps {
  step: TourStep
  ctx: TourContext
  turn: number
  /** The page isn't the step's: show "Tour paused" instead of the spotlight. */
  paused: boolean
  canBack: boolean
  onNext: () => void
  onBack: () => void
  onEnd: () => void
  onResume: () => void
  onAssist: () => void
  /** The step's second way on ("Use the demo phone"). */
  onAlt: () => void
  onRecover: () => void
  /** The step's element never showed: skip it, or fall back. */
  onMissing: () => void
}

export function TourLayer(props: TourLayerProps) {
  const { step, ctx, turn, paused } = props
  const selector = resolve(step.target, ctx)
  const [view, setView] = useState({ w: 0, h: 0 })
  /** The lit element's box, with the selector it belongs to (a new step's card waits for its own). */
  const [target, setTarget] = useState<{ sel: string | undefined; box: Box | null; settled: boolean }>({ sel: undefined, box: null, settled: false })
  const [drag, setDrag] = useState<{ from: Box; to: Box } | null>(null)
  const [card, setCard] = useState({ w: CARD_W, h: 220 })
  /** The step whose spotlight is still gliding in from the last one. */
  const [glideTurn, setGlideTurn] = useState<number | null>(null)
  /** Clicks on the dimmed page during a step: the card shakes once for each. */
  const [nudge, setNudge] = useState({ turn: -1, count: 0 })
  /** The step that has waited long enough to offer a way past it. */
  const [stuckTurn, setStuckTurn] = useState<number | null>(null)
  const [popupOpen, setPopupOpen] = useState(false)
  /** The step's condition for Next (a number typed), as of the last frame. */
  const [ready, setReady] = useState(true)
  const nextRef = useRef<HTMLButtonElement>(null)
  const onMissing = useRef(props.onMissing)
  useEffect(() => { onMissing.current = props.onMissing })

  // Follow the element every frame: scrolling, resizing and re-rendering all move it.
  useEffect(() => {
    if (paused) return
    let raf = 0
    const since = performance.now()
    let missingSince: number | null = null
    let reported = false
    let scrolled = false
    const tick = () => {
      const now = performance.now()
      const box = visibleBox(selector)
      if (box && !scrolled) {
        scrolled = true
        bringIntoView(selector as string, step.placement?.[0], card.h)
      }
      if (box) missingSince = null
      else if (missingSince === null) missingSince = now
      const missingFor = missingSince === null ? 0 : now - missingSince
      const limit = step.optional ? 1200 : step.fallback ? 4000 : Infinity
      if (selector && !box && missingFor > limit && !reported) {
        reported = true
        onMissing.current()
      }
      const settled = !selector || !!box || now - since > SETTLE_MS
      setTarget((prev) => (prev.sel === selector && prev.settled === settled && sameBox(prev.box, box) ? prev
        // A moment without the element (a re-render swapping it) keeps the last box.
        : { sel: selector, box: box ?? (prev.sel === selector && missingFor < SETTLE_MS ? prev.box : null), settled }))
      setView((v) => (v.w === window.innerWidth && v.h === window.innerHeight ? v : { w: window.innerWidth, h: window.innerHeight }))
      if (step.drag && !coarsePointer() && !reducedMotion()) {
        const from = visibleBox(step.drag.from)
        const to = visibleBox(step.drag.to)
        setDrag((prev) => (from && to ? (prev && sameBox(prev.from, from) && sameBox(prev.to, to) ? prev : { from, to }) : null))
      }
      // A menu or dialog of the page's own is open: let every click through to it.
      const open = !!document.querySelector('[role="listbox"], [role="menu"], [data-slot="select-content"]')
      setPopupOpen((p) => (p === open ? p : open))
      const ok = step.ready ? step.ready() : true
      setReady((r) => (r === ok ? r : ok))
      schedule()
    }
    // Frames stop in a background tab; a slow timer keeps the step up to date there, so the
    // card is right the moment the tab is back.
    let timer = 0
    const schedule = () => {
      if (document.hidden) timer = window.setTimeout(tick, 250)
      else raf = requestAnimationFrame(tick)
    }
    schedule()
    return () => { cancelAnimationFrame(raf); clearTimeout(timer) }
    // card.h only matters for the first scroll; a resize of the card must not restart the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selector, turn, paused, step])

  // Each step glides in from the last; while scrolling the spotlight follows without lag.
  useEffect(() => {
    const on = setTimeout(() => setGlideTurn(turn), 0)
    const off = setTimeout(() => setGlideTurn(null), 460)
    const wait = setTimeout(() => setStuckTurn(turn), 20_000)
    return () => { clearTimeout(on); clearTimeout(off); clearTimeout(wait) }
  }, [turn])

  // The card's real size, for placing it (measured from the moment it mounts).
  const measureCard = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const ro = new ResizeObserver(() => {
      setCard((c) => (c.w === el.offsetWidth && c.h === el.offsetHeight ? c : { w: el.offsetWidth, h: el.offsetHeight }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A step to read: its Next button gets the keyboard.
  useEffect(() => {
    if (step.advance !== 'next') return
    const t = setTimeout(() => nextRef.current?.focus({ preventScroll: true }), 120)
    return () => clearTimeout(t)
  }, [turn, step.advance])

  if (paused) return <PausedPill step={step} onResume={props.onResume} onEnd={props.onEnd} />
  if (view.w === 0) return null

  const current = target.sel === selector ? target : { sel: selector, box: null, settled: false }
  const box = current.box
  const hole = box ? holeFor(box, view.w, view.h) : null
  const width = Math.min(step.wide ? WIDE_W : CARD_W, view.w - MARGIN * 2)
  const placed = placeCard(hole, { w: width, h: card.h }, view.w, view.h, step.placement ?? [])
  const waiting = !current.settled
  const acting = step.advance === 'click' || step.advance === 'route' || (step.advance === 'wait' && !!step.action)
  const title = resolve(step.title, ctx)
  const body = resolve(step.body, ctx)
  const busy = step.busy?.(ctx) ?? null
  const recover = step.recover?.when(ctx) ? step.recover : null
  const action = step.action ? resolve(step.action, ctx) : null
  const index = TOUR_STEPS.indexOf(step)
  const last = index === TOUR_STEPS.length - 1
  const interactive = view.w >= 768 && !popupOpen
  const stuck = stuckTurn === turn
  const nudging = nudge.turn === turn && nudge.count > 0
  const glideStyle = glideTurn === turn ?'left 0.4s cubic-bezier(0.2,0.8,0.2,1), top 0.4s cubic-bezier(0.2,0.8,0.2,1), width 0.4s cubic-bezier(0.2,0.8,0.2,1), height 0.4s cubic-bezier(0.2,0.8,0.2,1)' : 'none'
  const blockers: Box[] = hole
    ? [
        { left: 0, top: 0, width: view.w, height: hole.top },
        { left: 0, top: hole.top + hole.height, width: view.w, height: Math.max(0, view.h - hole.top - hole.height) },
        { left: 0, top: hole.top, width: hole.left, height: hole.height },
        { left: hole.left + hole.width, top: hole.top, width: Math.max(0, view.w - hole.left - hole.width), height: hole.height },
      ]
    : [{ left: 0, top: 0, width: view.w, height: view.h }]
  const spot = hole ?? { left: view.w / 2, top: view.h / 2, width: 0, height: 0 }

  return (
    <>
      {/* The dimmed page, with the element lit */}
      <div
        aria-hidden="true"
        className={cn('pointer-events-none fixed z-[80] rounded-xl transition-opacity duration-300', waiting ? 'opacity-0' : 'opacity-100')}
        style={{
          left: spot.left, top: spot.top, width: spot.width, height: spot.height,
          boxShadow: '0 0 0 200vmax var(--tour-dim)',
          transition: `${glideStyle === 'none' ? '' : glideStyle + ', '}opacity 0.3s`,
        }}
      />
      {/* Clicks outside the lit element go nowhere (the card says so); the wheel still scrolls the page */}
      {blockers.map((b, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cn('fixed z-[80]', interactive ? 'pointer-events-auto' : 'pointer-events-none')}
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
          onWheel={(e) => {
            const unit = e.deltaMode === 1 ? 16 : 1 // lines (Firefox) or pixels
            document.getElementById('main')?.scrollBy({ top: e.deltaY * unit, left: e.deltaX * unit })
          }}
          onClick={() => setNudge((n) => ({ turn, count: n.turn === turn ? n.count + 1 : 1 }))}
        />
      ))}
      {hole && !waiting && (
        <div
          aria-hidden="true"
          className={cn('pointer-events-none fixed z-[81] rounded-xl ring-2 ring-brand', acting && 'animate-tour-pulse')}
          style={{ left: hole.left, top: hole.top, width: hole.width, height: hole.height, transition: glideStyle }}
        />
      )}
      {/* "Click here": a pointer tapping the element */}
      {hole && !waiting && acting && !step.drag && (
        <MousePointer2
          aria-hidden="true"
          className="pointer-events-none fixed z-[82] h-7 w-7 animate-tour-tap fill-white text-slate-900 drop-shadow-lg"
          strokeWidth={1.5}
          style={{ left: hole.left + hole.width - 24, top: hole.top + hole.height - 16 }}
        />
      )}
      {drag && !waiting && <DragDemo from={drag.from} to={drag.to} label={step.drag?.label ?? ''} />}

      {/* The card */}
      <div
        ref={measureCard}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        className={cn(
          'pointer-events-auto fixed z-[83] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-2xl',
          waiting ? 'opacity-0' : 'opacity-100',
        )}
        style={{ left: placed.left, top: placed.top, width: placed.width, transition: `${glideStyle === 'none' ? '' : glideStyle + ', '}opacity 0.2s` }}
      >
        {placed.side && <Caret side={placed.side} at={placed.arrow} />}
        <div key={`${turn}-${nudging ? nudge.count : 0}`} className={nudging ? 'animate-tour-nudge' : 'animate-tour-card-in'}>
          <Progress step={step} index={index} onEnd={props.onEnd} />
          <div className="px-4 pb-4 pt-2">
            <h2 id="tour-title" className="text-[15px] font-semibold leading-snug tracking-tight">{title}</h2>
            <div id="tour-body" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</div>

            {action && !recover && !(step.ready && ready) && (
              <p className="mt-3 flex items-center gap-2 rounded-lg bg-brand-tint px-3 py-2 text-sm text-foreground ring-1 ring-brand/20">
                <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
                </span>
                {acting
                  ? <MousePointerClick className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                  : <Keyboard className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />}
                <span className="min-w-0">{step.drag && coarsePointer() ? <>Tap <span className="font-semibold">{step.drag.label}</span>’s letter</> : action}</span>
              </p>
            )}
            {busy && (
              <p className="mt-3 flex items-center gap-2 text-sm font-medium text-brand" role="status">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" /> {busy}
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={props.onEnd}
                className="mr-auto rounded-md px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Skip tour
              </button>
              {recover ? (
                <Button type="button" size="sm" onClick={props.onRecover}>
                  {recover.label} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              ) : (
                <>
                  {step.advance === 'next' && props.canBack && (
                    <Button type="button" variant="ghost" size="sm" onClick={props.onBack} aria-label="Previous step">
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  {/* Done for them: the action, until the step no longer needs it */}
                  {step.assist && (step.advance !== 'next' || (step.ready && !ready)) && (
                    <Button type="button" variant="outline" size="sm" onClick={props.onAssist} className="text-brand hover:text-brand">
                      <WandSparkles className="h-3.5 w-3.5" aria-hidden="true" /> Do it for me
                    </Button>
                  )}
                  {step.alt && step.advance === 'next' && (
                    <Button type="button" variant="outline" size="sm" onClick={props.onAlt}>{step.alt.label}</Button>
                  )}
                  {step.advance === 'next' && !(busy && !stuck) && (
                    <Button ref={nextRef} type="button" size="sm" variant={busy ? 'outline' : 'default'} onClick={props.onNext} disabled={!ready}>
                      {busy ? 'Skip' : last ? 'Finish' : step.nextLabel ?? 'Next'} {!busy && (last ? <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />)}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{`Tour, step ${index + 1} of ${TOUR_STEPS.length}: ${title}`}</p>
    </>
  )
}

function Caret({ side, at }: { side: Placement; at: number }) {
  // A little square turned 45°, on the card's edge facing the element.
  const style =
    side === 'bottom' ? { top: -6, left: at - 6 }
      : side === 'top' ? { bottom: -6, left: at - 6 }
        : side === 'right' ? { left: -6, top: at - 6 }
          : { right: -6, top: at - 6 }
  const edges =
    side === 'bottom' ? 'border-l border-t'
      : side === 'top' ? 'border-b border-r'
        : side === 'right' ? 'border-b border-l'
          : 'border-r border-t'
  return <span aria-hidden="true" className={cn('absolute h-3 w-3 rotate-45 bg-popover', edges)} style={style} />
}

function Progress({ step, index, onEnd }: { step: TourStep; index: number; onEnd: () => void }) {
  const chapter = CHAPTERS.findIndex((c) => c.id === step.chapter)
  return (
    <div className="px-4 pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
          {CHAPTERS[chapter]?.label}
          <span className="ml-1.5 font-medium normal-case tracking-normal text-muted-foreground tnum">· {index + 1} of {TOUR_STEPS.length}</span>
        </p>
        <button
          type="button"
          onClick={onEnd}
          aria-label="End the tour"
          className="-mr-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="mt-2 flex gap-1" aria-hidden="true">
        {CHAPTERS.map((c, i) => {
          const steps = TOUR_STEPS.filter((s) => s.chapter === c.id)
          const done = i < chapter ? steps.length : i > chapter ? 0 : steps.indexOf(step) + 1
          return (
            <span key={c.id} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${(done / steps.length) * 100}%` }} />
            </span>
          )
        })}
      </div>
    </div>
  )
}

function PausedPill({ step, onResume, onEnd }: { step: TourStep; onResume: () => void; onEnd: () => void }): ReactNode {
  const chapter = CHAPTERS.find((c) => c.id === step.chapter)?.label
  return (
    <div
      role="status"
      className="pointer-events-auto fixed bottom-5 left-1/2 z-[83] flex max-w-[calc(100vw-24px)] -translate-x-1/2 animate-tour-rise items-center gap-2 rounded-full border bg-popover py-1.5 pl-3.5 pr-1.5 text-sm shadow-xl"
    >
      <Sparkles className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
      <span className="min-w-0 truncate">
        <span className="font-medium">Tour paused</span>
        <span className="text-muted-foreground"> · {chapter}</span>
      </span>
      <Button type="button" size="sm" className="h-8 rounded-full" onClick={onResume}>
        Resume <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <button
        type="button"
        onClick={onEnd}
        aria-label="End the tour"
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
