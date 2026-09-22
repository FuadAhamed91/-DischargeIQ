/**
 * Replies to numbers nobody is registered on, rate-limited.
 *
 * A hospital number is public: wrong numbers, spam and curious relatives
 * write to it. Each such message used to get the "not registered" reply,
 * which for a chatty stranger means a paid outbound message per inbound
 * one. Now a number hears it once, then not again for an hour.
 *
 * In-process memory (like sender-queue.ts): enough to stop the ping-pong on
 * one instance; a cold start simply answers once more.
 */

export const UNKNOWN_REPLY_COOLDOWN_MS = 60 * 60 * 1000

const lastReplied = new Map<string, number>()

/** True when the "not registered" reply should go out to this number now. Records the reply. */
export function shouldReplyToUnknown(key: string, now: Date = new Date()): boolean {
  const last = lastReplied.get(key)
  if (last !== undefined && now.getTime() - last < UNKNOWN_REPLY_COOLDOWN_MS) return false
  lastReplied.set(key, now.getTime())
  // Keep the map bounded: forget entries older than the cooldown.
  if (lastReplied.size > 1000) {
    for (const [k, t] of lastReplied) if (now.getTime() - t >= UNKNOWN_REPLY_COOLDOWN_MS) lastReplied.delete(k)
  }
  return true
}

/** For tests. */
export function resetUnknownNumberMemory(): void {
  lastReplied.clear()
}
