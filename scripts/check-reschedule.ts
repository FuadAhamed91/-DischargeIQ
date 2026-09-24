/**
 * Table-driven checks for the pure parts of the WhatsApp reschedule flow:
 *   - lib/appointments/slots.ts               the times offered, and how a reply is read
 *   - lib/whatsapp/appointment-templates.ts   the numbered list and the nurse hand-off, per language
 *
 * The flow end to end (offer → reply → the appointment moves) is in
 * scripts/check-webhook.ts. No network or API keys needed.
 * Run with:  npm run check:reschedule
 */
import { formatInTimeZone } from 'date-fns-tz'
import {
  proposeSlots,
  resolveClinicDays,
  describeClinicDays,
  parseSlotReply,
  interpretSlotReply,
  DEFAULT_CLINIC_DAYS,
} from '@/lib/appointments/slots'
import { buildRescheduleOptions, buildRescheduleNurseReply } from '@/lib/whatsapp/appointment-templates'
import type { LanguageCode } from '@/types/enums'

let fails = 0
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) fails++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} → ${JSON.stringify(got)}${ok ? '' : `  (want ${JSON.stringify(want)})`}`)
}

const TZ = 'Asia/Dubai'
const local = (iso: string, tz = TZ) => formatInTimeZone(new Date(iso), tz, 'EEE d MMM HH:mm')
const now = new Date('2026-09-24T08:00:00Z')              // Thursday 24 Sep, 12:00 in Dubai
const monday9 = '2026-10-05T05:00:00.000Z'                // Monday 5 Oct, 09:00 in Dubai
const thursday1430 = '2026-10-08T10:30:00.000Z'           // Thursday 8 Oct, 14:30 in Dubai

console.log('— clinic days —')
eq('default: Monday to Friday', resolveClinicDays({}), [1, 2, 3, 4, 5])
eq('hospital override, tidied', resolveClinicDays({ clinic_days: [6, 1, 2, 3, 4, 5, 5] }), [1, 2, 3, 4, 5, 6])
eq('nonsense → default', resolveClinicDays({ clinic_days: ['mon', 9] }), DEFAULT_CLINIC_DAYS)
eq('no settings → default', resolveClinicDays(null), DEFAULT_CLINIC_DAYS)
eq('a run reads as a range', describeClinicDays([1, 2, 3, 4, 5]), 'Mon–Fri')
eq('otherwise a list', describeClinicDays([1, 3, 6]), 'Mon, Wed, Sat')

console.log('— the times offered —')
const offered = proposeSlots({ current: monday9, now, timezone: TZ, clinicDays: DEFAULT_CLINIC_DAYS })
eq('Monday 09:00 → the next three days at 09:00', offered.map((s) => local(s)), ['Tue 6 Oct 09:00', 'Wed 7 Oct 09:00', 'Thu 8 Oct 09:00'])
eq('stored as instants', offered[0], '2026-10-06T05:00:00.000Z')
eq('Thursday 14:30 → the weekend is skipped', proposeSlots({ current: thursday1430, now, timezone: TZ, clinicDays: DEFAULT_CLINIC_DAYS }).map((s) => local(s)), ['Fri 9 Oct 14:30', 'Mon 12 Oct 14:30', 'Tue 13 Oct 14:30'])
eq('…unless the clinic opens on Saturdays', proposeSlots({ current: thursday1430, now, timezone: TZ, clinicDays: [1, 2, 3, 4, 5, 6] }).map((s) => local(s)), ['Fri 9 Oct 14:30', 'Sat 10 Oct 14:30', 'Mon 12 Oct 14:30'])
eq('an appointment already past → from tomorrow', proposeSlots({ current: '2026-09-01T05:00:00.000Z', now, timezone: TZ, clinicDays: DEFAULT_CLINIC_DAYS }).map((s) => local(s)), ['Fri 25 Sep 09:00', 'Mon 28 Sep 09:00', 'Tue 29 Sep 09:00'])
const london = proposeSlots({ current: '2026-10-23T08:00:00.000Z', now, timezone: 'Europe/London', clinicDays: DEFAULT_CLINIC_DAYS })
eq('clocks going back: still 09:00 on the clinic wall', london.map((s) => local(s, 'Europe/London')), ['Mon 26 Oct 09:00', 'Tue 27 Oct 09:00', 'Wed 28 Oct 09:00'])
eq('…which is 09:00 UTC once summer time ends', london[0], '2026-10-26T09:00:00.000Z')

console.log('— reading a reply —')
const kind = (text: string) => {
  const r = parseSlotReply(text)
  if (r.kind === 'number') return `number ${r.n}`
  if (r.kind === 'date') return `date ${r.day ?? '-'}/${r.month ?? '-'} weekday ${r.weekday ?? '-'}`
  return r.kind
}
eq('"2"', kind('2'), 'number 2')
eq('"2️⃣"', kind('2️⃣'), 'number 2')
eq('"٢" (Arabic digit)', kind('٢'), 'number 2')
eq('"option 3"', kind('option 3'), 'number 3')
eq('"number 1 please"', kind('number 1 please'), 'number 1')
eq('"6th October"', kind('6th October'), 'date 6/10 weekday -')
eq('"October 6"', kind('October 6'), 'date 6/10 weekday -')
eq('"6 oct"', kind('6 oct'), 'date 6/10 weekday -')
eq('"6/10"', kind('6/10'), 'date 6/10 weekday -')
eq('"06-10-2026"', kind('06-10-2026'), 'date 6/10 weekday -')
eq('"Tuesday"', kind('Tuesday'), 'date -/- weekday 2')
eq('"٦ أكتوبر"', kind('٦ أكتوبر'), 'date 6/10 weekday -')
eq('"6 अक्टूबर"', kind('6 अक्टूबर'), 'date 6/10 weekday -')
eq('"7 may"', kind('7 may'), 'date 7/5 weekday -')
eq('"I can come on the 6th"', kind('I can come on the 6th'), 'date 6/- weekday -')
eq('"none of these"', kind('None of these!'), 'none')
eq('"no"', kind('no'), 'none')
eq('"कोई नहीं"', kind('कोई नहीं'), 'none')
eq('"no 2" is still a number', kind('no 2'), 'number 2')
eq('"may I come later?"', kind('may I come later?'), 'text')
eq('"after 3 weeks"', kind('after 3 weeks'), 'text')
eq('"10:30"', kind('10:30'), 'text')
eq('"morning please"', kind('morning please'), 'text')
eq('a date inside a sentence is not a date reply', kind("can't make the 6th, my leg is swollen"), 'text')
eq('"6 October at 9"', kind('6 October at 9'), 'text')

console.log('— against the times offered (Tue 6, Wed 7, Thu 8 Oct) —')
const read = (text: string, slots = offered) => {
  const c = interpretSlotReply(text, slots, TZ)
  if (c.kind === 'slot') return `option ${c.index + 1}`
  return c.kind === 'preference' ? `nurse: ${c.text}` : c.kind
}
eq('"1"', read('1'), 'option 1')
eq('"3"', read('3'), 'option 3')
eq('"4": none of these', read('4'), 'none')
eq('"none"', read('none'), 'none')
eq('"5": not on the list', read('5'), 'invalid')
eq('"6th October": the date of option 1', read('6th October'), 'option 1')
eq('"wednesday"', read('wednesday'), 'option 2')
eq('"8/10"', read('8/10'), 'option 3')
eq('"2nd": no time on the 2nd, so the second option', read('2nd'), 'option 2')
eq('"12th October": a date of their own', read('12th October'), 'nurse: 12th October')
eq('"monday": no Monday on offer', read('monday'), 'nurse: monday')
eq('"tuesday" when two Tuesdays are on offer', read('tuesday', ['2026-10-06T05:00:00.000Z', '2026-10-13T05:00:00.000Z']), 'invalid')

console.log('— the list, in every language —')
const bodyOf = (m: unknown) => (m as { body: string }).body
for (const language of ['en', 'ar', 'hi', 'ta', 'tl'] as LanguageCode[]) {
  const list = bodyOf(buildRescheduleOptions({ to: 'x', patientName: 'Umar Siddiqui', language, specialty: 'Cardiology', slots: offered, timezone: TZ }))
  eq(`${language}: named, three numbered times, and 4 for none`, [
    list.includes('Umar Siddiqui'),
    list.includes('*1* — Tuesday, 6 October'),
    list.includes('*3* — Thursday, 8 October'),
    list.includes('*4*'),
  ], [true, true, true, true])
  const nurse = bodyOf(buildRescheduleNurseReply({ to: 'x', patientName: 'Umar Siddiqui', language, specialty: 'Cardiology' }))
  eq(`${language}: the nurse hand-off names the appointment`, [nurse.includes('Umar Siddiqui'), nurse.includes('*Cardiology*')], [true, true])
}
const english = bodyOf(buildRescheduleOptions({ to: 'x', patientName: 'Umar Siddiqui', language: 'en', specialty: 'Cardiology', slots: offered, timezone: TZ }))
eq('English list reads as a sentence', english.includes('*1* — Tuesday, 6 October at 09:00\n*2* — Wednesday, 7 October at 09:00'), true)
eq('a reply we could not read opens differently', bodyOf(buildRescheduleOptions({ to: 'x', patientName: 'Umar Siddiqui', language: 'en', specialty: 'Cardiology', slots: offered, timezone: TZ, intro: 'again' })).startsWith('Sorry Umar Siddiqui'), true)

console.log(fails === 0 ? '\nALL PASSED' : `\n${fails} FAILED`)
process.exit(fails ? 1 : 0)
