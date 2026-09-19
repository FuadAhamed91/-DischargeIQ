'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Mic, AlertCircle, MessageCircle, Send, Loader2, Bot, UserRound } from 'lucide-react'
import { format, isSameDay, isToday, isYesterday } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ConversationStateRecord } from '@/lib/whatsapp/fsm'

export interface TranscriptMessage {
  id: string
  direction: 'inbound' | 'outbound'
  message_type: 'text' | 'interactive' | 'audio' | 'template'
  content: string | null
  status: 'sent' | 'delivered' | 'read' | 'failed'
  metadata: Record<string, unknown> | null
  created_at: string
}

interface ConversationTranscriptProps {
  episodeId: string
  initialMessages: TranscriptMessage[]
  conversationId: string | null
  patientName: string
  patientPhone: string
  conversationState: ConversationStateRecord
  /** Clinical role on an open episode: shows the composer. */
  canSend: boolean
  currentUserId: string
}

const STATE_LABELS: Record<string, string> = {
  idle: 'Assistant on duty',
  awaiting_reminder_response: 'Waiting for reminder reply',
  awaiting_checkin_meds: 'Waiting for tonight’s medicines answer',
  awaiting_checkin_symptoms: 'Waiting for tonight’s symptoms answer',
  awaiting_appointment_confirm: 'Waiting for appointment confirmation',
  awaiting_slot_selection: 'Waiting for slot selection',
  nurse_attending: 'You are chatting — assistant paused',
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'EEEE, d MMMM yyyy')
}

function senderOf(m: TranscriptMessage): { kind: 'patient' | 'nurse' | 'assistant'; name: string | null } {
  if (m.direction === 'inbound') return { kind: 'patient', name: null }
  const meta = m.metadata ?? {}
  if (meta.sender === 'nurse') return { kind: 'nurse', name: typeof meta.sender_name === 'string' ? meta.sender_name : 'Nurse' }
  return { kind: 'assistant', name: 'DischargeIQ' }
}

