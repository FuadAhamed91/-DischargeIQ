'use client'

import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Re-renders the Overview when an alert is raised or handled, so the counts,
 * the reminders and the last-24-hours chart move with the live alert list.
 * A burst of changes (a triage raising two alerts at once) is one refresh.
 */
export function OverviewLiveRefresh({ hospitalId }: { hospitalId: string }) {
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => router.refresh(), 800)
    }
    const channel = supabase
      .channel(`overview-refresh-${hospitalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` }, refresh)
      .subscribe()
    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [hospitalId, router, supabase])

  return null
}
