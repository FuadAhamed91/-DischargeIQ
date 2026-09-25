/**
 * The patient's WhatsApp number on Add patient: how it is tidied as it is
 * typed, and the line under the field that says what it should look like,
 * what is wrong with it, or that it is right.
 */

import { formatPhone } from '@/lib/format'

/** E.164: +, the country code and the number, 7 to 15 digits in all (what the server accepts too). */
export const E164 = /^\+[1-9]\d{6,14}$/

/** Spaces, brackets and dashes out; a leading 00 (the international prefix) becomes +. */
export function tidyPhone(typed: string): string {
  return typed.replace(/[\s()-]/g, '').replace(/^00/, '+')
}

export interface PhoneLine {
  tone: 'hint' | 'error' | 'ok'
  text: string
  /** The number it was probably meant to be (a UAE mobile typed the local way). */
  fix?: string
}

export function phoneLine(raw: string): PhoneLine {
  const v = raw.trim()
  if (!v) return { tone: 'hint', text: 'With the country code, e.g. +971 50 123 4567.' }
  if (/^05\d{8}$/.test(v)) return { tone: 'error', text: 'Add the country code: +971 in place of the first 0.', fix: `+971${v.slice(1)}` }
  if (!v.startsWith('+')) return { tone: 'error', text: 'Start with + and the country code, e.g. +971 50 123 4567.' }
  if (!/^\+\d*$/.test(v)) return { tone: 'error', text: 'Only digits after the +, e.g. +971 50 123 4567.' }
  if (v.startsWith('+0')) return { tone: 'error', text: 'A country code never starts with 0. The UAE’s is +971.' }
  if (v.startsWith('+9710')) return { tone: 'error', text: 'Drop the 0 after +971: +971 50…, not +971 050….', fix: `+971${v.slice(5)}` }
  const digits = v.length - 1
  if (digits > 15) return { tone: 'error', text: 'Too long: a phone number has at most 15 digits after the +.' }
  if (v.startsWith('+9715') && digits > 12) return { tone: 'error', text: 'Too long: a UAE mobile is +971 and 9 more digits.' }
  // Still being typed: not wrong yet, just not finished.
  if (!E164.test(v) || (v.startsWith('+9715') && digits < 12)) return { tone: 'hint', text: 'Keep going: the country code, then the number.' }
  return { tone: 'ok', text: formatPhone(v) }
}
