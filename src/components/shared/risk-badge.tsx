import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { RiskLevel } from '@/types/enums'

const RISK_CONFIG: Record<RiskLevel, { label: string; className: string; dot: string; sr: string }> = {
  green:  { label: 'Stable',   className: 'bg-success-soft text-success border-success/20', dot: 'bg-success', sr: 'green risk' },
  yellow: { label: 'Monitor',  className: 'bg-warning-soft text-warning border-warning/30', dot: 'bg-warning', sr: 'yellow risk' },
  red:    { label: 'Critical', className: 'bg-danger-soft text-danger border-danger/20',    dot: 'bg-danger',  sr: 'red risk' },
}

interface RiskBadgeProps {
  level: RiskLevel
  className?: string
}

export function RiskBadge({ level, className }: RiskBadgeProps) {
  const config = RISK_CONFIG[level] ?? RISK_CONFIG.green
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-medium', config.className, className)} title={config.sr}>
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', config.dot)} aria-hidden="true" />
      {config.label}
    </Badge>
  )
}
