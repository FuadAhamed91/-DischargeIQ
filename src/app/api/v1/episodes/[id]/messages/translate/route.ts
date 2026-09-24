import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { translateMessagesToEnglish } from '@/lib/ai/translation'
import type { MessageToTranslate } from '@/lib/ai/translation'
import { GeminiUnavailableError } from '@/lib/ai/gemini'

// Gemini batches run side by side, each within a 40 s budget.
export const maxDuration = 60

const TranslateSchema = z.object({
  ids: z.array(z.string().regex(/^[0-9a-f-]{36}$/i, 'Not a message id')).min(1).max(50),
})

type Params = { params: Promise<{ id: string }> }

interface MessageRow {
  id: string
  content: string | null
  metadata: Record<string, unknown> | null
}

/**
 * POST { ids } — English for messages on the Conversation tab ("Show
 * English"), for a nurse who does not read the patient's language. Each
 * translation is kept on its message (metadata.translation_en): a message is
 * translated once, whoever reads it, and transcripts open elsewhere receive
 * it through realtime. The patient never sees these.
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
    .in('id', parsed.data.ids)
  if (error) {
    return NextResponse.json(apiError('Could not load the messages', error.message), { status: 500 })
  }

  const translations: Record<string, string> = {}
  const todo: MessageToTranslate[] = []
  for (const row of (data ?? []) as unknown as MessageRow[]) {
    const kept = row.metadata?.translation_en
    if (typeof kept === 'string') translations[row.id] = kept
    else if (row.content?.trim()) todo.push({ id: row.id, text: row.content.trim() })
  }

  if (todo.length > 0) {
    let fresh: Record<string, string>
    try {
      fresh = await translateMessagesToEnglish(todo)
    } catch (err) {
      console.error(`[translate transcript] episode ${episodeId}:`, err)
      const hint = err instanceof GeminiUnavailableError ? 'The translation service is busy — try again in a minute.' : undefined
      return NextResponse.json(apiError('Could not translate the conversation', hint), { status: 503 })
    }
    Object.assign(translations, fresh)
    await keepTranslations(fresh)
  }

  return NextResponse.json(apiSuccess({ translations }))
}

/**
 * Stores each translation on its message. The metadata is read again just
 * before writing, so a delivery receipt that landed meanwhile is not undone.
 * A failure here only costs a second translation later.
 */
async function keepTranslations(fresh: Record<string, string>): Promise<void> {
  const ids = Object.keys(fresh)
  if (ids.length === 0) return
  const service = await createServiceClient()
  const { data } = await service.from('whatsapp_messages').select('id, metadata').in('id', ids)
  const results = await Promise.all(((data ?? []) as Array<Pick<MessageRow, 'id' | 'metadata'>>).map((row) =>
    service
      .from('whatsapp_messages')
      .update({ metadata: { ...(row.metadata ?? {}), translation_en: fresh[row.id] } })
      .eq('id', row.id),
  ))
  const failed = results.filter((r) => r.error)
  if (failed.length > 0) console.error(`[translate transcript] ${failed.length} translation(s) not stored:`, failed[0].error?.message)
}
