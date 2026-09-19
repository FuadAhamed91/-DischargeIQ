'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, FileText, Calendar, Bell, BarChart3, Settings, X, Menu,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { siteConfig } from '@/config/site'
import type { UserRole } from '@/types/enums'

const NAV_ITEMS = [
  { label: 'Overview',     href: '/',            icon: LayoutDashboard },
  { label: 'Patients',     href: '/patients',    icon: Users },
  { label: 'Episodes',     href: '/episodes',    icon: FileText },
  { label: 'Appointments', href: '/appointments',icon: Calendar },
  { label: 'Alerts',       href: '/alerts',      icon: Bell },
  { label: 'Analytics',    href: '/analytics',   icon: BarChart3 },
  { label: 'Settings',     href: '/settings',    icon: Settings },
]

export function MobileNav({ role }: { role: UserRole }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  void role  // available for future role-based filtering

  // Escape closes the drawer; lock body scroll while open
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  return (
    <>
      {/* Hamburger button — 44px touch target */}
      <button
        type="button"
        className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-accent transition-colors duration-200"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
      >
        <Menu className="w-5 h-5" aria-hidden="true" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden animate-in fade-in duration-200"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <aside
        id="mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!open}
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] bg-sidebar text-sidebar-foreground transform transition-transform duration-200 ease-out md:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between pl-5 pr-2 h-16 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-bold text-sm flex items-center justify-center" aria-hidden="true">
              D
            </div>
            <span className="font-semibold tracking-tight text-sm">{siteConfig.name}</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg hover:bg-sidebar-accent transition-colors duration-200"
            aria-label="Close navigation"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Nav */}
        <nav className="px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={isActive ? 'page' : undefined}
                tabIndex={open ? 0 : -1}
                className={cn(
                  'relative flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors duration-200',
                  isActive ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                )}
              >
                {isActive && <span aria-hidden="true" className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-sidebar-primary" />}
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
