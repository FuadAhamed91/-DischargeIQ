'use client'

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { TOUR_SIGNAL_EVENT, type TourSignalDetail } from '@/lib/tour/signals'
import { CHAPTERS, TOUR_STEPS, resolve, stepIndex, type TourStep } from './tour-steps'
import { getServerTourState, getTourState, subscribeTour, tour } from './tour-store'
import { TourLayer } from './tour-layer'
import { WelcomeDialog } from './welcome-dialog'

const EPISODE_IN_PATH = /^\/episodes\/([0-9a-f-]{36})(?:\/review)?$/
/** How long the page may be one the step doesn't cover before "Tour paused" shows (a redirect is not a detour). */
const PAUSE_AFTER_MS = 900

interface TourApi {
  /** This user can take the tour (it adds a patient). */
  enabled: boolean
  /** A tour is under way. */
  running: boolean
  /** The tour was finished at least once. */
  completed: boolean
  openWelcome: () => void
}

const TourContext = createContext<TourApi | null>(null)

export function useTour(): TourApi {
  const api = useContext(TourContext)
  if (!api) throw new Error('useTour() needs a <TourProvider>')
  return api
}

function chapterOf(step: TourStep) {
  return CHAPTERS.findIndex((c) => c.id === step.chapter)
}

/**
 * Runs the guided tour over the dashboard: opens the welcome on a first
 * visit, follows the judge from page to page, moves on when they do what a
 * step asks (a click, a new page, a signal from the app), and draws the
 * spotlight. `enabled` is false for roles that can't add patients: the tour
 * would ask them to do what they may not.
 */
