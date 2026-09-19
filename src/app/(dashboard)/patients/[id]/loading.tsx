import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ListCardSkeleton } from '@/components/shared/skeletons'

export default function PatientLoading() {
  return (
    <div className="space-y-5 max-w-4xl" aria-busy="true" aria-label="Loading patient">
      <Skeleton className="h-4 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-56 max-w-[80vw]" />
        <div className="flex items-center gap-2"><Skeleton className="h-5 w-24 rounded-full" /><Skeleton className="h-5 w-16 rounded-full" /></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardHeader className="pb-3"><Skeleton className="h-4 w-20" /></CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5"><Skeleton className="h-3 w-16" /><Skeleton className="h-4 w-36" /></div>
            ))}
          </CardContent>
        </Card>
        <div className="md:col-span-2">
          <ListCardSkeleton rows={3} />
        </div>
      </div>
    </div>
  )
}
