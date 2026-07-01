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

  function handleFile(f: File) {
    if (f.type !== 'application/pdf') {
      toast.error('Only PDF files are accepted')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error('File must be under 20MB')
      return
    }
    setFile(f)
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
        throw new Error(uploadData.error ?? 'Upload failed')
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
        throw new Error(extractData.error ?? 'Extraction failed')
      }

      setState('done')
      toast.success('Discharge summary extracted successfully')
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

  const stateLabel: Record<UploadState, string> = {
    idle: '',
    uploading: 'Uploading PDF…',
    extracting: 'AI is extracting clinical data…',
    done: 'Extraction complete',
    error: 'Something went wrong',
  }

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        className={cn(
          'border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer',
          dragOver ? 'border-[#1C0770] bg-[#F0EDFF]' : 'border-border hover:border-[#1C0770]/40',
          (state === 'uploading' || state === 'extracting') && 'pointer-events-none opacity-60',
        )}
        onClick={() => inputRef.current?.click()}
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
          accept="application/pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
        />

        {state === 'done' ? (
          <div className="flex flex-col items-center gap-2">
            <CheckCircle className="w-10 h-10 text-green-500" />
            <p className="font-medium text-green-700">Extraction complete</p>
            <p className="text-sm text-muted-foreground">Review the extracted summary below</p>
          </div>
        ) : (state === 'uploading' || state === 'extracting') ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-10 h-10 text-[#1C0770] animate-spin" />
            <p className="font-medium">{stateLabel[state]}</p>
            <p className="text-sm text-muted-foreground">Please wait, this may take up to 30 seconds</p>
          </div>
        ) : file ? (
          <div className="flex flex-col items-center gap-2">
            <FileText className="w-10 h-10 text-[#1C0770]" />
            <p className="font-medium text-sm">{file.name}</p>
            <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-10 h-10 text-muted-foreground" />
            <p className="font-medium">Drop discharge PDF here</p>
            <p className="text-sm text-muted-foreground">or click to browse — PDF only, max 20MB</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {file && state === 'idle' && (
        <div className="flex gap-2">
          <Button
            onClick={handleUpload}
            className="flex-1"
            style={{ backgroundColor: '#1C0770' }}
          >
            Extract discharge data
          </Button>
          <Button variant="ghost" size="icon" onClick={reset}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      )}

      {state === 'error' && (
        <Button variant="outline" onClick={reset} className="w-full">
          Try again
        </Button>
      )}
    </div>
  )
}
