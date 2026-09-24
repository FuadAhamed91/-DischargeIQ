'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, MoonStar } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/** Asks tonight's check-in questions now (POST /api/v1/episodes/[id]/checkin): for a demo, or answers wanted early. */
export function SendCheckinButton({ episodeId }: { episodeId: string }) {
  const router = useRouter()
  const [sending, setSending] = useState(false)

  async function send() {
    setSending(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/checkin`, { method: 'POST' })
      const json = (await res.json()) as { error?: string; message?: string; data?: { broughtForward?: boolean } }
      if (!res.ok) throw new Error(json.message ? `${json.error}: ${json.message}` : (json.error ?? 'Could not send the check-in'))
      toast.success(json.data?.broughtForward ? 'Check-in sent — it replaces tonight’s' : 'Check-in sent')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the check-in')
    } finally {
      setSending(false)
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={send} disabled={sending} title="Ask the patient tonight’s check-in questions now instead of at the usual time">
      {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <MoonStar className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
      Send check-in now
    </Button>
  )
}
