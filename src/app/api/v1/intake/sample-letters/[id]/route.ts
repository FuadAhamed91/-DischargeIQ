import { NextResponse } from 'next/server'
import { apiError } from '@/types/api'
import { DEFAULT_TZ, fmt } from '@/lib/format'
import { findSampleLetter, sampleLetterBlocks, sampleLetterFileName } from '@/lib/intake/sample-letters'
import { renderTextPdf } from '@/lib/pdf/text-pdf'

export const dynamic = 'force-dynamic'

/**
 * GET — a sample discharge letter as a PDF, printed with today as the
 * discharge day, for the Add patient page's "Try a sample letter" tiles.
 * The patients are fictional, so no session is needed to fetch one.
 * ?download=1 asks the browser to save it instead of showing it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const letter = findSampleLetter(id)
  if (!letter) return NextResponse.json(apiError('No such sample letter'), { status: 404 })

  const today = fmt(new Date(), 'yyyy-MM-dd', DEFAULT_TZ)
  const pdf = renderTextPdf(sampleLetterBlocks(letter, today), {
    title: `Discharge summary - ${letter.patient.full_name}`,
    author: 'Dubai General Hospital (fictional)',
  })
  const download = new URL(request.url).searchParams.has('download')

  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${sampleLetterFileName(letter)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
