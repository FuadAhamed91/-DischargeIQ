import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'
import { INTAKE_ROLES } from '@/lib/intake/validate'
import { findOpenEpisodesByPhone } from '@/lib/whatsapp/recipient'

export const dynamic = 'force-dynamic'

const E164 = /^\+[1-9]\d{6,14}$/

/**
 * GET ?phone=+9715… — who else at this hospital has an open episode on a
 * WhatsApp number. Intake shows it under the number field so the nurse
 * knows the patient will share the number with a relative (messages that do
 * not say who they are about get asked) — or catches a typo before the
 * summary goes to the wrong phone.
 *
 * Service client after the role check: the other patient may be assigned
 * to a colleague, which the row-level SELECT policy would hide from a nurse.
 */
export async function GET(request: Request) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response
  if (!INTAKE_ROLES.has(auth.profile.role)) return NextResponse.json(apiError('Forbidden'), { status: 403 })

  const phone = (new URL(request.url).searchParams.get('phone') ?? '').trim()
  if (!E164.test(phone)) return NextResponse.json(apiError('phone must be in E.164 format'), { status: 422 })

  const supabase = await createServiceClient()
  const open = await findOpenEpisodesByPhone(supabase, auth.profile.hospital_id, phone)

  return NextResponse.json(apiSuccess({
    phone,
    patients: open.map((c) => ({
      patient_id: c.patient.id,
      full_name: c.patient.full_name,
      episode_id: c.episode.id,
      episode_status: c.episode.status,
    })),
  }))
}
