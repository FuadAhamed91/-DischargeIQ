'use client'

import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, FileText, Calendar, Bell, BarChart3, Settings, HeartPulse,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { siteConfig } from '@/config/site'
import { NavLink } from './nav-link'
import type { UserRole } from '@/types/enums'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  roles?: UserRole[]
}

interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Care',
    items: [
      { label: 'Overview', href: '/', icon: LayoutDashboard },
      { label: 'Patients', href: '/patients', icon: Users },
      { label: 'Episodes', href: '/episodes', icon: FileText },
      { label: 'Appointments', href: '/appointments', icon: Calendar },
    ],
  },
  {
    label: 'Monitoring',
    items: [
      { label: 'Alerts', href: '/alerts', icon: Bell },
      { label: 'Analytics', href: '/analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
]

export function isNavActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

interface SidebarProps {
  role: UserRole
  hospitalName: string
}

/**
 * Desktop navigation. Full width with labels from `lg`; between `md` and `lg`
 * (tablets, split screens) it collapses to an icon rail so the content column
 * keeps ~240px — labels stay in the accessibility tree and surface as tooltips.
 */
export function Sidebar({ role, hospitalName }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside
      className="hidden md:flex w-16 lg:w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      aria-label="Primary"
    >
      {/* Product + hospital */}
      <div className="flex h-16 items-center justify-center gap-3 border-b border-sidebar-border px-2 lg:justify-start lg:px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground" aria-hidden="true">
          <HeartPulse className="h-5 w-5" />
        </div>
        <div className="hidden min-w-0 lg:block">
          <p className="text-sm font-semibold leading-tight tracking-tight text-foreground">{siteConfig.name}</p>
          <p className="truncate text-xs leading-tight text-muted-foreground" title={hospitalName}>{hospitalName}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 lg:space-y-5 lg:px-3 lg:py-4">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((i) => !i.roles || i.roles.includes(role))
          if (items.length === 0) return null
          return (
            <div key={group.label} className="not-first:mt-3 not-first:border-t not-first:border-sidebar-border not-first:pt-3 lg:not-first:mt-0 lg:not-first:border-0 lg:not-first:pt-0">
              <p className="mb-1.5 hidden px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 lg:block">{group.label}</p>
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = isNavActive(pathname, item.href)
                  const Icon = item.icon
                  return (
                    <li key={item.href}>
                      <NavLink
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        title={item.label}
                        className={cn(
                          'relative flex h-10 items-center justify-center gap-3 rounded-md text-sm font-medium transition-colors duration-150 lg:h-9 lg:justify-start lg:px-3',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                          active
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {active && <span aria-hidden="true" className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-full bg-sidebar-primary" />}
                        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-sidebar-primary' : 'text-muted-foreground')} aria-hidden="true" />
                        <span className="sr-only lg:not-sr-only">{item.label}</span>
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <div className="hidden border-t border-sidebar-border px-4 py-3 lg:block">
        <p className="text-[11px] text-muted-foreground">{siteConfig.name} · v0.1</p>
      </div>
    </aside>
  )
}
