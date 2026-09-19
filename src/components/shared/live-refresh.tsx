'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface LiveRefreshProps {
  /** Refresh when something happens on this episode… */
  episodeId?: string
  /** …or anywhere in this hospital. One of the two is required. */
  hospitalId?: string
  /** Only these timeline event types trigger a refresh (default: any). */
  events?: string[]
}

/**
 * Re-renders the current server page when the patient side does something —
 * confirms an appointment, answers a check-in, sends a message — so a nurse
 * looking at the screen sees it without reloading. Listens to
 * patient_timeline_events (already in the realtime publication) and calls
 * router.refresh(), coalesced so a burst of events costs one round trip.
 */
export function LiveRefresh({ episodeId, hospitalId, events }: LiveRefreshProps) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wanted = useMemo(() => (events ? new Set(events) : null), [events])

  useEffect(() => {
    const filter = episodeId ? `episode_id=eq.${episodeId}` : hospitalId ? `hospital_id=eq.${hospitalId}` : null
    if (!filter) return

    const channel = supabase
      .channel(`live-refresh-${episodeId ?? hospitalId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'patient_timeline_events', filter }, (payload) => {
        const type = (payload.new as { event_type?: string }).event_type ?? ''
        if (wanted && !wanted.has(type)) return
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => router.refresh(), 400)
      })
      .subscribe()

    return () => {
      if (timer.current) clearTimeout(timer.current)
      supabase.removeChannel(channel)
    }
  }, [episodeId, hospitalId, wanted, router, supabase])

  return null
}
