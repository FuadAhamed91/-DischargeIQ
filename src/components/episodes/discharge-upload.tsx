'use client'

import { useState, useRef } from 'react'
import { Upload, FileText, X, Loader2, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface DischargeUploadProps {
  episodeId: string
  onUploadComplete?: (documentId: string) => void
}

type UploadState = 'idle' | 'uploading' | 'extracting' | 'done' | 'error'

export function DischargeUpload({ episodeId, onUploadComplete }: DischargeUploadProps) {
  const [state, setState] = useState<UploadState>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const working = state === 'uploading' || state === 'extracting'

  function handleFile(f: File) {
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF files can be read')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error('The file must be under 20 MB')
      return
    }
    setFile(f)
    setState('idle')
  }

  async function handleUpload() {
    if (!file) return

    setState('uploading')

    try {
      // 1. Upload PDF
      const form = new FormData()
      form.append('file', file)

      const uploadRes = await fetch(`/api/v1/episodes/${episodeId}/documents`, {
        method: 'POST',
        body: form,
      })

      const uploadData = await uploadRes.json()

      if (!uploadRes.ok) {
        throw new Error(uploadData.error ?? 'Could not upload the letter')
      }

      const documentId: string = uploadData.data.id

      // 2. Trigger extraction
      setState('extracting')

      const extractRes = await fetch(`/api/v1/episodes/${episodeId}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: documentId }),
      })

      const extractData = await extractRes.json()

      if (!extractRes.ok) {
        throw new Error(extractData.error ?? 'Could not read the letter')
      }

      setState('done')
      toast.success('Letter read. Check the care plan below.')
      if (onUploadComplete) {
        onUploadComplete(documentId)
      } else {
        // Default: reload the page so the review form appears
        window.location.reload()
      }
    } catch (err) {
      setState('error')
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  function reset() {
    setFile(null)
    setState('idle')
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={working ? -1 : 0}
        aria-label="Choose the discharge letter (PDF)"
        aria-busy={working}
        className={cn(
          'rounded-lg border-2 border-dashed p-8 text-center outline-none transition-colors duration-200 sm:p-10',
          'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          dragOver ? 'border-brand bg-brand-soft' : 'border-border hover:border-brand/40 hover:bg-muted/40',
          working ? 'pointer-events-none' : 'cursor-pointer',
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const f = e.dataTransfer.files[0]
          if (f) handleFile(f)
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
        />

        {state === 'done' ? (
          <div className="flex flex-col items-center gap-2">
            <CheckCircle className="h-9 w-9 text-success" aria-hidden="true" />
            <p className="font-medium text-success">Letter read</p>
            <p className="text-sm text-muted-foreground">Opening the care plan…</p>
          </div>
        ) : working ? (
          <div className="flex flex-col items-center gap-2" role="status">
            <Loader2 className="h-9 w-9 animate-spin text-brand" aria-hidden="true" />
            <p className="font-medium">{state === 'uploading' ? 'Uploading the letter…' : 'Reading the letter…'}</p>
            <p className="text-sm text-muted-foreground">This usually takes 10 to 30 seconds.</p>
          </div>
        ) : file ? (
          <div className="flex flex-col items-center gap-2">
            <FileText className="h-9 w-9 text-brand" aria-hidden="true" />
            <p className="max-w-full truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB · click to choose a different file</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">Choose the discharge letter</p>
            <p className="hidden text-sm text-muted-foreground sm:block">or drop the PDF here</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {file && (state === 'idle' || state === 'error') && (
        <div className="flex gap-2">
          <Button type="button" onClick={handleUpload} className="h-10 flex-1">
            {state === 'error' ? 'Try again' : 'Read the letter'}
          </Button>
          <Button type="button" variant="ghost" size="icon-lg" className="size-10" onClick={reset} aria-label="Remove this file">
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  )
}
