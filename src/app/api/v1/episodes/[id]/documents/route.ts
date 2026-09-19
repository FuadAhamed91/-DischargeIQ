import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { resolveAuthContext } from '@/lib/utils/api'
import { apiSuccess, apiError } from '@/types/api'

export const maxDuration = 30

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

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return NextResponse.json(apiError('No file provided'), { status: 400 })
  }

  if (file.type !== 'application/pdf') {
    return NextResponse.json(apiError('Only PDF files are accepted'), { status: 422 })
  }

  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json(apiError('File must be under 20MB'), { status: 422 })
  }

  const supabase = await createClient()

  // Verify episode belongs to nurse's hospital
  const { data: episode } = await supabase
    .from('care_episodes')
    .select('hospital_id')
    .eq('id', episodeId)
    .single()

  if (!episode) {
    return NextResponse.json(apiError('Episode not found'), { status: 404 })
  }

  const storagePath = `${episode.hospital_id}/${episodeId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`

  const { error: uploadError } = await supabase.storage
    .from('discharge-documents')
    .upload(storagePath, file, { contentType: 'application/pdf', upsert: false })

  if (uploadError) {
    return NextResponse.json(apiError('Upload failed', uploadError.message), { status: 500 })
  }

  const { data: doc, error: dbError } = await supabase
    .from('discharge_documents')
    .insert({
      episode_id: episodeId,
      hospital_id: episode.hospital_id,
      storage_path: storagePath,
      original_filename: file.name,
      uploaded_by: profile.id,
      extraction_status: 'pending',
    })
    .select()
    .single()

  if (dbError) {
    return NextResponse.json(apiError('Failed to record document', dbError.message), { status: 500 })
  }

  // Log upload event
  await (await createServiceClient()).from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: episode.hospital_id,
    event_type: 'discharge_uploaded',
    payload: { document_id: doc.id, filename: file.name },
    created_by: profile.id,
  })

  return NextResponse.json(apiSuccess(doc), { status: 201 })
}
