'use client'

import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Users, Calendar, Bell, BarChart3, Settings, HeartPulse, MessageCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { siteConfig } from '@/config/site'
import { formatPhone } from '@/lib/format'
import { NavLink } from './nav-link'
import { SandboxJoinButton } from '@/components/whatsapp/sandbox-join'
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
  /** The hospital's WhatsApp number, shown above Settings. */
  whatsappNumber?: string | null
}

function SidebarLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isNavActive(pathname, item)
  const Icon = item.icon
  return (
    <NavLink
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      data-tour={`nav-${item.label.toLowerCase()}`}
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
 * Where patients reach the hospital: the number they write to on WhatsApp
 * and, in the demo, a way to try it on your own phone (the sandbox QR) and
 * the team's test phone. Labels only fit from `lg`; on the icon rail the
 * icon opens the QR.
 */
function WhatsAppLine({ number }: { number: string }) {
  const demoPhone = siteConfig.demoWhatsAppNumber
  return (
    <div className="mt-auto">
      <div className="hidden rounded-lg border border-sidebar-border bg-background/60 p-3 lg:block" data-tour="whatsapp-line">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <MessageCircle className="h-3.5 w-3.5 text-success" aria-hidden="true" /> Patients write to
        </p>
        <p className="mt-1 text-sm font-semibold tracking-tight text-foreground tnum">{formatPhone(number)}</p>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">on WhatsApp, in any of 5 languages.</p>
        {demoPhone && (
          <div className="mt-2 space-y-1.5 border-t border-sidebar-border pt-2">
            <SandboxJoinButton />
            <p className="text-xs leading-snug text-muted-foreground">
              Demo phone: <span className="font-medium text-foreground tnum">{formatPhone(demoPhone)}</span>
            </p>
          </div>
        )}
      </div>
      {demoPhone ? (
        <SandboxJoinButton className="flex w-full justify-center lg:hidden">
          <MessageCircle className="h-4 w-4 text-success" aria-hidden="true" />
          <span className="sr-only">Patients write to {formatPhone(number)} on WhatsApp. Try it on your phone</span>
        </SandboxJoinButton>
      ) : (
        <p className="flex justify-center lg:hidden" title={`Patients write to ${formatPhone(number)} on WhatsApp`}>
          <MessageCircle className="h-4 w-4 text-success" aria-hidden="true" />
          <span className="sr-only">Patients write to {formatPhone(number)} on WhatsApp</span>
        </p>
      )}
    </div>
  )
}

/**
 * Desktop navigation. Full width with labels from `lg`; between `md` and `lg`
 * (tablets, split screens) it collapses to an icon rail so the content column
 * keeps ~240px — labels stay in the accessibility tree and surface as tooltips.
 */
export function Sidebar({ role, hospitalName, whatsappNumber }: SidebarProps) {
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
        {whatsappNumber && <WhatsAppLine number={whatsappNumber} />}
        <ul className={cn('border-t border-sidebar-border pt-3', whatsappNumber ? 'mt-3 lg:mt-4' : 'mt-auto')}>
          <li><SidebarLink item={SETTINGS_ITEM} pathname={pathname} /></li>
        </ul>
      </nav>
    </aside>
  )
}
