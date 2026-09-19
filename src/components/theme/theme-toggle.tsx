'use client'

import { useSyncExternalStore } from 'react'
import { useTheme } from 'next-themes'
import { Sun, Moon, Monitor, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

/**
 * Light / Dark / System switcher. The preference is stored by next-themes;
 * the icon reflects the *resolved* theme after mount (the server cannot know
 * the user's OS preference, so we avoid a hydration mismatch by rendering a
 * neutral icon until then).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  // false during SSR/hydration, true once on the client — without a setState-in-effect
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false)

  const current = mounted ? (resolvedTheme ?? 'light') : 'light'
  const Icon = !mounted ? Monitor : current === 'dark' ? Moon : Sun

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Theme: ${theme ?? 'system'}. Change theme`}
        title="Theme"
        className={cn(
          'inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-200',
          'hover:bg-accent hover:text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {OPTIONS.map((opt) => {
          const OptIcon = opt.icon
          const selected = (theme ?? 'system') === opt.value
          return (
            <DropdownMenuItem
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className="cursor-pointer justify-between"
              aria-checked={selected}
              role="menuitemradio"
            >
              <span className="flex items-center gap-2">
                <OptIcon className="h-4 w-4" aria-hidden="true" /> {opt.label}
              </span>
              {selected && <Check className="h-4 w-4" aria-hidden="true" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
