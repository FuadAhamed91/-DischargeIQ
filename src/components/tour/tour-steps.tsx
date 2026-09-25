import type { ReactNode } from 'react'
import type { TourSignal } from '@/lib/tour/signals'
import { phoneLine } from '@/lib/intake/phone'
import { OpenWhatsAppLink, SandboxJoinSteps, SandboxQr } from '@/components/whatsapp/sandbox-join'

/**
 * The guided tour, step by step: what lights up, what the card says, and what
 * moves the judge on. The story follows one patient from the discharge letter
 * to WhatsApp and back to the nurse, then points at what to explore.
 */

export type ChapterId = 'overview' | 'intake' | 'careplan' | 'whatsapp' | 'explore'

export const CHAPTERS: { id: ChapterId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'intake', label: 'Add a patient' },
  { id: 'careplan', label: 'Care plan' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'explore', label: 'Explore' },
]

/** What the tour remembers from page to page. */
export interface TourContext {
  /** The care plan the judge is working on. */
  episodeId?: string
  /** The demo reply written as the patient: waiting for its answer, answered, or it raised an alert. */
  reply?: 'waiting' | 'answered' | 'alerted'
  /** Why the care plan could not be sent. */
  sendError?: string
  /** The letter could not be read. */
  readFailed?: boolean
  /** Said they joined the WhatsApp sandbox from the QR step (false: chose the demo phone). */
  joined?: boolean
  /** The patient was saved with their own WhatsApp number (false: the demo number). */
  ownPhone?: boolean
}

export type Placement = 'top' | 'bottom' | 'left' | 'right'

export interface TourStep {
  id: string
  chapter: ChapterId
  /** The page it happens on; null: any page (the sidebar and the header are everywhere). */
  route: RegExp | null
  /** Where "Resume" takes the judge. */
  href: (ctx: TourContext) => string
  /** The element to light up; none: the card sits in the middle of the screen. */
  target?: string | ((ctx: TourContext) => string | undefined)
  /** Where the card goes, in order of preference. */
  placement?: Placement[]
  title: string | ((ctx: TourContext) => string)
  body: ReactNode | ((ctx: TourContext) => ReactNode)
  /**
   * How the step ends. next: the judge reads and presses Next. click: the
   * judge clicks the lit element. route: the lit element opens the next
   * step's page. wait: the app signals when it is done.
   */
  advance: 'next' | 'click' | 'route' | 'wait'
  /** The "click here" line: what to do on the page. */
  action?: ReactNode | ((ctx: TourContext) => ReactNode)
  /** What "Do it for me" clicks. */
  assist?: string
  /** Signals from the app and the step each one opens ("next" for the following one). */
  on?: Partial<Record<TourSignal, string>>
  /** Skipped when its element is not on screen (the sidebar on a phone). */
  optional?: boolean
  /** Where to go back to when the element never shows (the page was reloaded mid-step). */
  fallback?: string
  /** A spinner line in the card while the app works; null: done. */
  busy?: (ctx: TourContext) => string | null
  /** Animate a letter being dragged from one element to another. */
  drag?: { from: string; to: string; label: string }
  /** Already done when the step opens (the tab is already showing): skipped. */
  done?: () => boolean
  /** A way past a step the app could not finish (WhatsApp refused the care plan): a button to that step's page. */
  recover?: { when: (ctx: TourContext) => boolean; label: string; step: string }
  /** Next stays off until this is true (a WhatsApp number has been typed). */
  ready?: () => boolean
  /** The Next button's words, and what pressing it tells the tour. */
  nextLabel?: string
  nextCtx?: Partial<TourContext>
  /** A second way on, beside Next ("Use the demo phone"). */
  alt?: { label: string; ctx: Partial<TourContext> }
  /** A wider card, for a QR code beside its steps. */
  wide?: boolean
}

