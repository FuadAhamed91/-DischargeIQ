import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeaderSkeleton, ChipRowSkeleton } from '@/components/shared/skeletons'

const HEADER_WIDTHS = [112, 64, 48, 96, 80, 80]

export default function EpisodesLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading patients">
      <PageHeaderSkeleton action />
      <ChipRowSkeleton count={4} />
      <Card className="overflow-hidden py-0">
        <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-3">
          {HEADER_WIDTHS.map((w, i) => <Skeleton key={i} className="h-3.5" style={{ width: w }} />)}
        </div>
        <div className="divide-y">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="hidden h-5 w-14 rounded-full sm:block" />
              <Skeleton className="hidden h-4 w-20 md:block" />
              <Skeleton className="hidden h-4 w-12 md:block" />
              <Skeleton className="h-4 w-4" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
