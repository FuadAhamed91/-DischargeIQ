'use client'

import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, Calendar, Bell, BarChart3, Settings, HeartPulse,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { siteConfig } from '@/config/site'
import { NavLink } from './nav-link'
import type { UserRole } from '@/types/enums'

export interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  /** Other paths that belong to this section — a patient's page lives under /episodes. */
  alsoActiveOn?: string[]
  roles?: UserRole[]
}

/** The everyday screens, in the order a nurse reaches for them. Settings sits apart, at the bottom. */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/', icon: LayoutDashboard },
  { label: 'Patients', href: '/patients', icon: Users, alsoActiveOn: ['/episodes'] },
  { label: 'Alerts', href: '/alerts', icon: Bell },
  { label: 'Appointments', href: '/appointments', icon: Calendar },
  { label: 'Analytics', href: '/analytics', icon: BarChart3 },
]

export const SETTINGS_ITEM: NavItem = { label: 'Settings', href: '/settings', icon: Settings }

export function isNavActive(pathname: string, item: NavItem) {
  if (item.href === '/') return pathname === '/'
  return [item.href, ...(item.alsoActiveOn ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function visibleNavItems(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.roles || i.roles.includes(role))
}

interface SidebarProps {
  role: UserRole
  hospitalName: string
}

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavActive(pathname, item)
  const Icon = item.icon
  return (
    <NavLink
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      className={cn(
        'relative flex h-10 items-center justify-center gap-3 rounded-md text-sm font-medium transition-colors duration-150 lg:justify-start lg:px-3',
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
  )
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

      <nav className="flex flex-1 flex-col overflow-y-auto px-2 py-3 lg:px-3 lg:py-4">
        <ul className="space-y-1">
          {visibleNavItems(role).map((item) => (
            <li key={item.href}><SidebarLink item={item} pathname={pathname} /></li>
          ))}
        </ul>
        <ul className="mt-auto border-t border-sidebar-border pt-3">
          <li><SidebarLink item={SETTINGS_ITEM} pathname={pathname} /></li>
        </ul>
      </nav>
    </aside>
  )
}
