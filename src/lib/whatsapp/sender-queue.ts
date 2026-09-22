/**
 * Messages from one phone number are handled one after another.
 *
 * Two messages from the same sender a second apart arrive as two webhooks
 * and, in dev and on a warm serverless instance, run concurrently. Both read
 * the conversation state before either writes it back, so the second reply
 * answers a question the first had already moved past ("1" then "OK" in the
 * nightly check-in became two answers to Q1). Different senders never wait
 * on each other: the queue is keyed by hospital number + sender.
 *
 * The chain lives in module scope, so it covers one Node process (next dev,
 * one warm Vercel instance). Across instances the ordering relies on Twilio
 * delivering a sender's messages in order, which it does.
 */

const chains = new Map<string, Promise<void>>()

export function senderKey(phoneNumberId: string, from: string): string {
  return `${phoneNumberId}|${from}`
}

/** Runs `work` after every earlier call with the same key has finished. */
export async function withSenderLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((resolve) => { release = resolve })
  const chained = previous.then(() => mine)
  chains.set(key, chained)

  await previous
  try {
    return await work()
  } finally {
    release()
    // Nobody queued behind us: drop the entry so the map does not grow.
    if (chains.get(key) === chained) chains.delete(key)
  }
}

/** How many senders currently have work queued or running (for tests). */
export function pendingSenders(): number {
  return chains.size
}
