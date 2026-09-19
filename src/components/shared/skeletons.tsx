import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/**
 * Building blocks for route loading states. Each mirrors the real page's
 * spacing and card chrome so the swap from skeleton to content doesn't shift
 * the layout. Keep these in step with the pages they stand in for.
 */

export function PageHeaderSkeleton({ action = false, className }: { action?: boolean; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64 max-w-[70vw]" />
      </div>
      {action && <Skeleton className="h-9 w-28 rounded-md" />}
    </div>
  )
}

export function ChipRowSkeleton({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-24 rounded-md" />
      ))}
    </div>
  )
}

/** KPI tile matching the Overview / episode stat cards (Card py-0 + p-4/5). */
export function StatCardSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <Card className="py-0">
      <CardContent className={compact ? 'p-4' : 'p-4 sm:p-5'}>
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-4 w-24" />
          {!compact && <Skeleton className="h-8 w-8 rounded-lg" />}
        </div>
        <Skeleton className={cn('mt-3 h-8 w-16', compact && 'mt-2 h-7')} />
        {compact && <Skeleton className="mt-2 h-3 w-24" />}
      </CardContent>
    </Card>
  )
}

/** Card with a title bar and N list rows (alerts, appointments, episodes). */
export function ListCardSkeleton({ rows = 5, title = true, className }: { rows?: number; title?: boolean; className?: string }) {
  return (
    <Card className={className}>
      {title && (
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
      )}
      <CardContent className="p-0">
        <div className="divide-y">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-44 max-w-[60%]" />
                <Skeleton className="h-3 w-32 max-w-[45%]" />
              </div>
              <Skeleton className="hidden h-5 w-16 rounded-full sm:block" />
              <Skeleton className="h-4 w-4" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/** Card with a title and an empty plot area (charts). */
export function ChartCardSkeleton({ height = 220, className }: { height?: number; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-3.5 w-64 max-w-full" />
      </CardHeader>
      <CardContent>
        <Skeleton style={{ height }} className="w-full" />
      </CardContent>
    </Card>
  )
}
