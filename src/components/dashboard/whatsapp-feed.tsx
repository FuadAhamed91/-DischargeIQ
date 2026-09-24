'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Mic, Stethoscope, UserRound } from 'lucide-react'
import { NavLink } from '@/components/layout/nav-link'
import { createClient } from '@/lib/supabase/client'
import { fmt, formatPhone } from '@/lib/format'
import { cn } from '@/lib/utils'

/** A WhatsApp message with the patient it belongs to. */
export interface FeedMessage {
  id: string
  conversation_id: string
  direction: 'inbound' | 'outbound'
  message_type: string
  content: string | null
  metadata: Record<string, unknown> | null
  created_at: string
  episode_id: string | null
  patient_name: string | null
}

interface WhatsAppFeedProps {
  hospitalId: string
  tz: string
  /** Today in the hospital's timezone (YYYY-MM-DD): today's messages show only their time. */
  today: string
  initial: FeedMessage[]
  /** The number patients write to, for the empty state. */
  whatsappNumber: string | null
  limit?: number
}

type Sender = { kind: 'patient' | 'assistant' | 'nurse'; label: string }

function senderOf(m: FeedMessage): Sender {
  const meta = m.metadata ?? {}
  if (m.direction === 'inbound') {
    const name = typeof meta.sender_name === 'string' && meta.sender_name.trim() ? meta.sender_name.trim() : null
    return { kind: 'patient', label: name ?? 'Patient' }
  }
  if (meta.sender === 'nurse') return { kind: 'nurse', label: typeof meta.sender_name === 'string' ? `Nurse · ${meta.sender_name}` : 'Nurse' }
  return { kind: 'assistant', label: 'Assistant' }
}

/** What the nurse reads: the English when the row has it, without WhatsApp's *bold* marks. */
function previewOf(m: FeedMessage): string {
  const meta = m.metadata ?? {}
  const english = [meta.original_text, meta.translation_en].find((v): v is string => typeof v === 'string' && v.trim() !== '')
  const text = (english ?? m.content ?? '').replace(/[*_~]/g, '').replace(/\s+/g, ' ').trim()
  if (m.message_type === 'audio') return text ? `Voice note: “${text}”` : 'Voice note'
  return text || '(no text)'
}

const AVATAR: Record<Sender['kind'], { icon: typeof Bot; className: string }> = {
  patient: { icon: UserRound, className: 'bg-muted text-foreground' },
  assistant: { icon: Bot, className: 'bg-brand-soft text-brand' },
  nurse: { icon: Stethoscope, className: 'bg-success-soft text-success' },
}

/**
 * The newest WhatsApp messages across every patient, as they happen: several
 * people writing at once show up here one after another, each under their
 * patient, and a click opens that patient's conversation.
 */
export function WhatsAppFeed({ hospitalId, tz, today, initial, whatsappNumber, limit = 8 }: WhatsAppFeedProps) {
  const [messages, setMessages] = useState(initial)
  const [live, setLive] = useState(false)
  const [arrived, setArrived] = useState<Set<string>>(() => new Set())
  const supabase = useMemo(() => createClient(), [])
  // conversation → patient, so a new message can be named without asking again
  const patients = useRef(new Map(initial.map((m) => [m.conversation_id, { episode_id: m.episode_id, patient_name: m.patient_name }])))

  useEffect(() => {
    async function patientFor(conversationId: string) {
      const known = patients.current.get(conversationId)
      if (known) return known
      const { data } = await supabase
        .from('whatsapp_conversations')
        .select('episode_id, care_episodes(patients(full_name))')
        .eq('id', conversationId)
        .maybeSingle()
      const row = data as { episode_id: string; care_episodes: { patients: { full_name: string } | null } | null } | null
      const found = { episode_id: row?.episode_id ?? null, patient_name: row?.care_episodes?.patients?.full_name ?? null }
      patients.current.set(conversationId, found)
      return found
    }

    const channel = supabase
      .channel(`whatsapp-feed-${hospitalId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whatsapp_messages', filter: `hospital_id=eq.${hospitalId}` },
        async (payload) => {
          const row = payload.new as Omit<FeedMessage, 'episode_id' | 'patient_name'>
          const who = await patientFor(row.conversation_id)
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [{ ...row, ...who }, ...prev].slice(0, limit)))
          setArrived((prev) => new Set(prev).add(row.id))
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_messages', filter: `hospital_id=eq.${hospitalId}` },
        (payload) => {
          const row = payload.new as Partial<FeedMessage> & { id: string }
          // A voice note's transcript and the English arrive after the message itself.
          setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, content: row.content ?? m.content, metadata: row.metadata ?? m.metadata } : m)))
        })
      .subscribe((status) => setLive(status === 'SUBSCRIBED'))
    return () => { supabase.removeChannel(channel) }
  }, [hospitalId, limit, supabase])

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h2 className="text-base font-medium">WhatsApp messages</h2>
        <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', live ? 'text-success' : 'text-muted-foreground')}>
          <span className="relative flex h-2 w-2" aria-hidden="true">
            {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:hidden" />}
            <span className={cn('relative inline-flex h-2 w-2 rounded-full', live ? 'bg-success' : 'bg-muted-foreground/50')} />
          </span>
          {live ? 'Live' : 'Connecting…'}
        </span>
      </div>

      {messages.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">
          No messages yet. When a patient writes{whatsappNumber ? <> to <span className="font-medium text-foreground tnum">{formatPhone(whatsappNumber)}</span></> : null} on WhatsApp, it shows here as it arrives.
        </p>
      ) : (
        <ul className="divide-y" aria-live="polite">
          {messages.map((m) => {
            const sender = senderOf(m)
            const { icon: Icon, className } = AVATAR[sender.kind]
            const sameDay = fmt(m.created_at, 'yyyy-MM-dd', tz) === today
            const row = (
              <>
                <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', className)} aria-hidden="true">
                  {m.message_type === 'audio' ? <Mic className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm">
                      <span className="font-medium">{m.patient_name ?? 'Unknown patient'}</span>
                      <span className="text-muted-foreground"> · {sender.label}</span>
                    </span>
                    <time dateTime={m.created_at} className="shrink-0 text-xs text-muted-foreground tnum">
                      {fmt(m.created_at, sameDay ? 'HH:mm' : 'd MMM, HH:mm', tz)}
                    </time>
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{previewOf(m)}</span>
                </span>
              </>
            )
            const rowClass = cn(
              'flex items-start gap-3 px-5 py-3',
              arrived.has(m.id) && 'bg-brand-tint/60 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-300',
            )
            return (
              <li key={m.id}>
                {m.episode_id ? (
                  <NavLink href={`/episodes/${m.episode_id}?tab=conversation`} className={cn(rowClass, 'transition-colors duration-200 hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none')}>
                    {row}
                  </NavLink>
                ) : (
                  <div className={rowClass}>{row}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