const REVIEW = /^\/episodes\/[0-9a-f-]{36}\/review$/
const PATIENT = /^\/episodes\/[0-9a-f-]{36}$/
const reviewHref = (ctx: TourContext) => (ctx.episodeId ? `/episodes/${ctx.episodeId}/review` : '/episodes/new')
const patientHref = (ctx: TourContext) => (ctx.episodeId ? `/episodes/${ctx.episodeId}?tab=conversation` : '/patients')

const conversationShowing = () =>
  document.querySelector('[data-tour="tab-conversation"]')?.getAttribute('aria-selected') === 'true'

/** A whole WhatsApp number is in the Add patient field. */
const phoneTyped = () => phoneLine((document.getElementById('phone_e164') as HTMLInputElement | null)?.value ?? '').tone === 'ok'

const B = ({ children }: { children: ReactNode }) => <span className="font-semibold text-foreground">{children}</span>

export const TOUR_STEPS: TourStep[] = [
  // ── Overview ─────────────────────────────────────────────────────────
  {
    id: 'overview-stats',
    chapter: 'overview',
    route: /^\/$/,
    href: () => '/',
    target: '[data-tour="overview-stats"]',
    placement: ['bottom', 'top'],
    title: 'The whole ward at a glance',
    body: 'Patients being followed up at home, alerts waiting for a nurse, appointments to confirm, and how many nightly WhatsApp check-ins patients answered this week.',
    advance: 'next',
  },
  {
    id: 'overview-attention',
    chapter: 'overview',
    route: /^\/$/,
    href: () => '/',
    target: '[data-tour="overview-attention"]',
    placement: ['right', 'left', 'top', 'bottom'],
    title: 'Who needs a nurse, right now',
    body: 'When a patient reports a worrying symptom on WhatsApp, an alert lands here within seconds, most urgent first. Below it: what is still to follow up, and the last 24 hours.',
    advance: 'next',
  },
  {
    id: 'overview-whatsapp',
    chapter: 'overview',
    route: /^\/$/,
    href: () => '/',
    target: '[data-tour="whatsapp-line"]',
    placement: ['right', 'top'],
    optional: true,
    title: 'One WhatsApp number, every patient',
    body: 'Patients just message this number, in English, Arabic, Hindi, Tamil or Tagalog. No app to install, no password to forget.',
    advance: 'next',
  },
  {
    id: 'overview-phone',
    chapter: 'overview',
    route: /^\/$/,
    href: () => '/',
    wide: true,
    title: 'Try it on your own phone',
    body: (
      <div className="space-y-3">
        <p>See the patient’s side for real: join our WhatsApp test line now, and the care plan comes to your phone later in the tour.</p>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <SandboxQr className="h-36 w-36 ring-1 ring-border" />
          <SandboxJoinSteps last={<>Come back here and press <B>I’ve joined</B>. You type your number when you add the patient.</>} />
        </div>
        <OpenWhatsAppLink />
      </div>
    ),
    advance: 'next',
    nextLabel: 'I’ve joined',
    nextCtx: { joined: true },
    alt: { label: 'Use the demo phone', ctx: { joined: false } },
  },
  {
    id: 'overview-add',
    chapter: 'overview',
    route: /^\/$/,
    href: () => '/',
    target: '[data-tour="add-patient"]',
    placement: ['bottom', 'left'],
    title: 'Let’s send a patient home',
    body: 'Everything starts from the discharge letter the hospital already writes. There are no forms to fill in.',
    action: <>Click <B>Add patient</B></>,
    assist: '[data-tour="add-patient"]',
    advance: 'route',
  },

  // ── Add a patient ────────────────────────────────────────────────────
  {
    id: 'intake-drag',
    chapter: 'intake',
    route: /^\/episodes\/new$/,
    href: () => '/episodes/new',
    target: '[data-tour="intake-letters"]',
    placement: ['bottom', 'top'],
    title: 'Drop in the discharge letter',
    body: (ctx) => ctx.readFailed
      ? 'That letter could not be read. Try Fatima’s letter again: drag it into the box.'
      : 'These are real PDF discharge letters for fictional patients. Drag Fatima’s letter into the box, just as a nurse drops in the PDF from the hospital system.',
    action: <>Drag <B>Fatima Al Hashimi</B> into the box</>,
    assist: '[data-tour="sample-letter-fatima-al-hashimi"]',
    drag: { from: '[data-tour="sample-letter-fatima-al-hashimi"]', to: '[data-tour="intake-dropzone"]', label: 'Fatima Al Hashimi' },
    advance: 'wait',
    on: { 'intake:reading': 'intake-reading', 'intake:read': 'intake-details' },
  },
  {
    id: 'intake-reading',
    chapter: 'intake',
    route: /^\/episodes\/new$/,
    href: () => '/episodes/new',
    target: '[data-tour="intake-dropzone"]',
    placement: ['bottom', 'right', 'top'],
    title: 'The AI is reading the letter',
    body: 'It finds the patient, the diagnosis, every medicine with its dose and times, the follow-up visits and the warning signs. Usually 10 to 30 seconds.',
    busy: () => 'Reading Fatima’s discharge letter…',
    advance: 'wait',
    fallback: 'intake-drag',
    on: { 'intake:read': 'intake-details', 'intake:failed': 'intake-drag' },
  },
  {
    id: 'intake-details',
    chapter: 'intake',
    route: /^\/episodes\/new$/,
    href: () => '/episodes/new',
    target: '[data-tour="intake-patient"]',
    placement: ['bottom', 'right', 'top'],
    title: 'Filled in from the letter',
    body: 'Name, MRN, date of birth and discharge date were all read from the PDF. The nurse only checks them.',
    advance: 'next',
    fallback: 'intake-drag',
  },
  {
    id: 'intake-whatsapp',
    chapter: 'intake',
    route: /^\/episodes\/new$/,
    href: () => '/episodes/new',
    target: '[data-tour="intake-whatsapp"]',
    placement: ['bottom', 'top', 'right'],
    title: (ctx) => (ctx.joined ? 'Now type your WhatsApp number' : 'Where the messages go'),
    body: (ctx) => ctx.joined
      ? <>The number you just joined with, starting with + and the country code, e.g. +971 50 123 4567. The care plan and everything after it come to your phone. You can also pick the language: <B>Arabic</B>, Hindi, Tamil or Tagalog.</>
      : <>Type the patient’s WhatsApp number with the country code, or click <B>Use demo number</B> to send everything to our test phone. To get the messages yourself, scan the code on this card first.</>,
    action: <>Type a number, or click <B>Use demo number</B></>,
    assist: '[data-tour="use-demo-number"]',
    ready: phoneTyped,
    advance: 'next',
    fallback: 'intake-drag',
  },
  {
    id: 'intake-save',
    chapter: 'intake',
    route: /^\/episodes\/new$/,
    href: () => '/episodes/new',
    target: '[data-tour="intake-save"]',
    placement: ['top', 'left'],
    title: 'Save the patient',
    body: 'Next you see the care plan the AI built. Nothing reaches the patient until a nurse approves it.',
    action: <>Click <B>Save and check the care plan</B></>,
    assist: '[data-tour="intake-save"]',
    advance: 'route',
    fallback: 'intake-drag',
  },

  // ── Care plan ────────────────────────────────────────────────────────
  {
    id: 'careplan-review',
    chapter: 'careplan',
    route: REVIEW,
    href: reviewHref,
    target: '[data-tour="review-medicines"]',
    placement: ['bottom', 'top', 'right'],
    title: 'The care plan, built from the letter',
    body: 'Every medicine with its dose, times and how to take it. Below: the warning signs, the follow-up visits and advice. Anything wrong can be fixed right here.',
    advance: 'next',
    on: { 'careplan:confirm': 'careplan-confirm' },
  },
  {
    id: 'careplan-send',
    chapter: 'careplan',
    route: REVIEW,
    href: reviewHref,
    target: '[data-tour="review-send"]',
    placement: ['top', 'left'],
    title: (ctx) => (ctx.sendError ? 'WhatsApp didn’t take it this time' : 'Approve it and send it'),
    body: (ctx) => ctx.sendError
      ? <>The care plan is approved, but WhatsApp turned the message away ({ctx.sendError}). Try again, or carry on: the rest of the tour works either way.</>
      : 'One click: the plan is approved and goes to the patient on WhatsApp, in their language.',
    action: <>Click <B>Approve and send</B></>,
    assist: '[data-tour="review-send"]',
    advance: 'wait',
    recover: { when: (ctx) => Boolean(ctx.sendError), label: 'Carry on to Fatima’s page', step: 'whatsapp-tab' },
    on: { 'careplan:confirm': 'careplan-confirm', 'careplan:sent': 'whatsapp-tab' },
  },
  {
    id: 'careplan-confirm',
    chapter: 'careplan',
    route: REVIEW,
    href: reviewHref,
    target: '[data-tour="review-confirm"]',
    placement: ['right', 'left', 'bottom', 'top'],
    title: 'A last look: who gets what',
    body: 'The exact number, the language and what goes in the message. From tonight, the patient also gets a check-in every evening.',
    action: <>Click <B>Send care plan</B></>,
    advance: 'wait',
    fallback: 'careplan-send',
    on: { 'careplan:sent': 'whatsapp-tab', 'careplan:failed': 'careplan-send' },
  },

  // ── WhatsApp ─────────────────────────────────────────────────────────
  {
    id: 'whatsapp-tab',
    chapter: 'whatsapp',
    route: PATIENT,
    href: (ctx) => (ctx.episodeId ? `/episodes/${ctx.episodeId}` : '/patients'),
    target: '[data-tour="tab-conversation"]',
    placement: ['bottom', 'right'],
    title: (ctx) => (ctx.sendError ? 'Fatima’s page' : ctx.ownPhone ? 'Sent. Look at your phone!' : 'Sent. Now look at WhatsApp'),
    body: (ctx) => ctx.ownPhone && !ctx.sendError
      ? 'The care plan just arrived on your WhatsApp, as Fatima would get it. Here, the conversation shows everything said on WhatsApp, both ways.'
      : 'Everything about Fatima is here. The conversation shows everything said on WhatsApp, both ways.',
    action: <>Open <B>Conversation</B></>,
    assist: '[data-tour="tab-conversation"]',
    advance: 'click',
    done: conversationShowing,
  },
  {
    id: 'whatsapp-conversation',
    chapter: 'whatsapp',
    route: PATIENT,
    href: patientHref,
    target: '[data-tour="conversation"]',
    placement: ['left', 'right', 'bottom'],
    title: 'Every message, live',
    body: (ctx) => ctx.sendError
      ? 'Everything said on WhatsApp appears here the moment it arrives: the care plan, check-in answers, questions and voice notes, translated for the nurse when the patient writes in another language.'
      : ctx.ownPhone
        ? 'The same messages you have on your phone, live. Replies, voice notes and check-in answers appear here the moment they arrive, translated for the nurse when the patient writes in another language.'
        : 'The care plan as Fatima received it. Replies, voice notes and check-in answers appear here the moment they arrive, translated for the nurse when the patient writes in another language.',
    advance: 'next',
    fallback: 'whatsapp-tab',
    on: { 'patient:replied': 'whatsapp-outcome', 'patient:alerted': 'whatsapp-outcome' },
  },
  {
    id: 'whatsapp-reply',
    chapter: 'whatsapp',
    route: PATIENT,
    href: patientHref,
    target: '[data-tour="patient-simulator"]',
    placement: ['top', 'bottom', 'left'],
    title: (ctx) => (ctx.ownPhone ? 'Now reply from your phone' : 'Now you are the patient'),
    body: (ctx) => ctx.ownPhone
      ? 'Answer the care plan on WhatsApp like a patient would: try “I have chest pain”, or ask about a medicine. Or write as Fatima in this box. Keep this page open and watch.'
      : 'We can’t hand you Fatima’s phone, so write as Fatima here. It runs through exactly the same pipeline as a real WhatsApp message. Try the chest pain one.',
    action: (ctx) => (ctx.ownPhone ? <>Reply on WhatsApp, or send a message here</> : <>Send a message as <B>Fatima</B></>),
    assist: '[data-tour="simulator-urgent"]',
    advance: 'wait',
    fallback: 'whatsapp-tab',
    on: { 'patient:replied': 'whatsapp-outcome', 'patient:alerted': 'whatsapp-outcome' },
  },
  {
    id: 'whatsapp-outcome',
    chapter: 'whatsapp',
    route: PATIENT,
    href: patientHref,
    target: (ctx) => (ctx.reply === 'alerted' ? '[data-tour="patient-alerts"]' : '[data-tour="conversation"]'),
    placement: ['bottom', 'left', 'right', 'top'],
    title: (ctx) => ctx.reply === 'alerted' ? 'Urgent: a nurse knows in seconds'
      : ctx.reply === 'answered' ? 'Answered from Fatima’s own care plan'
        : 'Fatima’s message is on its way',
    body: (ctx) => ctx.reply === 'alerted'
      ? `The message named a warning sign, so a critical alert went to every nurse’s dashboard and ${ctx.ownPhone ? 'your phone got' : 'Fatima got'} the emergency advice straight away. No one had to read it first.`
      : ctx.reply === 'answered'
        ? 'The assistant answered on WhatsApp using Fatima’s medicines and instructions. Anything it cannot answer safely goes to a nurse instead.'
        : 'The assistant is reading it, exactly as it reads every WhatsApp message a patient sends.',
    busy: (ctx) => (ctx.reply === 'waiting' || !ctx.reply ? 'Waiting for the reply…' : null),
    advance: 'next',
    fallback: 'whatsapp-tab',
    on: { 'patient:failed': 'whatsapp-reply' },
  },
  {
    id: 'whatsapp-nurse',
    chapter: 'whatsapp',
    route: PATIENT,
    href: patientHref,
    target: '[data-tour="nurse-composer"]',
    placement: ['top', 'bottom'],
    optional: true,
    title: 'A nurse can step in',
    body: 'Anything written here reaches Fatima on WhatsApp, translated into the patient’s language. The assistant stays quiet while a nurse is talking.',
    advance: 'next',
  },

  // ── Explore ──────────────────────────────────────────────────────────
  {
    id: 'explore-alerts',
    chapter: 'explore',
    route: null,
    href: () => '/',
    target: '[data-tour="nav-alerts"]',
    placement: ['right', 'bottom'],
    optional: true,
    title: 'Every alert in one place',
    body: 'Urgent symptoms, missed medicines, unconfirmed appointments and messages that didn’t arrive, most urgent first, with who picked each one up.',
    advance: 'next',
  },
  {
    id: 'explore-analytics',
    chapter: 'explore',
    route: null,
    href: () => '/',
    target: '[data-tour="nav-analytics"]',
    placement: ['right', 'bottom'],
    optional: true,
    title: 'Is it working?',
    body: 'Check-in replies, medicines taken and appointments kept, across the whole ward.',
    advance: 'next',
  },
  {
    id: 'explore-finish',
    chapter: 'explore',
    route: null,
    href: () => '/',
    target: '[data-tour="tour-button"]',
    placement: ['bottom', 'left'],
    title: 'That’s CareLoop',
    body: 'From a discharge letter to a patient looked after at home, in minutes. Explore anything: try another demo letter, send a check-in, or reply in Arabic. The tour is always here.',
    advance: 'next',
  },
]

export function stepIndex(id: string): number {
  return TOUR_STEPS.findIndex((s) => s.id === id)
}

export function resolve<T>(value: T | ((ctx: TourContext) => T), ctx: TourContext): T {
  return typeof value === 'function' ? (value as (ctx: TourContext) => T)(ctx) : value
}
