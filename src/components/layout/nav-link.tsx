'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'

// Hover must last this long before it counts as intent — a cursor crossing a
// list on its way somewhere else should not prefetch every row it passes.
const INTENT_MS = 80
// Re-warm after this long; keep under staleTimes.static so a stale entry is
// refreshed before the click.
const REWARM_MS = 20_000

/**
 * Link that fully prefetches its route on intent (sustained hover, focus,
 * touch). Every dashboard route is dynamic, and for dynamic routes the default
 * <Link> prefetch only fetches down to the loading boundary — the click still
 * pays a server round trip. router.prefetch() fetches the whole page, so by the
 * time the click lands the payload is usually already in the client cache.
 * Works as a server-component child too (it is a client component itself).
 */
export function NavLink({ href, children, onMouseEnter, onMouseLeave, onFocus, onTouchStart, ...rest }: React.ComponentProps<typeof Link>) {
  const router = useRouter()
  const lastWarm = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const warm = useCallback(() => {
    const now = Date.now()
    if (now - lastWarm.current < REWARM_MS) return
    lastWarm.current = now
    router.prefetch(typeof href === 'string' ? href : (href.pathname ?? '/'))
  }, [href, router])

  const cancel = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }, [])

  useEffect(() => cancel, [cancel])

  return (
    <Link
      href={href}
      onMouseEnter={(e) => { onMouseEnter?.(e); cancel(); timer.current = setTimeout(warm, INTENT_MS) }}
      onMouseLeave={(e) => { onMouseLeave?.(e); cancel() }}
      onFocus={(e) => { onFocus?.(e); warm() }}
      onTouchStart={(e) => { onTouchStart?.(e); warm() }}
      {...rest}
    >
      {children}
    </Link>
  )
}
