/**
 * The times a patient is offered when they ask to change an appointment on
 * WhatsApp, and how their answer is read.
 *
 * There is no hospital booking system behind CareLoop yet (scheduling
 * adapter "manual"), so the options are the next clinic days after the
 * current appointment, at the same time of day: a patient who cannot make
 * Monday 09:00 is offered Tuesday, Wednesday and Thursday at 09:00. Clinic
 * days default to Monday–Friday; a hospital overrides them in
 * hospitals.settings.clinic_days (ISO weekdays, 1 = Monday … 7 = Sunday).
 *
 * Everything here is pure so it can be table-tested (scripts/check-reschedule.ts).
 */

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { normaliseMessage } from '@/lib/ai/intent'

export const DEFAULT_CLINIC_DAYS = [1, 2, 3, 4, 5]
export const SLOT_OPTION_COUNT = 3

export function resolveClinicDays(settings: unknown): number[] {
  const value = settings && typeof settings === 'object' ? (settings as { clinic_days?: unknown }).clinic_days : undefined
  const days = Array.isArray(value) ? value.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7) : []
  return days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : DEFAULT_CLINIC_DAYS
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** "Mon–Fri" for a run of days, "Mon, Wed, Sat" otherwise. */
export function describeClinicDays(days: number[]): string {
  const run = days.length > 2 && days.every((d, i) => i === 0 || d === days[i - 1] + 1)
  return run ? `${DAY_NAMES[days[0] - 1]}–${DAY_NAMES[days[days.length - 1] - 1]}` : days.map((d) => DAY_NAMES[d - 1]).join(', ')
}

/**
 * The next `count` clinic days after the current appointment (after today,
 * if it has already passed), at the appointment's time of day.
 */
export function proposeSlots(params: {
  current: string
  now: Date
  timezone: string
  clinicDays: number[]
  count?: number
}): string[] {
  const { current, now, timezone, clinicDays, count = SLOT_OPTION_COUNT } = params
  const at = new Date(current)
  const time = formatInTimeZone(at, timezone, 'HH:mm')
  const appointmentDay = formatInTimeZone(at, timezone, 'yyyy-MM-dd')
  const today = formatInTimeZone(now, timezone, 'yyyy-MM-dd')
  const [y, m, d] = (appointmentDay > today ? appointmentDay : today).split('-').map(Number)
  const slots: string[] = []
  // Calendar days are counted in UTC, where adding a day never skips or repeats a date.
  for (let i = 1; slots.length < count && i <= 31; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i))
    if (!clinicDays.includes(day.getUTCDay() || 7)) continue
    slots.push(fromZonedTime(`${day.toISOString().slice(0, 10)}T${time}:00`, timezone).toISOString())
  }
  return slots
}

// ------------------------------------
// Reading the answer
// ------------------------------------

export type SlotReply =
  | { kind: 'number'; n: number }
  | { kind: 'none' }
  | { kind: 'date'; day: number | null; month: number | null; weekday: number | null }
  | { kind: 'text' }

/** "None of these", as the whole message, in the five supported languages. */
const NONE = new Set([
  'none', 'none of these', 'none of them', 'none of those', 'neither', 'no', 'nope', 'not these', 'none suit', 'none work',
  'لا', 'ولا واحد', 'لا شيء', 'لا يناسبني',
  'कोई नहीं', 'कोई भी नहीं', 'नहीं', 'इनमें से कोई नहीं', 'koi nahi', 'nahi',
  'இல்லை', 'எதுவும் இல்லை', 'எதுவும் பொருந்தவில்லை',
  'wala', 'wala po', 'wala sa mga ito', 'hindi po',
])

