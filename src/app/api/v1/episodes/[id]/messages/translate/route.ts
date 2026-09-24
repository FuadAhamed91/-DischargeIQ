import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { translateMessagesToEnglish } from '@/lib/ai/translation'
import { ENGLISH_KEY, englishByText, keepByText, spreadEnglish, textsToTranslate } from '@/lib/ai/transcript-english'
import type { TranscriptRow } from '@/lib/ai/transcript-english'
import { GeminiUnavailableError } from '@/lib/ai/gemini'

// Gemini batches run side by side, each within a 40 s budget.
export const maxDuration = 60

const TranslateSchema = z.object({
  ids: z.array(z.string().regex(/^[0-9a-f-]{36}$/i, 'Not a message id')).min(1).max(50),
})

type Params = { params: Promise<{ id: string }> }

/** How much of the transcript is read for reuse — the tab itself shows 200. */
const TRANSCRIPT_LIMIT = 300

/** Messages whose English is stored at a time. */
const WRITES_AT_ONCE = 25

/**
 * POST { ids } — English for messages on the Conversation tab ("Show
 * English"), for a nurse who does not read the patient's language.
 *
 * English is kept per text, not per message (lib/ai/transcript-english.ts):
 * the nightly check-in that went out nine times is read once, and every copy
 * of a text the episode has already had translated comes back without asking
 * the model at all. The answer carries the English for the whole transcript,
 * so the rest of it needs no further request. The patient never sees these.
 */
export async function POST(request: Request, { params }: Params) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const parsed = TranslateSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(apiError(parsed.error.issues[0]?.message ?? 'Validation error'), { status: 422 })
  }

  const { id: episodeId } = await params
  // User client: RLS decides which of these messages this user may read at all.
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('id, content, metadata, whatsapp_conversations!inner(episode_id)')
    .eq('whatsapp_conversations.episode_id', episodeId)
    .order('created_at', { ascending: false })
    .limit(TRANSCRIPT_LIMIT)
  if (error) {
    return NextResponse.json(apiError('Could not load the messages', error.message), { status: 500 })
  }

  const rows = (data ?? []) as unknown as TranscriptRow[]
  const byText = englishByText(rows)
  const todo = textsToTranslate(rows, parsed.data.ids, byText)

  let failure: unknown = null
  if (todo.length > 0) {
    try {
      keepByText(todo, await translateMessagesToEnglish(todo), byText)
    } catch (err) {
      // Not fatal on its own: what the episode already knows still goes back.
      console.error(`[translate transcript] episode ${episodeId}:`, err)
      failure = err
    }
  }

  const { translations, writes } = spreadEnglish(rows, byText)

  // The nurse is waiting for the English, not for it to be stored.
  if (writes.length > 0) after(() => keepTranslations(writes))

  if (Object.keys(translations).length === 0 && failure) {
    const hint = !(failure instanceof GeminiUnavailableError) ? undefined
      : failure.quotaReached ? 'The translation service has reached its usage limit for now. Try again later.'
        : 'The translation service is busy. Try again in a minute.'
    return NextResponse.json(apiError('Could not translate the conversation', hint), { status: 503 })
  }

  return NextResponse.json(apiSuccess({ translations }))
}

/**
 * Stores each translation on its message, including copies the nurse never
 * asked about: the same text is never read twice. The metadata is read again
 * just before writing, so a delivery receipt that landed meanwhile is not
 * undone. A failure here only costs a second translation later.
 */
async function keepTranslations(writes: Array<{ id: string; en: string }>): Promise<void> {
  if (writes.length === 0) return
  const english = new Map(writes.map((w) => [w.id, w.en]))
  const service = await createServiceClient()
  const { data } = await service.from('whatsapp_messages').select('id, metadata').in('id', [...english.keys()])
  const rows = (data ?? []) as Array<Pick<TranscriptRow, 'id' | 'metadata'>>

  // A transcript seen in English for the first time fills in every message at
  // once; a few at a time keeps that off the connection pool.
  let failed = 0
  let firstError: string | undefined
  for (let i = 0; i < rows.length; i += WRITES_AT_ONCE) {
    const results = await Promise.all(rows.slice(i, i + WRITES_AT_ONCE).map((row) =>
      service
        .from('whatsapp_messages')
        .update({ metadata: { ...(row.metadata ?? {}), [ENGLISH_KEY]: english.get(row.id) } })
        .eq('id', row.id),
    ))
    for (const r of results) {
      if (!r.error) continue
      failed++
      firstError ??= r.error.message
    }
  }
  if (failed > 0) console.error(`[translate transcript] ${failed} translation(s) not stored:`, firstError)
}
