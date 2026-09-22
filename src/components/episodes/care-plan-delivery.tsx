'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquareWarning, RefreshCw, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatInTimeZone } from 'date-fns-tz'
import { Button } from '@/components/ui/button'
import type { CarePlanDelivery } from '@/lib/whatsapp/care-plan'

/** POST the resend and report it; used by both the banner and the quiet button. */
function useResend(episodeId: string) {
  const router = useRouter()
  const [sending, setSending] = useState(false)

  async function resend() {
    setSending(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/summary/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resend: true }),
      })
      const json = (await res.json()) as { error?: string; message?: string }
      if (!res.ok) throw new Error(json.message ? `${json.error}: ${json.message}` : (json.error ?? 'Resend failed'))
      toast.success('Care plan sent again — delivery will show on the conversation shortly')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Resend failed')
    } finally {
      setSending(false)
    }
  }

  return { resend, sending }
}

interface CarePlanDeliveryBannerProps {
  episodeId: string
  delivery: CarePlanDelivery
  patientName: string
  timezone: string
}

/**
 * Shown when Twilio reported that the care plan never reached the patient.
 * The nurse can resend now; and if the patient messages first, the plan goes
 * out again on its own (see redeliverFailedCarePlan).
 */
export function CarePlanDeliveryBanner({ episodeId, delivery, patientName, timezone }: CarePlanDeliveryBannerProps) {
  const { resend, sending } = useResend(episodeId)
  const firstName = patientName.split(' ')[0]

  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4">
      <MessageSquareWarning className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-danger">
          Care plan not delivered to {firstName}
          <span className="font-normal text-danger/80"> · attempted {formatInTimeZone(new Date(delivery.createdAt), timezone, 'EEE d MMM, HH:mm')}</span>
        </p>
        <p className="mt-0.5 text-sm text-danger/90">{delivery.error ?? 'WhatsApp could not deliver the message.'}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          As soon as {firstName} sends any message to the hospital number, the care plan is sent again automatically — or send it now.
        </p>
      </div>
      <Button size="sm" variant="outline" className="h-9 border-danger/40 text-danger hover:bg-danger/10 hover:text-danger" onClick={resend} disabled={sending}>
        {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
        Resend now
      </Button>
    </div>
  )
}

/**
 * For a care plan whose delivery was never confirmed — sent before delivery
 * receipts existed, or Twilio has not reported back. Not a failure, so no
 * banner; just a way to send it again when the patient says nothing arrived.
 */
export function CarePlanResendButton({ episodeId }: { episodeId: string }) {
  const { resend, sending } = useResend(episodeId)
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={resend}
      disabled={sending}
      title="Send the care plan to the patient again — use it when they say nothing arrived"
    >
      {sending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
      Resend care plan
    </Button>
  )
}