export function TourProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const state = useSyncExternalStore(subscribeTour, getTourState, getServerTourState)
  const pathname = usePathname()
  const router = useRouter()
  const index = Math.max(0, stepIndex(state.step))
  const step = TOUR_STEPS[index]
  const onStepPage = step.route === null || step.route.test(pathname)
  // When the page stopped being the step's: after a moment, the tour shows as paused.
  const [offPage, setOffPage] = useState<{ path: string; step: string } | null>(null)
  const paused = !onStepPage && offPage?.path === pathname && offPage.step === step.id

  // A first visit opens the welcome, once the page has painted.
  useEffect(() => {
    if (!enabled || state.seen || state.running) return
    const t = setTimeout(tour.openWelcome, 800)
    return () => clearTimeout(t)
  }, [enabled, state.seen, state.running])

  // The page decides a lot: which care plan the judge is on, and whether they did what the step asked.
  useEffect(() => {
    const episode = EPISODE_IN_PATH.exec(pathname)?.[1]
    if (episode && episode !== getTourState().ctx.episodeId && state.running) tour.patchCtx({ episodeId: episode })
    if (!state.running || onStepPage) return
    // A later step on this page, no further than the next chapter: the judge got there by doing
    // what was asked (Add patient, Save), or went ahead on their own. Follow them.
    const here = chapterOf(step)
    const ahead = TOUR_STEPS.slice(index + 1).find((s) => s.route?.test(pathname) && chapterOf(s) <= here + 1)
    if (ahead) {
      tour.goTo(ahead.id)
      return
    }
    const t = setTimeout(() => setOffPage({ path: pathname, step: step.id }), PAUSE_AFTER_MS)
    return () => clearTimeout(t)
  }, [pathname, state.running, onStepPage, step, index])

  // What the app says: it changes what the tour knows, and may open another step.
  useEffect(() => {
    if (!state.running) return
    let answered: ReturnType<typeof setTimeout> | undefined
    const listener = (event: Event) => {
      const { signal, detail } = (event as CustomEvent<TourSignalDetail>).detail
      const now = TOUR_STEPS[stepIndex(getTourState().step)]
      switch (signal) {
        case 'intake:reading': tour.patchCtx({ readFailed: false }); break
        case 'intake:saved': tour.patchCtx({ ownPhone: detail === 'own' }); break
        case 'intake:failed': tour.patchCtx({ readFailed: true }); break
        case 'careplan:confirm': tour.patchCtx({ sendError: undefined }); break
        case 'careplan:sent': tour.patchCtx({ sendError: undefined }); break
        case 'careplan:failed': tour.patchCtx({ sendError: detail || 'no reason given' }); break
        case 'patient:replied': clearTimeout(answered); tour.patchCtx({ reply: 'waiting' }); break
        case 'patient:failed': clearTimeout(answered); tour.patchCtx({ reply: undefined }); break
        case 'patient:alerted': clearTimeout(answered); tour.patchCtx({ reply: 'alerted' }); break
        case 'patient:answered':
          // An urgent message is answered first and alerted a moment later: wait before calling it an answer.
          clearTimeout(answered)
          answered = setTimeout(() => { if (getTourState().ctx.reply === 'waiting') tour.patchCtx({ reply: 'answered' }) }, 1500)
          break
      }
      const to = now?.on?.[signal]
      if (to) tour.goTo(to === 'next' ? TOUR_STEPS[stepIndex(now.id) + 1]?.id ?? now.id : to)
    }
    window.addEventListener(TOUR_SIGNAL_EVENT, listener)
    return () => { window.removeEventListener(TOUR_SIGNAL_EVENT, listener); clearTimeout(answered) }
  }, [state.running])

  const api = useMemo(() => {
    const next = () => {
      const i = stepIndex(getTourState().step)
      const said = TOUR_STEPS[i]?.nextCtx
      if (said) tour.patchCtx(said)
      if (i >= TOUR_STEPS.length - 1) {
        tour.end(true)
        celebrate()
        toast.success('You’re all set. Explore anything: the tour is under the Tour button.')
        return
      }
      tour.goTo(TOUR_STEPS[i + 1].id)
    }
    return {
      next,
      back: () => {
        const i = stepIndex(getTourState().step)
        if (i > 0) tour.goTo(TOUR_STEPS[i - 1].id)
      },
      end: () => {
        tour.end(false)
        toast('Tour closed. Start it again any time from the Tour button at the top.')
      },
      start: () => {
        tour.start()
        if (window.location.pathname !== '/') router.push('/')
      },
      resume: () => {
        tour.resume()
        const s = getTourState()
        const at = TOUR_STEPS[stepIndex(s.step)]
        if (at.route && !at.route.test(window.location.pathname)) router.push(at.href(s.ctx))
      },
    }
  }, [router])

  // A step already done when it opens (the conversation is already showing) is passed over.
  useEffect(() => {
    if (!state.running || state.welcome || !onStepPage || !step.done) return
    const t = setTimeout(() => { if (step.done?.()) api.next() }, 300)
    return () => clearTimeout(t)
  }, [state.running, state.welcome, onStepPage, step, state.turn, api])

  // Click steps end when the lit element is clicked (after the page has had the click).
  useEffect(() => {
    if (!state.running || step.advance !== 'click') return
    const selector = resolve(step.target, state.ctx)
    if (!selector) return
    const onClick = (e: MouseEvent) => {
      const el = document.querySelector(selector)
      if (el && e.target instanceof Node && el.contains(e.target)) setTimeout(api.next, 250)
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [state.running, step, state.ctx, api])

  // Keyboard: Esc ends the tour, the arrows page through steps you only read.
  useEffect(() => {
    if (!state.running || state.welcome || paused) return
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      // The page's own dialog or menu takes Esc first.
      const pageLayer = document.querySelector('[role="listbox"], [role="menu"], [data-slot="dialog-content"][data-open]')
      if (e.key === 'Escape' && !pageLayer) api.end()
      else if (!typing && step.advance === 'next' && e.key === 'ArrowRight' && (!step.ready || step.ready())) api.next()
      else if (!typing && step.advance === 'next' && e.key === 'ArrowLeft' && canGoBack(index, pathname)) api.back()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [state.running, state.welcome, paused, step, index, pathname, api])

  const context = useMemo<TourApi>(() => ({
    enabled,
    running: state.running,
    completed: state.completed,
    openWelcome: tour.openWelcome,
  }), [enabled, state.running, state.completed])

  const inProgress = state.running && state.step !== TOUR_STEPS[0].id
  const showLayer = enabled && state.running && !state.welcome

  return (
    <TourContext.Provider value={context}>
      {children}
      <WelcomeDialog
        open={state.welcome}
        inProgress={inProgress}
        onStart={api.start}
        onResume={api.resume}
        onDismiss={() => {
          if (state.running) { api.end(); return }
          tour.closeWelcome()
          if (!state.completed) hintTourButton()
        }}
        onClose={() => { tour.closeWelcome(); if (!state.running && !state.completed) hintTourButton() }}
      />
      {showLayer && typeof document !== 'undefined' && createPortal(
        <TourLayer
          step={step}
          ctx={state.ctx}
          turn={state.turn}
          paused={paused}
          canBack={canGoBack(index, pathname)}
          onNext={api.next}
          onBack={api.back}
          onEnd={api.end}
          onResume={api.resume}
          onAlt={() => {
            if (step.alt) tour.patchCtx(step.alt.ctx)
            const i = stepIndex(step.id)
            if (TOUR_STEPS[i + 1]) tour.goTo(TOUR_STEPS[i + 1].id)
          }}
          onAssist={() => {
            const selector = step.assist
            const el = selector ? document.querySelector<HTMLElement>(selector) : null
            el?.click()
          }}
          onRecover={() => {
            const to = step.recover?.step
            const target = to ? TOUR_STEPS[stepIndex(to)] : null
            if (!target) return
            tour.goTo(target.id)
            router.push(target.href(getTourState().ctx))
          }}
          onMissing={() => {
            if (step.optional) api.next()
            else if (step.fallback) tour.goTo(step.fallback)
          }}
        />,
        document.body,
      )}
    </TourContext.Provider>
  )
}

/** Back is offered only to a step read on this same page. */
function canGoBack(index: number, pathname: string): boolean {
  const prev = TOUR_STEPS[index - 1]
  if (!prev || prev.advance !== 'next') return false
  return prev.route === null || prev.route.test(pathname)
}

/** After "I'll explore on my own": the Tour button says hello, so the way back in is known. */
function hintTourButton() {
  const button = document.querySelector<HTMLElement>('[data-tour="tour-button"]')
  if (!button) return
  toast('The tour is here whenever you want it', { description: 'Tour button, top right.' })
  button.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }],
    { duration: 520, iterations: 3, easing: 'ease-in-out' },
  )
}

/** The finish: a burst of colour from the Tour button. */
function celebrate() {
  const button = document.querySelector<HTMLElement>('[data-tour="tour-button"]')
  if (!button || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const r = button.getBoundingClientRect()
  const colors = ['var(--brand)', 'var(--success)', 'var(--warning)', 'var(--danger)', 'var(--info)']
  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  layer.style.cssText = `position:fixed;left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;z-index:90;pointer-events:none`
  for (let i = 0; i < 28; i++) {
    const angle = (i / 28) * Math.PI * 2
    const distance = 60 + (i % 4) * 26
    const dot = document.createElement('span')
    dot.style.cssText = [
      'position:absolute', 'width:8px', 'height:8px', 'border-radius:9999px', 'left:-4px', 'top:-4px',
      `background:${colors[i % colors.length]}`,
      `--tour-x:${Math.cos(angle) * distance}px`, `--tour-y:${Math.sin(angle) * distance + 30}px`,
      `animation:tour-burst ${700 + (i % 5) * 90}ms cubic-bezier(0.2,0.8,0.2,1) forwards`,
    ].join(';')
    layer.appendChild(dot)
  }
  document.body.appendChild(layer)
  setTimeout(() => layer.remove(), 1400)
}