/** Month names as patients type them, in the five supported languages (after normaliseMessage). */
const MONTHS = new Map<string, number>(Object.entries({
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6,
  july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
  enero: 1, pebrero: 2, marso: 3, abril: 4, mayo: 5, hunyo: 6, hulyo: 7, agosto: 8, setyembre: 9, oktubre: 10, nobyembre: 11, disyembre: 12,
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5, 'يونيو': 6, 'يونيه': 6, 'يوليو': 7, 'يوليه': 7,
  'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
  'जनवरी': 1, 'फरवरी': 2, 'फ़रवरी': 2, 'मार्च': 3, 'अप्रैल': 4, 'मई': 5, 'जून': 6, 'जुलाई': 7, 'अगस्त': 8,
  'सितंबर': 9, 'सितम्बर': 9, 'अक्टूबर': 10, 'अक्तूबर': 10, 'नवंबर': 11, 'नवम्बर': 11, 'दिसंबर': 12, 'दिसम्बर': 12,
  'ஜனவரி': 1, 'பிப்ரவரி': 2, 'மார்ச்': 3, 'ஏப்ரல்': 4, 'மே': 5, 'ஜூன்': 6, 'ஜூலை': 7, 'ஆகஸ்ட்': 8,
  'செப்டம்பர்': 9, 'அக்டோபர்': 10, 'நவம்பர்': 11, 'டிசம்பர்': 12,
}))

/** ISO weekday (1 = Monday) by name, in the five supported languages. */
const WEEKDAYS = new Map<string, number>(Object.entries({
  monday: 1, mon: 1, tuesday: 2, tues: 2, tue: 2, wednesday: 3, wed: 3, thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7,
  lunes: 1, martes: 2, miyerkules: 3, miyerkoles: 3, huwebes: 4, biyernes: 5, sabado: 6, linggo: 7,
  'الاثنين': 1, 'الإثنين': 1, 'الثلاثاء': 2, 'الأربعاء': 3, 'الاربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6, 'الأحد': 7, 'الاحد': 7,
  'सोमवार': 1, 'मंगलवार': 2, 'बुधवार': 3, 'गुरुवार': 4, 'बृहस्पतिवार': 4, 'शुक्रवार': 5, 'शनिवार': 6, 'रविवार': 7,
  'திங்கள்': 1, 'திங்கட்கிழமை': 1, 'செவ்வாய்': 2, 'செவ்வாய்க்கிழமை': 2, 'புதன்': 3, 'புதன்கிழமை': 3,
  'வியாழன்': 4, 'வியாழக்கிழமை': 4, 'வெள்ளி': 5, 'வெள்ளிக்கிழமை': 5, 'சனி': 6, 'சனிக்கிழமை': 6, 'ஞாயிறு': 7, 'ஞாயிற்றுக்கிழமை': 7,
}))

/** Words around a bare number that do not change it: "option 2", "2 please", "number 2 is fine". */
const FILLER = new Set([
  'option', 'number', 'no', 'num', 'choice', 'slot', 'please', 'pls', 'plz', 'ok', 'okay', 'i', 'want', 'choose',
  'take', 'pick', 'the', 'is', 'fine', 'good', 'one', 'time',
  'رقم', 'الرقم', 'خيار', 'الخيار', 'नंबर', 'विकल्प', 'जी', 'ji', 'numero', 'po', 'yung', 'ang', 'எண்',
])

/** Words a date on its own may come with: "I can come on the 6th", "Tuesday please". */
const DATE_FILLER = new Set([
  'on', 'the', 'of', 'please', 'pls', 'plz', 'ok', 'okay', 'i', 'can', 'will', 'come', 'want', 'take', 'choose', 'pick',
  'prefer', 'is', 'fine', 'good', 'better', 'that', 'this', 'one', 'date', 'day',
  'في', 'يوم', 'को', 'जी', 'ji', 'sa', 'po',
])

/** ٢ ۲ २ ௨ → 2: an answer typed in the patient's own digits. */
function asciiDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹०-९௦-௯]/g, (ch) => {
    const code = ch.charCodeAt(0)
    const zero = code >= 0x0BE6 ? 0x0BE6 : code >= 0x0966 ? 0x0966 : code >= 0x06F0 ? 0x06F0 : 0x0660
    return String(code - zero)
  })
}

const isDayToken = (w: string | undefined) => w !== undefined && /^\d{1,2}(st|nd|rd|th)?$/.test(w)
const isDateWord = (w: string) => isDayToken(w) || /^\d{4}$/.test(w) || MONTHS.has(w) || WEEKDAYS.has(w) || DATE_FILLER.has(w)

