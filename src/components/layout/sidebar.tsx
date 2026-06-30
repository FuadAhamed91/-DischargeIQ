'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  FileText,
  Calendar,
  Bell,
  BarChart3,
  Settings,
  Activity,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { siteConfig } from '@/config/site'
import type { UserRole } from '@/types/enums'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  roles?: UserRole[]
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', href: '/', icon: LayoutDashboard },
  { label: 'Patients', href: '/patients', icon: Users },
  { label: 'Episodes', href: '/episodes', icon: FileText },
  { label: 'Appointments', href: '/appointments', icon: Calendar },
  { label: 'Alerts', href: '/alerts', icon: Bell },
  {
    label: 'Analytics',
    href: '/analytics',
    icon: BarChart3,
    roles: ['super_admin', 'hospital_admin', 'discharge_coordinator', 'case_manager', 'read_only'],
  },
  { label: 'Settings', href: '/settings', icon: Settings },
]

interface SidebarProps {
  role: UserRole
}

export function Sidebar({ role }: SidebarProps) {
  const pathname = usePathname()

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(role),
  )

  return (
    <aside className="hidden md:flex flex-col w-60 shrink-0 border-r bg-[#1C0770] text-white">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16 border-b border-white/10">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#30D5C8] text-[#1C0770] font-bold text-sm">
          D
        </div>
        <span className="font-semibold tracking-tight">{siteConfig.name}</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {visibleItems.map((item) => {
          const isActive =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/70 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-white/10">
        <div className="flex items-center gap-2 text-xs text-white/40">
          <Activity className="w-3 h-3" />
          <span>DischargeIQ v0.1</span>
        </div>
      </div>
    </aside>
  )
}
