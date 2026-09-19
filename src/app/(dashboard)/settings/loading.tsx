import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeaderSkeleton } from '@/components/shared/skeletons'

export default function SettingsLoading() {
  return (
    <div className="space-y-6 max-w-3xl" aria-busy="true" aria-label="Loading settings">
      <PageHeaderSkeleton />
      {Array.from({ length: 2 }).map((_, c) => (
        <Card key={c}>
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3.5 w-56 max-w-full" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1.5"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-40" /></div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
