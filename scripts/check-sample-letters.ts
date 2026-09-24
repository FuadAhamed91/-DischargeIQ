/**
 * Checks for the sample discharge letters (lib/intake/sample-letters.ts) and
 * the PDF writer behind them (lib/pdf/text-pdf.ts): every letter prints to a
 * PDF that the intake's own reader (unpdf) can read back, is recognised from
 * that text with the dates printed on it, and the built-in reading of it is
 * one the intake accepts. The docs/ copies must be recognised too, with
 * their own dates. Adding a sample patient again closes their open care
 * plan (lib/intake/sample-restart.ts). No keys, no network.
 *
 * Run with:  npm run check:sample-letters
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractTextFromPdf, hasMeaningfulContent } from '@/lib/ai/extraction'
import { IntakeCommitSchema } from '@/lib/intake/validate'
import {
  SAMPLE_LETTERS, isSampleMrn, recogniseSampleLetter, sampleExtraction, sampleLetterBlocks,
} from '@/lib/intake/sample-letters'
import { renderTextPdf, wrapText } from '@/lib/pdf/text-pdf'
import { closeSampleEpisode } from '@/lib/intake/sample-restart'
import { FakeDb } from './lib/fake-supabase'
import type { SupabaseClient } from '@supabase/supabase-js'

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

async function main() {
  eq('wrap keeps short text on one line', wrapText('Keep your follow-up appointments.', 'regular', 10, 400), ['Keep your follow-up appointments.'])
  eq('wrap breaks at spaces within the width', wrapText('aaaa bbbb cccc', 'regular', 10, 50).length, 2)
  eq('wrap splits a word longer than a line', wrapText('x'.repeat(200), 'regular', 10, 100).every((l) => l.length > 0 && l.length < 200), true)

  const discharge = '2026-10-05'
  for (const letter of SAMPLE_LETTERS) {
    const pdf = renderTextPdf(sampleLetterBlocks(letter, discharge), { title: letter.patient.full_name })
    eq(`${letter.id}: is a PDF`, new TextDecoder('latin1').decode(pdf.slice(0, 8)), '%PDF-1.4')

    const text = await extractTextFromPdf(Buffer.from(pdf))
    eq(`${letter.id}: reads back with its name and MRN`, text.includes(letter.patient.full_name) && text.includes(letter.patient.mrn), true)
    eq(`${letter.id}: long enough for the intake (≥ 30 words)`, text.split(/\s+/).filter(Boolean).length >= 30, true)

    const found = recogniseSampleLetter(text)
    eq(`${letter.id}: recognised with the printed discharge date`, found && { id: found.letter.id, discharge: found.discharge }, { id: letter.id, discharge })

    const x = sampleExtraction(letter, discharge)
    eq(`${letter.id}: reading has content`, hasMeaningfulContent(x), true)
    eq(`${letter.id}: dates follow the discharge day`, [x.encounter?.discharge_date, x.follow_up_requirements.every((f) => f.deadline! > discharge)], [discharge, true])
    const commit = IntakeCommitSchema.safeParse({
      patient: { full_name: x.patient!.full_name, mrn: x.patient!.mrn, phone_e164: '+971500000000', preferred_language: 'en', date_of_birth: x.patient!.date_of_birth, gender: x.patient!.gender, nationality: x.patient!.nationality },
      episode: { discharge_date: discharge, diagnosis: x.encounter!.diagnosis, admission_date: x.encounter!.admission_date, ward: x.encounter!.ward, attending_physician: x.encounter!.attending_physician },
      extraction: x,
    })
    eq(`${letter.id}: reading passes the commit schema`, commit.success ? true : commit.error.issues[0], true)
    eq(`${letter.id}: MRN counts as a sample patient`, isSampleMrn(letter.patient.mrn.toLowerCase()), true)
  }

  // The same letters as committed PDFs in docs/: recognised with their own dates.
  const docs: Array<[string, string, string]> = [
    ['sample-discharge-summary.pdf', 'fatima-al-hashimi', '2026-09-19'],
    ['sample-discharge-summary-umar-siddiqui.pdf', 'umar-siddiqui', '2026-09-21'],
    ['sample-discharge-summary-farzana-arif.pdf', 'farzana-arif', '2026-09-19'],
  ]
  for (const [file, id, date] of docs) {
    const text = await extractTextFromPdf(readFileSync(join(process.cwd(), 'docs', file)))
    const found = recogniseSampleLetter(text)
    eq(`docs/${file}: recognised`, found && { id: found.letter.id, discharge: found.discharge }, { id, discharge: date })
  }
  const fatima = sampleExtraction(SAMPLE_LETTERS[0], '2026-09-19')
  eq('docs dates match the printed ones (Fatima)', [fatima.encounter?.admission_date, ...fatima.follow_up_requirements.map((f) => f.deadline)], ['2026-09-12', '2026-10-03', '2026-09-26', '2026-12-19'])

  eq('another letter is not a sample', recogniseSampleLetter('Patient name: Someone Else MRN / File number: X-1 Discharge date: 01/10/2026'), null)
  eq('a sample name without its MRN is not enough', recogniseSampleLetter('Patient name: Umar Siddiqui MRN / File number: OTHER-1 Discharge date: 01/10/2026'), null)
  eq('an impossible date is not read', recogniseSampleLetter('Patient name: Umar Siddiqui DGH-2026-0611 Discharge date: 31/02/2026'), null)
  eq('other MRNs are not sample patients', isSampleMrn('DGH-2024-001'), false)

  // A sample patient added again: the open episode is closed and its loose ends tidied.
  const db = new FakeDb({
    care_episodes: [{ id: 'old', status: 'active', ended_at: null }, { id: 'other', status: 'active', ended_at: null }],
    alerts: [{ id: 'a1', episode_id: 'old', status: 'open' }, { id: 'a2', episode_id: 'old', status: 'resolved' }, { id: 'a3', episode_id: 'other', status: 'open' }],
    reminder_jobs: [{ id: 'j1', episode_id: 'old', status: 'pending' }, { id: 'j2', episode_id: 'old', status: 'sent' }],
    appointments: [{ id: 'p1', episode_id: 'old', status: 'confirmation_pending' }, { id: 'p2', episode_id: 'old', status: 'confirmed' }],
  })
  eq('restart closes the episode', await closeSampleEpisode(db as unknown as SupabaseClient, 'old'), true)
  const status = (table: string) => db.rows(table).map((r) => `${r.id}:${r.status}`)
  eq('episode completed, the other untouched', status('care_episodes'), ['old:completed', 'other:active'])
  eq('its open alerts resolved', status('alerts'), ['a1:resolved', 'a2:resolved', 'a3:open'])
  eq('its pending jobs cancelled', status('reminder_jobs'), ['j1:cancelled', 'j2:sent'])
  eq('its unconfirmed appointments cancelled', status('appointments'), ['p1:cancelled', 'p2:confirmed'])

  console.log(fails ? `\n${fails} check(s) failed` : '\nall sample-letter checks passed')
  process.exit(fails ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
