'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Mic, AlertCircle, MessageCircle } from 'lucide-react'
import { format, isSameDay, isToday, isYesterday } from 'date-fns'

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
  initialMessages: TranscriptMessage[]
  conversationId: string | null
  patientName: string
  patientPhone: string
  conversationState: string
}

const STATE_LABELS: Record<string, string> = {
  idle: 'No reply pending',
  awaiting_reminder_response: 'Waiting for reminder reply',
  awaiting_appointment_confirm: 'Waiting for appointment confirmation',
  awaiting_slot_selection: 'Waiting for slot selection',
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'EEEE, d MMMM yyyy')
}

export function ConversationTranscript({
  initialMessages,
  conversationId,
  patientName,
  patientPhone,
  conversationState,
}: ConversationTranscriptProps) {
  const [messages, setMessages] = useState<TranscriptMessage[]>(initialMessages)
  const bottomRef = useRef<HTMLDivElement>(null)
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length])

  const stateLabel = STATE_LABELS[conversationState] ?? conversationState

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{patientName}</p>
          <p className="text-xs text-muted-foreground">{patientPhone} · WhatsApp</p>
        </div>
        <Badge variant={conversationState === 'idle' ? 'secondary' : 'outline'} className="text-xs">
          {stateLabel}
        </Badge>
      </div>

      {/* Thread */}
      {messages.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <MessageCircle className="w-6 h-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No messages yet.</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Messages appear here as soon as the discharge summary, a reminder, or a reply is sent.
          </p>
        </div>
      ) : (
        <div className="max-h-[36rem] overflow-y-auto py-4 pr-1 space-y-3" aria-live="polite">
          {messages.map((m, i) => {
            const date = new Date(m.created_at)
            const prev = messages[i - 1]
            const showDay = !prev || !isSameDay(new Date(prev.created_at), date)
            const outbound = m.direction === 'outbound'
            const failed = m.status === 'failed'
            const error = typeof m.metadata?.error === 'string' ? (m.metadata.error as string) : null

            return (
              <div key={m.id}>
                {showDay && (
                  <div className="flex items-center gap-3 my-2">
                    <div className="h-px flex-1 bg-border" />
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{dayLabel(date)}</span>
                    <div className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={[
                      'max-w-[80%] md:max-w-[65%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm',
                      outbound
                        ? 'bg-[#F0EDFF] text-[#1C0770] rounded-br-md'
                        : 'bg-muted text-foreground rounded-bl-md',
                      failed ? 'ring-1 ring-red-300' : '',
                    ].join(' ')}
                  >
                    {m.message_type === 'audio' ? (
                      <p className="flex items-center gap-2 italic">
                        <Mic className="w-3.5 h-3.5" /> Voice note{m.content ? `: “${m.content}”` : ''}
                      </p>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{m.content || <span className="italic opacity-70">(empty message)</span>}</p>
                    )}
                    <div className={`mt-1 flex items-center gap-2 text-[11px] ${outbound ? 'text-[#1C0770]/60 justify-end' : 'text-muted-foreground'}`}>
                      <span>{outbound ? 'DischargeIQ' : patientName.split(' ')[0]}</span>
                      <span>·</span>
                      <span>{format(date, 'HH:mm')}</span>
                      {failed && (
                        <span className="inline-flex items-center gap-1 text-red-600" title={error ?? 'Delivery failed'}>
                          <AlertCircle className="w-3 h-3" /> Not delivered
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
    </div>
  )
}
