import { Skeleton } from '@/components/ui/skeleton'
import { PageHeaderSkeleton, ChipRowSkeleton } from '@/components/shared/skeletons'

export default function AlertsLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading alerts">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ChipRowSkeleton count={3} />
        <Skeleton className="h-4 w-10" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 rounded-lg border border-l-4 border-l-border bg-card p-4">
            <Skeleton className="mt-0.5 h-5 w-5 shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <div className="hidden gap-2 sm:flex">
              <Skeleton className="h-8 w-24 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
