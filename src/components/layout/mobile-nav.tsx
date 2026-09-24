'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X, Menu, HeartPulse } from 'lucide-react'
import { cn } from '@/lib/utils'
import { siteConfig } from '@/config/site'
import { SETTINGS_ITEM, isNavActive, visibleNavItems } from './sidebar'
import type { NavItem } from './sidebar'
import type { UserRole } from '@/types/enums'

export function MobileNav({ role, hospitalName }: { role: UserRole; hospitalName?: string }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Escape closes the drawer; lock body scroll while open
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open])

  const drawerLink = (item: NavItem) => {
    const active = isNavActive(pathname, item)
    const Icon = item.icon
    return (
      <Link
        href={item.href}
        onClick={() => setOpen(false)}
        aria-current={active ? 'page' : undefined}
        tabIndex={open ? 0 : -1}
        className={cn(
          'relative flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium transition-colors duration-200',
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {active && <span aria-hidden="true" className="absolute bottom-2 left-0 top-2 w-0.5 rounded-full bg-sidebar-primary" />}
        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-sidebar-primary' : 'text-muted-foreground')} aria-hidden="true" />
        {item.label}
      </Link>
    )
  }

  return (
    <>
      <button
        type="button"
        className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors duration-200 hover:bg-accent"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-foreground/40 md:hidden animate-in fade-in duration-200"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!open}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-out md:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border pl-4 pr-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground" aria-hidden="true">
              <HeartPulse className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight tracking-tight text-foreground">{siteConfig.name}</p>
              {hospitalName && <p className="truncate text-xs leading-tight text-muted-foreground">{hospitalName}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors duration-200 hover:bg-muted"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4">
          <ul className="space-y-0.5">
            {visibleNavItems(role).map((item) => (
              <li key={item.href}>{drawerLink(item)}</li>
            ))}
          </ul>
          <ul className="mt-auto border-t border-sidebar-border pt-3">
            <li>{drawerLink(SETTINGS_ITEM)}</li>
          </ul>
        </nav>
      </aside>
    </>
  )
}