export function ConversationTranscript({
  episodeId,
  initialMessages,
  conversationId,
  patientName,
  patientPhone,
  conversationState,
  canSend,
  currentUserId,
}: ConversationTranscriptProps) {
  const [messages, setMessages] = useState<TranscriptMessage[]>(initialMessages)
  const [state, setState] = useState<ConversationStateRecord>(conversationState)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [handingBack, setHandingBack] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const supabase = useMemo(() => createClient(), [])

  // Live updates: new rows for this conversation (RLS still applies)
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`transcript-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const incoming = payload.new as TranscriptMessage
        setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversationId, supabase])

  // The 30-minute attending window expires client-side too, so the badge is honest.
  useEffect(() => {
    if (state.state !== 'nurse_attending' || !state.until) return
    const ms = Math.max(0, Date.parse(state.until) - Date.now())
    const t = setTimeout(() => setState({ state: 'idle' }), ms)
    return () => clearTimeout(t)
  }, [state])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      const json = (await res.json()) as {
        data?: { message: TranscriptMessage | null; conversation_state: ConversationStateRecord }
        error?: string
        message?: string
      }
      if (!res.ok || !json.data) {
        throw new Error(json.message ? `${json.error}: ${json.message}` : (json.error ?? 'Could not send'))
      }
      if (json.data.message) {
        const logged = json.data.message
        setMessages((prev) => (prev.some((m) => m.id === logged.id) ? prev : [...prev, logged]))
      }
      setState(json.data.conversation_state)
      setDraft('')
      textareaRef.current?.focus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the message')
    } finally {
      setSending(false)
    }
  }

  async function handBack() {
    setHandingBack(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/messages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attending: false }),
      })
      if (!res.ok) throw new Error('Could not hand back')
      setState({ state: 'idle' })
      toast.success('Assistant is answering again')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not hand back')
    } finally {
      setHandingBack(false)
    }
  }

  const attending = state.state === 'nurse_attending'
  const attendingByMe = attending && state.by === currentUserId
  const stateLabel = attending && !attendingByMe ? 'A colleague is chatting — assistant paused' : (STATE_LABELS[state.state] ?? state.state)

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{patientName}</p>
          <p className="text-xs text-muted-foreground">{patientPhone} · WhatsApp</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('text-xs', attending ? 'border-brand/30 bg-brand-soft text-brand' : state.state === 'idle' ? 'text-muted-foreground' : 'border-warning/30 bg-warning-soft text-warning')}>
            {attending ? <UserRound className="mr-1 h-3 w-3" aria-hidden="true" /> : <Bot className="mr-1 h-3 w-3" aria-hidden="true" />}
            {stateLabel}
          </Badge>
          {attending && canSend && (
            <Button type="button" variant="ghost" size="sm" onClick={handBack} disabled={handingBack} className="h-8 text-xs">
              {handingBack ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Hand back to assistant
            </Button>
          )}
        </div>
      </div>

      {/* Thread */}
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <MessageCircle className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">No messages yet.</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Messages appear here as soon as the care plan, a check-in, a reply — or something you write below — is sent.
          </p>
        </div>
      ) : (
        <div className="max-h-[36rem] space-y-3 overflow-y-auto py-4 pr-1" aria-live="polite">
          {messages.map((m, i) => {
            const date = new Date(m.created_at)
            const prev = messages[i - 1]
            const showDay = !prev || !isSameDay(new Date(prev.created_at), date)
            const outbound = m.direction === 'outbound'
            const failed = m.status === 'failed'
            const error = typeof m.metadata?.error === 'string' ? (m.metadata.error as string) : null
            const sender = senderOf(m)

            return (
              <div key={m.id}>
                {showDay && (
                  <div className="my-2 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{dayLabel(date)}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className={cn('flex', outbound ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm md:max-w-[65%]',
                      sender.kind === 'nurse' && 'rounded-br-md bg-brand text-brand-foreground',
                      sender.kind === 'assistant' && 'rounded-br-md bg-brand-soft text-brand',
                      sender.kind === 'patient' && 'rounded-bl-md bg-muted text-foreground',
                      failed && 'ring-1 ring-danger/40',
                    )}
                  >
                    {m.message_type === 'audio' ? (
                      <p className="flex items-center gap-2 italic">
                        <Mic className="h-3.5 w-3.5" aria-hidden="true" /> Voice note{m.content ? `: “${m.content}”` : ''}
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{m.content || <span className="italic opacity-70">(empty message)</span>}</p>
                    )}
                    <div className={cn(
                      'mt-1 flex items-center gap-2 text-[11px]',
                      sender.kind === 'nurse' && 'justify-end text-brand-foreground/75',
                      sender.kind === 'assistant' && 'justify-end text-brand/60',
                      sender.kind === 'patient' && 'text-muted-foreground',
                    )}>
                      <span>{sender.kind === 'patient' ? patientName.split(' ')[0] : sender.name}</span>
                      <span>·</span>
                      <span>{format(date, 'HH:mm')}</span>
                      {failed && (
                        <span className="inline-flex items-center gap-1 text-danger" title={error ?? 'Delivery failed'}>
                          <AlertCircle className="h-3 w-3" aria-hidden="true" /> Not delivered
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Composer */}
      {canSend && (
        <form
          className="mt-2 border-t pt-3"
          onSubmit={(e) => { e.preventDefault(); void send() }}
        >
          <label htmlFor="nurse-message" className="sr-only">Message to {patientName}</label>
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              id="nurse-message"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
              }}
              placeholder={`Write to ${patientName.split(' ')[0]} on WhatsApp…`}
              rows={2}
              maxLength={1000}
              disabled={sending}
              className="min-h-11 resize-none"
            />
            <Button type="submit" disabled={sending || !draft.trim()} aria-busy={sending} className="h-11 shrink-0" aria-label="Send message">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Sent as you, in the language you type. The assistant stays quiet for 30 minutes after your last message; emergencies still escalate. Enter to send, Shift+Enter for a new line.
          </p>
        </form>
      )}
    </div>
  )
}