/**
 * A number from the list, "none of these", a date on its own ("6th October",
 * "Tue", "6/10"), or anything else. Only a message that is nothing but a
 * date reads as one: "can't make the 6th, my leg is swollen" is text, for the
 * assistant, which looks for warning signs.
 */
export function parseSlotReply(text: string): SlotReply {
  // Keycaps ("2️⃣") and other scripts' digits read as plain digits.
  const norm = normaliseMessage(asciiDigits(text.replace(/[️⃣]/g, '')))
  const words = norm.split(' ').filter(Boolean)

  const numbers = words.filter((w) => /^\d{1,2}$/.test(w))
  if (numbers.length === 1 && words.every((w) => w === numbers[0] || FILLER.has(w))) {
    return { kind: 'number', n: Number(numbers[0]) }
  }
  if (NONE.has(norm)) return { kind: 'none' }
  if (words.length === 0 || !words.every(isDateWord)) return { kind: 'text' }

  let day: number | null = null
  let month: number | null = null
  let weekday: number | null = null
  const bare: number[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const ordinal = w.match(/^(\d{1,2})(?:st|nd|rd|th)$/)
    if (ordinal) {
      day ??= Number(ordinal[1])
      continue
    }
    if (/^\d{1,2}$/.test(w)) {
      bare.push(Number(w))
      continue
    }
    // "may" is a month only next to a day: "may I come later?" is not a date.
    const m = MONTHS.get(w)
    if (m && (w !== 'may' || isDayToken(words[i - 1]) || isDayToken(words[i + 1]))) {
      month ??= m
      continue
    }
    weekday ??= WEEKDAYS.get(w) ?? null
  }
  if (day === null) {
    if (month === null && bare.length >= 2 && bare[1] >= 1 && bare[1] <= 12) {
      // "6/10", "06-10-2026": day first, as written in the Gulf
      day = bare[0]
      month = bare[1]
    } else if ((month !== null || weekday !== null) && bare.length === 1) {
      day = bare[0]   // "6 Oct", "Tuesday 6"
    }
  }
  if (day !== null && (day < 1 || day > 31)) return { kind: 'text' }
  if (day === null && weekday === null) return { kind: 'text' }
  return { kind: 'date', day, month, weekday }
}

export type SlotChoice =
  | { kind: 'slot'; index: number }
  | { kind: 'none' }                       // the extra number, or "none of these"
  | { kind: 'invalid' }                    // a number not on the list, or a date that fits several times
  | { kind: 'preference'; text: string }   // a date that is not on the list: a nurse arranges it

function falls(at: string, date: { day: number | null; month: number | null; weekday: number | null }, timezone: string): boolean {
  const [day, month, weekday] = formatInTimeZone(new Date(at), timezone, 'd M i').split(' ').map(Number)
  return (date.day === null || date.day === day)
    && (date.month === null || date.month === month)
    && (date.weekday === null || date.weekday === weekday)
}

/** Reads a reply against the times offered (`slots`, in the order they were listed). */
export function interpretSlotReply(text: string, slots: string[], timezone: string): SlotChoice {
  const reply = parseSlotReply(text)
  if (reply.kind === 'none') return { kind: 'none' }
  if (reply.kind === 'number') {
    if (reply.n >= 1 && reply.n <= slots.length) return { kind: 'slot', index: reply.n - 1 }
    return reply.n === slots.length + 1 ? { kind: 'none' } : { kind: 'invalid' }
  }
  if (reply.kind === 'date') {
    const hits = slots.flatMap((at, index) => (falls(at, reply, timezone) ? [index] : []))
    if (hits.length === 1) return { kind: 'slot', index: hits[0] }
    if (hits.length > 1) return { kind: 'invalid' }
    // "2nd" alone, and no time on the 2nd was offered: the second option.
    if (reply.day !== null && reply.month === null && reply.weekday === null && reply.day <= slots.length) {
      return { kind: 'slot', index: reply.day - 1 }
    }
  }
  return { kind: 'preference', text: text.trim() }
}
