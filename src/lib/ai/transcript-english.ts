/**
 * "Show English" on the Conversation tab, without asking the model twice for
 * the same sentence.
 *
 * A follow-up conversation is mostly repetition: the same nightly check-in
 * goes out every evening, and the patient answers "1" or "I am fine". One
 * Tamil episode here holds 44 messages made of 8 distinct texts. Translating
 * per message id asked Gemini for the same sentence nine times, and when the
 * key was busy the nurse got a red banner instead of English we already had.
 *
 * So English is kept per *text*: a translation stored on any message of the
 * episode answers every other message that says the same thing, and each new
 * text is translated once and written onto all its copies.
 */

import type { MessageToTranslate } from './translation'

export interface TranscriptRow {
  id: string
  content: string | null
  metadata: Record<string, unknown> | null
}

/** Where a message keeps its English (never shown to the patient). */
export const ENGLISH_KEY = 'translation_en'

/** The English stored on this message, if any. */
export function keptEnglish(row: TranscriptRow): string | null {
  const en = row.metadata?.[ENGLISH_KEY]
  return typeof en === 'string' && en.trim() ? en : null
}

/** What a message says, as it is keyed for reuse. Empty means nothing to translate. */
export function textOf(row: TranscriptRow): string {
  return row.content?.trim() ?? ''
}

/** "1", "👍" and the like are the answer in any language: never worth a model call. */
export function worthTranslating(text: string): boolean {
  return /\p{L}/u.test(text)
}

/**
 * The English known for each text, from what is already stored on these rows.
 * The first row carrying a text wins, so pass them newest first.
 */
export function englishByText(rows: TranscriptRow[]): Map<string, string> {
  const byText = new Map<string, string>()
  for (const row of rows) {
    const text = textOf(row)
    const en = keptEnglish(row)
    if (text && en && !byText.has(text)) byText.set(text, en)
  }
  return byText
}

/**
 * What the model still has to read: one entry per distinct text among the
 * requested messages that no stored translation covers. The id is a message
 * that says it — the answer applies to every copy.
 */
export function textsToTranslate(
  rows: TranscriptRow[],
  requested: Iterable<string>,
  byText: Map<string, string>,
): MessageToTranslate[] {
  const ids = new Set(requested)
  const todo = new Map<string, MessageToTranslate>()
  for (const row of rows) {
    if (!ids.has(row.id)) continue
    const text = textOf(row)
    if (!text || !worthTranslating(text) || byText.has(text) || todo.has(text)) continue
    todo.set(text, { id: row.id, text })
  }
  return [...todo.values()]
}

/** The model answers by the id that stood for each text; file it under the text itself. */
export function keepByText(todo: MessageToTranslate[], fresh: Record<string, string>, byText: Map<string, string>): void {
  for (const item of todo) {
    const en = fresh[item.id]?.trim()
    if (en) byText.set(item.text, en)
  }
}

export interface SpreadEnglish {
  /** id → English for every message whose text is known: the whole transcript fills in at once. */
  translations: Record<string, string>
  /** Messages that do not yet carry the English for their own text. */
  writes: Array<{ id: string; en: string }>
}

/** Fans what is known out over every copy of each text. */
export function spreadEnglish(rows: TranscriptRow[], byText: Map<string, string>): SpreadEnglish {
  const translations: Record<string, string> = {}
  const writes: Array<{ id: string; en: string }> = []
  for (const row of rows) {
    const en = byText.get(textOf(row))
    if (!en) continue
    translations[row.id] = en
    if (keptEnglish(row) !== en) writes.push({ id: row.id, en })
  }
  return { translations, writes }
}
