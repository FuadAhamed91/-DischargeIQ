/**
 * Checks for the guided tour (components/tour) and the demo patient replies,
 * so a renamed button or a moved card can't quietly break the judges' walk
 * through the app:
 *   - every step id is unique, chapters run in order, and every step a signal,
 *     a fallback or a recovery points to exists
 *   - every element the tour lights up, clicks or drags between carries its
 *     data-tour marker somewhere in src/ (the demo letters' by their ids)
 *   - each step's "Resume" address is on the page the step runs on
 *   - a step that ends on a new page is followed by a step on another page
 *   - each language's urgent demo reply is caught by the emergency check (it
 *     must raise a critical alert without the AI), and the questions are not
 *
 * No network or API keys needed. Run with:  npm run check:tour
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CHAPTERS, TOUR_STEPS, resolve, type TourContext } from '@/components/tour/tour-steps'
import { DEMO_REPLIES } from '@/lib/whatsapp/demo-replies'
import { SAMPLE_LETTERS } from '@/lib/intake/sample-letters'
import { classifyPreIntent } from '@/lib/ai/intent'

let fails = 0
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `  (${detail})` : ''}`)
}

// Every data-tour marker in the source: fixed ones, and the prefixes of the ones built from a value.
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : []
  })
}
const source = sourceFiles('src').map((f) => readFileSync(f, 'utf8')).join('\n')
// An element's attribute, not a selector looking for one ([data-tour="…"]).
const fixed = new Set([...source.matchAll(/(?<!\[)data-tour="([^"]+)"/g)].map((m) => m[1]))
const templated = [...source.matchAll(/data-tour=\{`([^`$]*)\$\{/g)].map((m) => m[1])
// data-tour={i === 0 ? 'simulator-urgent' : undefined}, and a card's tourId="review-medicines"
const conditional = [...source.matchAll(/data-tour=\{[^}]*'([a-z-]+)'/g), ...source.matchAll(/tourId="([^"]+)"/g)].map((m) => m[1])
for (const marker of conditional) fixed.add(marker)
const letterIds = new Set(SAMPLE_LETTERS.map((l) => l.id))
function hasMarker(value: string): boolean {
  if (fixed.has(value)) return true
  if (value.startsWith('sample-letter-')) return templated.includes('sample-letter-') && letterIds.has(value.slice('sample-letter-'.length))
  // Sidebar links are marked nav-<label>: the label must be one of the links.
  if (value.startsWith('nav-')) {
    const label = value.slice(4)
    return templated.includes('nav-') && source.includes(`label: '${label.charAt(0).toUpperCase()}${label.slice(1)}'`)
  }
  return templated.some((prefix) => prefix && value.startsWith(prefix))
}
const markerOf = (selector: string) => /^\[data-tour="([^"]+)"\]$/.exec(selector)?.[1] ?? null

console.log('— steps —')
const ids = TOUR_STEPS.map((s) => s.id)
check('step ids are unique', new Set(ids).size === ids.length)
const chapterOrder = TOUR_STEPS.map((s) => CHAPTERS.findIndex((c) => c.id === s.chapter))
check('every step is in a chapter', chapterOrder.every((i) => i >= 0))
check('chapters run in order', chapterOrder.every((c, i) => i === 0 || c >= chapterOrder[i - 1]))
check('every chapter has steps', CHAPTERS.every((c) => TOUR_STEPS.some((s) => s.chapter === c.id)))
for (const step of TOUR_STEPS) {
  const targets = [...Object.values(step.on ?? {}), step.fallback, step.recover?.step].filter((t): t is string => Boolean(t) && t !== 'next')
  const missing = targets.filter((t) => !ids.includes(t))
  if (targets.length) check(`${step.id}: the steps it can open exist`, missing.length === 0, missing.join(', '))
}

console.log('— what the tour points at —')
const contexts: TourContext[] = [{}, { reply: 'waiting' }, { reply: 'answered' }, { reply: 'alerted' }, { sendError: 'x' }]
for (const step of TOUR_STEPS) {
  const selectors = new Set<string>()
  for (const ctx of contexts) {
    const target = resolve(step.target, ctx)
    if (target) selectors.add(target)
  }
  if (step.assist) selectors.add(step.assist)
  if (step.drag) { selectors.add(step.drag.from); selectors.add(step.drag.to) }
  for (const selector of selectors) {
    const marker = markerOf(selector)
    check(`${step.id}: ${selector} is on a page`, marker !== null && hasMarker(marker), marker === null ? 'not a [data-tour="…"] selector' : 'no element carries it')
  }
  if (step.advance === 'click' || step.advance === 'route') check(`${step.id}: a ${step.advance} step lights something up`, selectors.size > 0)
}

console.log('— pages —')
const episode = '0f0e0d0c-0b0a-4908-8706-050403020100'
for (const step of TOUR_STEPS) {
  if (!step.route) continue
  const path = step.href({ episodeId: episode }).split('?')[0]
  check(`${step.id}: Resume opens its page (${path})`, step.route.test(path))
}
TOUR_STEPS.forEach((step, i) => {
  if (step.advance !== 'route') return
  const next = TOUR_STEPS[i + 1]
  const nextPath = next?.href({ episodeId: episode }).split('?')[0] ?? ''
  check(`${step.id}: ends on the next step's page`, Boolean(next?.route) && !step.route?.test(nextPath) && Boolean(next.route?.test(nextPath)))
})

console.log('— demo patient replies —')
for (const [language, replies] of Object.entries(DEMO_REPLIES)) {
  const urgent = replies.filter((r) => r.urgent)
  check(`${language}: one urgent reply`, urgent.length === 1)
  for (const reply of replies) {
    const intent = classifyPreIntent(reply.text)
    check(`${language}: "${reply.gloss ?? reply.text}" ${reply.urgent ? 'raises an emergency' : 'goes to the assistant'}`,
      reply.urgent ? intent === 'emergency' : intent !== 'emergency', intent)
  }
}

console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
