'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface AlertBellProps {
  hospitalId: string
  initialOpenCount: number
  initialCriticalCount: number
}

/**
 * Header bell: number of open alerts, kept live via realtime.
 * Any insert/update on the hospital's alerts triggers a recount (cheap head query),
 * which keeps the badge correct for acknowledgements and resolutions too.
 */
export function AlertBell({ hospitalId, initialOpenCount, initialCriticalCount }: AlertBellProps) {
  const [open, setOpen] = useState(initialOpenCount)
  const [critical, setCritical] = useState(initialCriticalCount)
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let cancelled = false
    const recount = async () => {
      const [{ count: o }, { count: c }] = await Promise.all([
        supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'open'),
        supabase.from('alerts').select('*', { count: 'exact', head: true }).eq('hospital_id', hospitalId).eq('status', 'open').eq('severity', 'critical'),
      ])
      if (!cancelled) { setOpen(o ?? 0); setCritical(c ?? 0) }
    }
    const channel = supabase
      .channel(`alert-bell-${hospitalId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts', filter: `hospital_id=eq.${hospitalId}` }, recount)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [hospitalId, supabase])

  const label = open === 0 ? 'Alerts: none open' : `Alerts: ${open} open${critical ? `, ${critical} critical` : ''}`

  return (
    <Link
      href="/alerts"
      aria-label={label}
      title={label}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-accent hover:text-accent-foreground"
    >
      <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
      {open > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold leading-[18px] text-center tnum',
            critical ? 'bg-danger text-danger-foreground' : 'bg-brand text-brand-foreground',
          )}
        >
          {open > 99 ? '99+' : open}
        </span>
      )}
      {/* Screen readers get the count via aria-label; polite region announces changes */}
      <span className="sr-only" aria-live="polite">{label}</span>
    </Link>
  )
}
