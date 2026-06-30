import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

export default function PatientsLoading() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      <Skeleton className="h-10 w-72 rounded-lg" />
      <Card>
        <div className="divide-y">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
