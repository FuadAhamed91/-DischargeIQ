import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'

export const maxDuration = 60

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveAuthContext()
  if (!auth.ok) return auth.response

  const { profile } = auth
  const { id: episodeId } = await params

  if (!['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'].includes(profile.role)) {
    return NextResponse.json(apiError('Forbidden'), { status: 403 })
  }

  const { document_id } = await request.json()

  if (!document_id) {
    return NextResponse.json(apiError('document_id is required'), { status: 400 })
  }

  const supabase = await createClient()

  // Verify document belongs to this episode
  const { data: doc } = await supabase
    .from('discharge_documents')
    .select('id, extraction_status')
    .eq('id', document_id)
    .eq('episode_id', episodeId)
    .single()

  if (!doc) {
    return NextResponse.json(apiError('Document not found'), { status: 404 })
  }

  if (doc.extraction_status === 'processing') {
    return NextResponse.json(apiError('Extraction already in progress'), { status: 409 })
  }

  // Trigger internal extraction
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const extractResponse = await fetch(`${baseUrl}/api/internal/ai/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_id, episode_id: episodeId }),
  })

  const result = await extractResponse.json()

  if (!extractResponse.ok) {
    return NextResponse.json(result, { status: extractResponse.status })
  }

  // Trigger translation for patient's preferred language + hospital default languages
  const { data: episode } = await supabase
    .from('care_episodes')
    .select('patients(preferred_language), hospitals(settings)')
    .eq('id', episodeId)
    .single()

  const patientLang = (episode?.patients as unknown as { preferred_language: string } | null)?.preferred_language
  const hospitalSettings = (episode?.hospitals as unknown as { settings: { languages?: string[] } } | null)?.settings
  const hospitalLangs: string[] = hospitalSettings?.languages ?? ['en']
  const targetLanguages = [...new Set([patientLang, ...hospitalLangs].filter(Boolean))]

  if (result.data?.summary_id && targetLanguages.length > 0) {
    fetch(`${baseUrl}/api/internal/ai/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary_id: result.data.summary_id,
        target_languages: targetLanguages,
      }),
    }).catch(console.error) // fire-and-forget
  }

  return NextResponse.json(apiSuccess(result.data))
}
