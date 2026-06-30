'use client'

import { useRouter } from 'next/navigation'
import { Bell, LogOut, User } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { MobileNav } from '@/components/layout/mobile-nav'
import type { Profile } from '@/types/database'
import type { UserRole } from '@/types/enums'

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  hospital_admin: 'Hospital Admin',
  discharge_coordinator: 'Discharge Coordinator',
  nurse: 'Nurse',
  case_manager: 'Case Manager',
  read_only: 'Read Only',
}

interface HeaderProps {
  profile: Profile
}

export function Header({ profile }: HeaderProps) {
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initials = profile.full_name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <header className="h-16 border-b flex items-center justify-between px-4 md:px-6 shrink-0 bg-background">
      <MobileNav role={profile.role as UserRole} />

      <div className="flex items-center gap-3">
        {/* Alert bell — will be wired to realtime in Phase 4 */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-4 h-4" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 h-auto p-1.5 rounded-lg hover:bg-accent transition-colors outline-none">
            <Avatar className="w-8 h-8">
              <AvatarImage src={profile.avatar_url ?? undefined} />
              <AvatarFallback className="text-xs bg-[#1C0770] text-white">
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
            <DropdownMenuLabel>
              <div className="space-y-1">
                <p className="font-medium">{profile.full_name}</p>
                <Badge variant="secondary" className="text-xs font-normal">
                  {ROLE_LABELS[profile.role] ?? profile.role}
                </Badge>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => { window.location.href = '/settings' }}
              className="cursor-pointer"
            >
              <User className="w-4 h-4 mr-2" />
              Profile settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-destructive focus:text-destructive cursor-pointer"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
