import { redirect } from 'next/navigation'

/**
 * The episode list became the Patients list (one row per care plan). Old
 * links and bookmarks land there with the same filter.
 */
export default async function EpisodesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>
}) {
  const { status, page } = await searchParams
  const q = new URLSearchParams()
  if (status) q.set('status', status)
  if (page) q.set('page', page)
  redirect(q.size ? `/patients?${q.toString()}` : '/patients')
}
