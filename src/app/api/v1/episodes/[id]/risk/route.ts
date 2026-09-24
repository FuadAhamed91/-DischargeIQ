import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { isLowering } from '@/lib/episodes/risk'
import type { RiskLevel } from '@/types/enums'

const CLINICAL = new Set(['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse', 'case_manager'])

const RiskSchema = z.object({
  level: z.enum(['green', 'yellow', 'red']),
  note: z.string().trim().max(500, 'Keep the note under 500 characters').default(''),
  /** The colour the nurse was looking at: a report that raised it since then is not silently overwritten. */
  from: z.enum(['green', 'yellow', 'red']),
})

type Params = { params: Promise<{ id: string }> }

/**
 * POST { level, from, note } — a nurse sets a patient's risk colour. The
 * system only ever raises it; lowering it is a clinical judgement after
 * following up, so it needs a note saying why. The change goes on the episode
 * timeline (risk_changed) and in audit_logs, with who made it.
 */
export async function POST(request: Request, { params }: Params) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response
  const { profile } = auth
  if (!CLINICAL.has(profile.role)) return NextResponse.json(apiError('Forbidden'), { status: 403 })

  const parsed = RiskSchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json(apiError(parsed.error.issues[0]?.message ?? 'Validation error'), { status: 422 })
  }
  const { level, note, from } = parsed.data

  const { id: episodeId } = await params
  // User client: RLS decides whether this user may see — and so change — the episode.
  const supabase = await createClient()
  const { data: episode } = await supabase
    .from('care_episodes')
    .select('id, hospital_id, status, current_risk_level')
    .eq('id', episodeId)
    .maybeSingle()
  if (!episode) return NextResponse.json(apiError('Episode not found'), { status: 404 })
  if (!['pending_review', 'active'].includes(episode.status as string)) {
    return NextResponse.json(apiError('This episode is closed — its risk level can no longer be changed'), { status: 409 })
  }
  if (isLowering(from, level) && note.length < 3) {
    return NextResponse.json(apiError('Say why the risk is lower — for example what you found when you contacted the patient'), { status: 422 })
  }

  const current = episode.current_risk_level as RiskLevel
  if (current !== from) {
    return NextResponse.json(
      apiError(`The risk level changed to ${current} while you were deciding — look at what raised it before changing it`, undefined, 'risk_changed_meanwhile'),
      { status: 409 },
    )
  }
  if (current === level) return NextResponse.json(apiSuccess({ current_risk_level: level }))

  // Conditional on the colour still being what the nurse saw, so a red report
  // landing in between wins over a lowering that did not know about it.
  const service = await createServiceClient()
  const { data: updated, error } = await service
    .from('care_episodes')
    .update({ current_risk_level: level, updated_at: new Date().toISOString() })
    .eq('id', episodeId)
    .eq('current_risk_level', from)
    .select('id')
  if (error) return NextResponse.json(apiError('Could not change the risk level', error.message), { status: 500 })
  if (!updated?.length) {
    return NextResponse.json(
      apiError('The risk level changed while you were deciding — reload to see what raised it', undefined, 'risk_changed_meanwhile'),
      { status: 409 },
    )
  }

  const payload = { from, to: level, note: note || null, changed_by: profile.full_name }
  const { error: timelineError } = await service.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    event_type: 'risk_changed',
    payload,
    risk_level: level,
    created_by: profile.id,
  })
  if (timelineError) console.error('[risk] timeline entry not written (is migration 00015 applied?):', timelineError.message)

  const { error: auditError } = await service.from('audit_logs').insert({
    hospital_id: episode.hospital_id,
    actor_id: profile.id,
    action: 'episode.risk_changed',
    resource_type: 'care_episode',
    resource_id: episodeId,
    metadata: payload,
  })
  if (auditError) console.error('[risk] audit log not written:', auditError.message)

  return NextResponse.json(apiSuccess({ current_risk_level: level }))
}
