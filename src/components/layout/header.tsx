'use client'

import { useRouter } from 'next/navigation'
import { User } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { MobileNav } from '@/components/layout/mobile-nav'
import { AlertBell } from '@/components/alerts/alert-bell'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { TourButton } from '@/components/tour/tour-button'
import type { Profile } from '@/types/database'
import type { UserRole } from '@/types/enums'

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  hospital_admin: 'Hospital admin',
  discharge_coordinator: 'Discharge coordinator',
  nurse: 'Nurse',
  case_manager: 'Case manager',
  read_only: 'Read only',
}

interface HeaderProps {
  profile: Profile
  hospitalName: string
  openAlerts: number
  criticalAlerts: number
}

export function Header({ profile, hospitalName, openAlerts, criticalAlerts }: HeaderProps) {
  const router = useRouter()

  const initials = profile.full_name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  // No backdrop-filter on the header: it would become the containing block and
  // stacking context for the fixed mobile drawer, trapping it behind the page.
  return (
    <header className="h-16 border-b flex items-center justify-between px-3 md:px-6 shrink-0 bg-background">
      <div className="flex items-center gap-2 min-w-0">
        <MobileNav role={profile.role as UserRole} hospitalName={hospitalName} />
        {/* Hospital name lives in the sidebar on desktop; show it here only on small screens */}
        <p className="md:hidden text-sm font-medium truncate">{hospitalName}</p>
      </div>

      <div className="flex items-center gap-1.5 md:gap-3">
        <TourButton />
        <ThemeToggle />
        <AlertBell hospitalId={profile.hospital_id} initialOpenCount={openAlerts} initialCriticalCount={criticalAlerts} />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="Account menu" className="flex items-center gap-2 h-11 p-1.5 rounded-lg hover:bg-accent transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar className="w-8 h-8">
              <AvatarImage src={profile.avatar_url ?? undefined} alt="" />
              <AvatarFallback className="text-xs bg-brand text-brand-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium leading-none">{profile.full_name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {ROLE_LABELS[profile.role] ?? profile.role}
              </p>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            {/* Base UI throws when a label sits outside a group, and the menu would not open */}
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <div className="space-y-1">
                  <p className="font-medium">{profile.full_name}</p>
                  <Badge variant="secondary" className="text-xs font-normal">
                    {ROLE_LABELS[profile.role] ?? profile.role}
                  </Badge>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => router.push('/settings')}
              className="cursor-pointer"
            >
              <User className="w-4 h-4 mr-2" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
