import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCardSkeleton } from '@/components/shared/skeletons'

export default function EpisodeLoading() {
  return (
    <div className="space-y-5 max-w-5xl" aria-busy="true" aria-label="Loading patient">
      <Skeleton className="h-4 w-24" />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56 max-w-[80vw]" />
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} compact />)}
      </div>

      <Skeleton className="h-10 w-full max-w-md rounded-lg" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card>
          <CardHeader className="pb-3"><Skeleton className="h-4 w-24" /></CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-32" /></div>
            ))}
            <Skeleton className="h-2 w-full rounded-full" />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-8 w-16 rounded-md" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start justify-between gap-4">
                <div className="space-y-1.5"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-24" /><Skeleton className="h-3 w-64 max-w-[50vw]" /></div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
