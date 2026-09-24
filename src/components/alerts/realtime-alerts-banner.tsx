'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ShieldAlert, X } from 'lucide-react'

export function RealtimeAlertsBanner({ hospitalId, initialRedCount }: { hospitalId: string; initialRedCount: number }) {
  const [criticalCount, setCriticalCount] = useState(initialRedCount)
  const [dismissed, setDismissed] = useState(false)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    const channel = supabase
      .channel('banner-alerts')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` },
        (payload) => {
          const a = payload.new as { severity: string; status: string }
          if (a.severity === 'critical' && a.status === 'open') {
            setCriticalCount((c) => c + 1)
            setDismissed(false)
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` },
        (payload) => {
          const a = payload.new as { severity: string; status: string }
          if (a.severity === 'critical' && a.status !== 'open') setCriticalCount((c) => Math.max(0, c - 1))
        })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [hospitalId, supabase])

  if (criticalCount === 0 || dismissed) return null

  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-danger px-4 py-3 text-danger-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-300">
      <div className="flex items-center gap-2.5 min-w-0">
        <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="text-sm font-semibold">
          {criticalCount} critical alert{criticalCount > 1 ? 's need' : ' needs'} immediate attention
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Link href="/alerts" className="rounded-md px-2.5 py-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-danger-foreground/70">
          View alerts
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss critical alert banner"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-danger-foreground/15 focus-visible:ring-2 focus-visible:ring-danger-foreground/70 transition-colors duration-200"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
