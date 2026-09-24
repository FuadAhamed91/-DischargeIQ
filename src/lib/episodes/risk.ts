/**
 * The colour on a patient: care_episodes.current_risk_level.
 *
 * The system only ever raises it — a triage result (the triage_assessments
 * trigger, migration 00003), an emergency word, a symptom the assistant hears
 * in chat, a symptom report nobody could assess — and never lowers it. Lowering
 * is a nurse's call after following up, made with a note
 * (POST /api/v1/episodes/[id]/risk), and recorded on the timeline.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { RiskLevel } from '@/types/enums'

const RANK: Record<RiskLevel, number> = { green: 0, yellow: 1, red: 2 }

/** Lowering the colour needs a note; raising it does not. */
export function isLowering(from: RiskLevel, to: RiskLevel): boolean {
  return RANK[to] < RANK[from]
}

/**
 * Raises an episode's colour to `level` when it is lower now — the triage
 * trigger's rule: red always wins, yellow only replaces green. One
 * conditional UPDATE, so two reports landing together cannot undo each other.
 */
export async function raiseEpisodeRisk(supabase: SupabaseClient, episodeId: string, level: 'yellow' | 'red'): Promise<void> {
  const query = supabase
    .from('care_episodes')
    .update({ current_risk_level: level, updated_at: new Date().toISOString() })
    .eq('id', episodeId)
  const { error } = level === 'red'
    ? await query.neq('current_risk_level', 'red')
    : await query.eq('current_risk_level', 'green')
  if (error) console.error(`[risk] could not raise episode ${episodeId} to ${level}:`, error.message)
}
