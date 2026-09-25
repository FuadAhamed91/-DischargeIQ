/**
 * The guided tour's state: whether it runs, the step it is on and what it has
 * learned on the way (the care plan being worked on, how the patient's reply
 * went). Kept outside React so every page reads the same tour, and saved in
 * this browser so a reload carries on where the judge was.
 */

import { TOUR_STEPS, type TourContext } from './tour-steps'

export interface TourState {
  /** A tour is under way (it may be paused on a page it doesn't cover). */
  running: boolean
  /** The step it is on while running. */
  step: string
  ctx: TourContext
  /** The welcome is open. */
  welcome: boolean
  /** The welcome has been seen or dismissed once: it doesn't open by itself again. */
  seen: boolean
  /** The tour was finished at least once. */
  completed: boolean
  /** Counts step changes, so the card can animate in for each one. */
  turn: number
}

const STORAGE_KEY = 'careloop:tour'
const FIRST = TOUR_STEPS[0].id

/** Before the browser is read (server render, first paint): nothing shows. */
const SERVER: TourState = { running: false, step: FIRST, ctx: {}, welcome: false, seen: true, completed: false, turn: 0 }

let state: TourState | null = null
const listeners = new Set<() => void>()

function read(): TourState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<TourState>
    const known = typeof saved.step === 'string' && TOUR_STEPS.some((s) => s.id === saved.step)
    return {
      running: Boolean(saved.running) && known,
      step: known ? (saved.step as string) : FIRST,
      ctx: saved.ctx && typeof saved.ctx === 'object' ? saved.ctx : {},
      welcome: false,
      seen: Boolean(saved.seen),
      completed: Boolean(saved.completed),
      turn: 0,
    }
  } catch {
    // Storage blocked (a private window): the tour still runs, for this page load.
    return { ...SERVER, seen: false }
  }
}

function set(patch: Partial<TourState>): void {
  const prev = getTourState()
  const turn = patch.turn ?? (patch.step !== undefined && patch.step !== prev.step ? prev.turn + 1 : prev.turn)
  state = { ...prev, ...patch, turn }
  try {
    const { running, step, ctx, seen, completed } = state
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ running, step, ctx, seen, completed }))
  } catch {
    // Kept in memory.
  }
  for (const listener of listeners) listener()
}

export function getTourState(): TourState {
  if (!state) state = read()
  return state
}

export function getServerTourState(): TourState {
  return SERVER
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const tour = {
  openWelcome: () => set({ welcome: true }),
  closeWelcome: () => set({ welcome: false, seen: true }),
  start: () => set({ running: true, step: FIRST, ctx: {}, welcome: false, seen: true, turn: getTourState().turn + 1 }),
  resume: () => set({ welcome: false, seen: true }),
  goTo: (step: string, ctx?: Partial<TourContext>) => {
    const prev = getTourState()
    // Step changes restart the card's entrance even when the id is the same (a retried letter).
    set({ step, ctx: ctx ? { ...prev.ctx, ...ctx } : prev.ctx, ...(step === prev.step ? { turn: prev.turn + 1 } : {}) })
  },
  patchCtx: (ctx: Partial<TourContext>) => set({ ctx: { ...getTourState().ctx, ...ctx } }),
  end: (completed = false) => set({ running: false, welcome: false, seen: true, completed: getTourState().completed || completed }),
}
