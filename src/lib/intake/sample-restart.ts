import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Sample patients (lib/intake/sample-letters.ts) are added again and again
 * in demos. When one still has an open care plan, it is closed first so the
 * new letter starts a fresh one, instead of stopping at "already has an open
 * care plan": the episode is completed, its alerts resolved, its check-ins
 * and reminders cancelled, and its unconfirmed appointments cancelled, so
 * the dashboard does not keep the old run's work.
 *
 * Returns false when the episode could not be closed (the intake then stops).
 */
export async function closeSampleEpisode(supabase: SupabaseClient, episodeId: string): Promise<boolean> {
  const now = new Date().toISOString()
  const { error } = await supabase.from('care_episodes').update({ status: 'completed', ended_at: now }).eq('id', episodeId)
  if (error) {
    console.error('[Intake commit] could not close the sample patient’s episode', episodeId, error.message)
    return false
  }
  // Tidying: the episode is closed either way, and the dispatcher skips jobs of a closed episode.
  const results = await Promise.all([
    supabase.from('alerts').update({ status: 'resolved', resolved_at: now }).eq('episode_id', episodeId).in('status', ['open', 'acknowledged']),
    supabase.from('reminder_jobs').update({ status: 'cancelled' }).eq('episode_id', episodeId).eq('status', 'pending'),
    supabase.from('appointments').update({ status: 'cancelled' }).eq('episode_id', episodeId).in('status', ['scheduled', 'confirmation_pending', 'reschedule_pending']),
  ])
  for (const r of results) if (r.error) console.warn('[Intake commit] tidying the closed sample episode', episodeId, r.error.message)
  return true
}
