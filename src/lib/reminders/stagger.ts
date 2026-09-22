/**
 * One question at a time per phone number.
 *
 * Two patients on one WhatsApp number get their nightly check-in at the
 * same tick; the sender then has two open questions and their "1" has to be
 * asked about ("who is this message about?"). The dispatcher avoids that by
 * holding a due job while another conversation on the same number is still
 * waiting for an answer, or was written to earlier in the same run — the
 * job stays pending and goes out on a later tick, once the first patient
 * has answered. A hold never lasts more than HOLD_LIMIT_MS past fire_at:
 * an unanswered check-in must not silence the other patient's for good.
 */

import { isWaiting } from '@/lib/whatsapp/routing'
import { readConversationState } from '@/lib/whatsapp/fsm'

export const HOLD_LIMIT_MS = 60 * 60 * 1000

export interface PhoneConversation {
  episode_id: string
  wa_phone: string
  conversation_state: unknown
}

export interface DueJob {
  episodeId: string
  phone: string
  fireAt: string
}

export type HoldReason = 'another_waiting' | 'sent_this_run'

/**
 * Why this job should wait for a later tick, or null to send it now.
 * `sentThisRun` is the set of phones already written to in this run.
 */
export function holdReason(
  job: DueJob,
  conversations: PhoneConversation[],
  sentThisRun: Set<string>,
  now: Date = new Date(),
): HoldReason | null {
  if (Date.parse(job.fireAt) + HOLD_LIMIT_MS <= now.getTime()) return null
  if (sentThisRun.has(job.phone)) return 'sent_this_run'
  const otherWaiting = conversations.some(
    (c) => c.wa_phone === job.phone && c.episode_id !== job.episodeId && isWaiting(readConversationState(c.conversation_state, now).state),
  )
  return otherWaiting ? 'another_waiting' : null
}
