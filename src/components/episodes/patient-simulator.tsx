'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, Check, Loader2, Send, Siren, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { signalTour } from '@/lib/tour/signals'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { DEMO_REPLIES } from '@/lib/whatsapp/demo-replies'
import type { LanguageCode } from '@/types/enums'

type Outcome = 'waiting' | 'answered' | 'alerted'

/**
 * For demo patients only: judges cannot hold the patient's phone, so they
 * write as the patient here. The message is handled exactly like one from
 * that phone (POST /simulate-reply): the answer, any alert and the triage
 * land on the conversation and the dashboards as they would for real. A
 * reply from a real phone (a visitor who added their own number) is
 * followed the same way.
 */
export function PatientSimulator({ episodeId, conversationId, patientName, language }: {
  episodeId: string
  conversationId: string | null
  patientName: string
  language: LanguageCode
}) {
  const firstName = patientName.split(' ')[0]
  const suggestions = DEMO_REPLIES[language] ?? DEMO_REPLIES.en
  const supabase = useMemo(() => createClient(), [])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  /** Where the reply being followed came from: this box, or the patient's own WhatsApp. */
  const [source, setSource] = useState<'box' | 'phone'>('box')
  /** A reply came in the last 90 seconds: what arrives now is its outcome. */
  const listening = useRef(false)
  const stopListening = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(stopListening.current), [])
  const listen = useCallback(() => {
    listening.current = true
    clearTimeout(stopListening.current)
    stopListening.current = setTimeout(() => { listening.current = false }, 90_000)
  }, [])

  // What came of the reply: the assistant's answer on the conversation, and any alert.
  useEffect(() => {
    let channel = supabase
      .channel(`patient-simulator-${episodeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts', filter: `episode_id=eq.${episodeId}` }, () => {
        if (!listening.current) return
        setOutcome('alerted')
        signalTour('patient:alerted')
      })
    if (conversationId) {
      channel = channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
        const row = payload.new as { direction?: string; metadata?: { simulated?: boolean } | null }
        if (row.direction === 'inbound') {
          // Written in this box: already being followed. From the phone itself: follow it from here.
          if (row.metadata?.simulated) return
          listen()
          setSource('phone')
          setOutcome('waiting')
          signalTour('patient:replied')
          return
        }
        if (!listening.current) return
        setOutcome((o) => (o === 'alerted' ? o : 'answered'))
        signalTour('patient:answered')
      })
    }
    channel.subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [episodeId, conversationId, supabase, listen])

  async function send(text: string) {
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    // Listening starts before the request: the answer can arrive as soon as the server has it.
    listen()
    setSource('box')
    setOutcome('waiting')
    signalTour('patient:replied')
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/simulate-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
      if (!res.ok) throw new Error(json.message ? `${json.error}: ${json.message}` : (json.error ?? 'Could not send the reply'))
      setDraft('')
    } catch (err) {
      listening.current = false
      setOutcome(null)
      signalTour('patient:failed')
      toast.error(err instanceof Error ? err.message : 'Could not send the reply')
    } finally {
      setSending(false)
    }
  }

  return (
    <section
      aria-labelledby="patient-simulator"
      data-tour="patient-simulator"
      className="rounded-lg border border-dashed border-brand/40 bg-brand-tint p-4"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand" aria-hidden="true">
          <Smartphone className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="patient-simulator" className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            Reply as {firstName}
            <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">Demo</span>
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            You can’t hold {firstName}’s phone in a demo, so write as {firstName} here. It is handled exactly like a
            WhatsApp message from the patient’s phone, and the answer goes back to that phone.
          </p>
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Messages ${firstName} might send`}>
        {suggestions.map((s, i) => (
          <li key={s.text} className="max-w-full">
            <button
              type="button"
              onClick={() => void send(s.text)}
              disabled={sending}
              data-tour={i === 0 ? 'simulator-urgent' : undefined}
              className={cn(
                'flex max-w-full items-start gap-2 rounded-2xl rounded-bl-md border bg-background px-3 py-2 text-left text-sm shadow-xs transition-colors',
                'hover:border-brand/50 hover:bg-brand-soft/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
                s.urgent && 'border-danger/40 hover:border-danger/60 hover:bg-danger-soft/50',
              )}
            >
              {s.urgent && <Siren className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />}
              <span className="min-w-0">
                <span className="block break-words" dir="auto">{s.text}</span>
                {s.gloss && <span className="mt-0.5 block text-xs text-muted-foreground">{s.gloss}</span>}
                {s.urgent && <span className="mt-0.5 block text-xs font-medium text-danger">An urgent symptom: watch the alert</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(draft) }}>
        <label htmlFor="simulator-message" className="sr-only">Message from {firstName}</label>
        <Input
          id="simulator-message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Or write anything as ${firstName}, in any language…`}
          maxLength={500}
          disabled={sending}
          className="h-10 bg-background"
          dir="auto"
        />
        <Button type="submit" disabled={sending || !draft.trim()} className="h-10 shrink-0" aria-label={`Send as ${firstName}`}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          <span className="hidden sm:inline">Send as {firstName}</span>
        </Button>
      </form>

      {outcome && (
        <p role="status" className="mt-2.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {outcome === 'waiting' && <><Loader2 className="h-3.5 w-3.5 animate-spin text-brand" aria-hidden="true" /> {source === 'phone' ? `A reply came in on WhatsApp from ${firstName}’s phone.` : `Sent as ${firstName}.`} The answer appears in the conversation above in a few seconds.</>}
          {outcome === 'answered' && <><Check className="h-3.5 w-3.5 text-success" aria-hidden="true" /> Answered. {firstName} got the reply on WhatsApp.</>}
          {outcome === 'alerted' && <><BellRing className="h-3.5 w-3.5 text-danger" aria-hidden="true" /> <span className="font-medium text-danger">A nurse was alerted.</span> See the alert at the top of this page.</>}
        </p>
      )}
    </section>
  )
}
