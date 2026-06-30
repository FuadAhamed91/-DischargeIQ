import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { RiskLevel } from '@/types/enums'

const RISK_CONFIG: Record<RiskLevel, { label: string; className: string }> = {
  green: { label: 'Stable', className: 'bg-green-100 text-green-700 border-green-200 hover:bg-green-100' },
  yellow: { label: 'Monitor', className: 'bg-yellow-100 text-yellow-700 border-yellow-200 hover:bg-yellow-100' },
  red: { label: 'Critical', className: 'bg-red-100 text-red-700 border-red-200 hover:bg-red-100' },
}

interface RiskBadgeProps {
  level: RiskLevel
  className?: string
}

export function RiskBadge({ level, className }: RiskBadgeProps) {
  const config = RISK_CONFIG[level]
  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full mr-1.5 inline-block', {
        'bg-green-500': level === 'green',
        'bg-yellow-500': level === 'yellow',
        'bg-red-500': level === 'red',
      })} />
      {config.label}
    </Badge>
  )
}
