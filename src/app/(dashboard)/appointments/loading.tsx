import { PageHeaderSkeleton, ListCardSkeleton } from '@/components/shared/skeletons'

export default function AppointmentsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading appointments">
      <PageHeaderSkeleton />
      <ListCardSkeleton rows={4} />
      <ListCardSkeleton rows={2} />
    </div>
  )
}
