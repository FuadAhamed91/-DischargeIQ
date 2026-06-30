'use client'

import { useState } from 'react'
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

  return (
    <>
      {/* Hamburger button */}
      <button
        className="md:hidden p-2 rounded-lg hover:bg-accent transition-colors"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-[#1C0770] text-white transform transition-transform duration-200 ease-in-out md:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#30D5C8] text-[#1C0770] font-bold text-sm flex items-center justify-center">
              D
            </div>
            <span className="font-semibold tracking-tight text-sm">{siteConfig.name}</span>
          </div>
          <button onClick={() => setOpen(false)} className="hover:opacity-70 p-1">
            <X className="w-4 h-4" />
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
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
