'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AlertCircle, X } from 'lucide-react'

interface RealtimeAlertsBannerProps {
  hospitalId: string
  initialRedCount: number
}

export function RealtimeAlertsBanner({ hospitalId, initialRedCount }: RealtimeAlertsBannerProps) {
  const [redCount, setRedCount] = useState(initialRedCount)
  const [dismissed, setDismissed] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const channel = supabase
      .channel('banner-alerts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'alerts',
          filter: `hospital_id=eq.${hospitalId}`,
        },
        (payload) => {
          const alert = payload.new as { risk_level: string; status: string }
          if (alert.risk_level === 'red' && alert.status === 'open') {
            setRedCount((c) => c + 1)
            setDismissed(false)
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'alerts',
          filter: `hospital_id=eq.${hospitalId}`,
        },
        (payload) => {
          const alert = payload.new as { risk_level: string; status: string }
          if (alert.risk_level === 'red' && alert.status !== 'open') {
            setRedCount((c) => Math.max(0, c - 1))
          }
        },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [hospitalId, supabase])

  if (redCount === 0 || dismissed) return null

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-600 text-white rounded-lg animate-pulse">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span className="font-semibold text-sm">
          {redCount} critical alert{redCount > 1 ? 's' : ''} require immediate attention
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/alerts"
          className="text-xs font-medium underline hover:no-underline"
          onClick={() => setDismissed(true)}
        >
          View alerts →
        </Link>
        <button onClick={() => setDismissed(true)} className="hover:opacity-70">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
