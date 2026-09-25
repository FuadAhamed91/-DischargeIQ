'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import Link from 'next/link'
import { Mic, AlertCircle, MessageCircle, Send, Loader2, Bot, UserRound, Users, Check, CheckCheck, Languages, Play, EarOff } from 'lucide-react'
import { format, isSameDay, isToday, isYesterday } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { ConversationStateRecord } from '@/lib/whatsapp/fsm'
import { summariseNumberSession } from '@/lib/whatsapp/number-session'
import type { NumberSessionSummary } from '@/lib/whatsapp/number-session'
import { VOICE_NOTES_BUCKET } from '@/lib/whatsapp/voice-note'
import type { VoiceNoteMeta } from '@/lib/whatsapp/voice-note'
import { SUPPORTED_LANGUAGES } from '@/types/enums'
import type { LanguageCode } from '@/types/enums'

export interface TranscriptMessage {
  id: string
  direction: 'inbound' | 'outbound'
  message_type: 'text' | 'interactive' | 'audio' | 'template'
  /** For a voice note: the transcript, once it has been heard. */
  content: string | null
  status: 'sent' | 'delivered' | 'read' | 'failed'
  metadata: Record<string, unknown> | null
  /** A voice note's audio in the voice-notes bucket. */
  media_storage_path?: string | null
  created_at: string
}

/** Another patient with an open episode on the same WhatsApp number. */
export interface SharedNumberPatient {
  episodeId: string
  patientId: string
  patientName: string
}

export type { NumberSessionSummary } from '@/lib/whatsapp/number-session'

interface ConversationTranscriptProps {
  episodeId: string
  initialMessages: TranscriptMessage[]
  conversationId: string | null
  patientId: string
  patientName: string
  patientPhone: string
  /** The patient's language: what they receive, and what "Show English" translates from. */
  patientLanguage: LanguageCode
  conversationState: ConversationStateRecord
  /** Other patients whose open episode uses the same number (empty when the number is theirs alone). */
  sharedWith?: SharedNumberPatient[]
  numberSession?: NumberSessionSummary | null
  /** Clinical role on an open episode: shows the composer. */
  canSend: boolean
  currentUserId: string
}

const STATE_LABELS: Record<string, string> = {
  idle: 'Assistant is answering',
  awaiting_reminder_response: 'Waiting for a reply',
  awaiting_checkin_meds: 'Waiting for tonight’s medicines answer',
  awaiting_checkin_symptoms: 'Waiting for tonight’s symptoms answer',
  awaiting_appointment_confirm: 'Waiting for appointment confirmation',
  awaiting_slot_selection: 'Waiting for slot selection',
  nurse_attending: 'You are chatting — assistant paused',
}

/** How an inbound message on a shared number was matched to this patient (metadata.routing.via). */
const ROUTING_LABELS: Record<string, string> = {
  choice: 'sender chose this patient',
  name: 'named in the message',
  reply: 'reply to the pending question',
  recent: 'last patient written about',
  emergency: 'emergency — best guess',
  fallback: 'best guess — sender did not say',
}

function routingLabel(m: TranscriptMessage): string | null {
  const meta = m.metadata ?? {}
  if (meta.answer === true) return 'answered “who is this about?”'
  const routing = meta.routing as { via?: string } | undefined
  if (!routing?.via || routing.via === 'only') return null
  return ROUTING_LABELS[routing.via] ?? routing.via
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(date, 'EEEE, d MMMM yyyy')
}

/** The WhatsApp profile name of whoever typed an inbound message, when it is not simply the patient. */
function typedBy(m: TranscriptMessage, patientName: string): string | null {
  const name = m.metadata?.sender_name
  if (typeof name !== 'string' || !name.trim()) return null
  const norm = (v: string) => v.trim().toLowerCase()
  const first = norm(patientName).split(' ')[0]
  if (norm(name) === norm(patientName) || norm(name) === first || norm(name).startsWith(first + ' ')) return null
  return name.trim()
}

type SenderKind = 'patient' | 'nurse' | 'assistant'

function senderOf(m: TranscriptMessage): { kind: SenderKind; name: string | null } {
  if (m.direction === 'inbound') return { kind: 'patient', name: null }
  const meta = m.metadata ?? {}
  if (meta.sender === 'nurse') return { kind: 'nurse', name: typeof meta.sender_name === 'string' ? meta.sender_name : 'Nurse' }
  if (meta.kind === 'routing_prompt') return { kind: 'assistant', name: 'CareLoop · asked who the message is about' }
  return { kind: 'assistant', name: 'CareLoop' }
}

/** A second line inside a bubble (the English, or what the nurse typed), tinted for that bubble. */
const SECOND_LINE: Record<SenderKind, string> = {
  nurse: 'border-brand-foreground/25 text-brand-foreground/85',
  assistant: 'border-brand/20 text-brand/80',
  patient: 'border-foreground/15 text-muted-foreground',
}

/** A voice note that was not heard clearly enough to act on: its clarity (0–100, or null when unknown). */
function unclearVoice(m: TranscriptMessage): { clarity: number | null } | null {
  if (m.message_type !== 'audio') return null
  const voice = m.metadata?.voice as Partial<VoiceNoteMeta> | undefined
  if (!voice || voice.clear !== false) return null
  return { clarity: typeof voice.clarity === 'number' ? voice.clarity : null }
}

/** Plays a stored voice note through a short-lived signed URL, fetched on the first press. */
function VoiceNotePlayer({ path, supabase }: { path: string; supabase: ReturnType<typeof createClient> }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.storage.from(VOICE_NOTES_BUCKET).createSignedUrl(path, 60 * 60)
    setLoading(false)
    if (error || !data?.signedUrl) {
      setFailed(true)
      return
    }
    setUrl(data.signedUrl)
  }

  if (url) return <audio controls autoPlay src={url} className="mt-2 h-9 w-full min-w-52 max-w-72" />
  return (
    <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading} className="mt-2 h-7 gap-1.5 bg-background/60 text-xs">
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
      {failed ? 'Could not load — try again' : 'Listen'}
    </Button>
  )
}

/** What a nurse typed when it was sent to the patient in translation. */
function originalOf(m: TranscriptMessage): string | null {
  const original = m.metadata?.original_text
  return typeof original === 'string' && original.trim() ? original : null
}

/**
 * Worth translating for the nurse: it has words (not just "1" or 👍), and it
 * is not a translated nurse message — that one already shows what was typed.
 */
function wantsEnglish(m: TranscriptMessage): boolean {
  const text = m.content?.trim()
  if (!text || !/\p{L}/u.test(text)) return false
  return originalOf(m) === null
}

/** The English for a message: kept on the row by the translate route, or fetched on this page. */
function englishOf(m: TranscriptMessage, fetched: Record<string, string>): string | null {
  const kept = m.metadata?.translation_en
  if (typeof kept === 'string') return kept
  return fetched[m.id] ?? null
}

const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

/** Message ids one request may carry (the route takes at most this many). */
const IDS_PER_REQUEST = 50

/**
 * Messages to translate, newest first (the transcript opens at the bottom).
 * They go in one request: the route asks the model once per distinct *text*,
 * so a conversation of repeated check-ins is a single call, and asking eight
 * at a time would only add round trips to a nurse's wait. A transcript longer
 * than one request follows in the groups behind it.
 */
function englishGroups(list: TranscriptMessage[]): string[][] {
  const ids = [...list].reverse().map((m) => m.id)
  const groups: string[][] = []
  for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) groups.push(ids.slice(i, i + IDS_PER_REQUEST))
  return groups
}

/** Translate requests in flight at once, after the first; the rest follow as these come back. */
const ENGLISH_REQUESTS_AT_ONCE = 4

// "Show English" is a per-browser preference: a nurse who needs it needs it on every patient.
const SHOW_ENGLISH_KEY = 'careloop:transcript-show-english'
const SHOW_ENGLISH_EVENT = 'careloop:show-english'
let showEnglishInMemory = false  // when storage is blocked (private window): this page load only

function readShowEnglish(): boolean {
  try {
    const stored = localStorage.getItem(SHOW_ENGLISH_KEY)
    return stored === null ? showEnglishInMemory : stored === '1'
  } catch {
    return showEnglishInMemory
  }
}

function writeShowEnglish(on: boolean): void {
  showEnglishInMemory = on
  try { localStorage.setItem(SHOW_ENGLISH_KEY, on ? '1' : '0') } catch { /* kept in memory */ }
  window.dispatchEvent(new Event(SHOW_ENGLISH_EVENT))
}

function subscribeShowEnglish(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  window.addEventListener(SHOW_ENGLISH_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(SHOW_ENGLISH_EVENT, onChange)
  }
}

export function ConversationTranscript({
  episodeId,
  initialMessages,
  conversationId,
  patientId,
  patientName,
  patientPhone,
  patientLanguage,
  conversationState,
  sharedWith = [],
  numberSession = null,
  canSend,
  currentUserId,
}: ConversationTranscriptProps) {
  const [messages, setMessages] = useState<TranscriptMessage[]>(initialMessages)
  const [state, setState] = useState<ConversationStateRecord>(conversationState)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [handingBack, setHandingBack] = useState(false)
  const [session, setSession] = useState<NumberSessionSummary | null>(numberSession)
  const [forgetting, setForgetting] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const sendingNow = useRef(false)
  const supabase = useMemo(() => createClient(), [])

  // A patient who does not read English gets the nurse's messages translated
  // (composer), and the nurse can read the whole conversation in English.
  const foreign = patientLanguage !== 'en'
  const languageName = SUPPORTED_LANGUAGES[patientLanguage] ?? patientLanguage
  const [translateOutgoing, setTranslateOutgoing] = useState(true)
  const showEnglish = useSyncExternalStore(subscribeShowEnglish, readShowEnglish, () => false)
  const [fetchedEnglish, setFetchedEnglish] = useState<Record<string, string>>({})
  const [noEnglish, setNoEnglish] = useState<ReadonlySet<string>>(new Set())
  const [englishError, setEnglishError] = useState<string | null>(null)
  // Messages translated one at a time with their own "Translate" button.
  const [openEnglish, setOpenEnglish] = useState<ReadonlySet<string>>(new Set())
  const requestedEnglish = useRef(new Set<string>())
  const englishInFlight = useRef(0)
  // Bumped as each request settles, so the next waiting group always gets its turn.
  const [englishSettled, setEnglishSettled] = useState(0)

  const englishOn = foreign && showEnglish
  const englishShown = (m: TranscriptMessage) => englishOn || openEnglish.has(m.id)
  const missingEnglish = messages.filter((m) =>
    englishShown(m) && wantsEnglish(m) && englishOf(m, fetchedEnglish) === null && !noEnglish.has(m.id))
  const missingKey = englishGroups(missingEnglish).map((group) => group.join(',')).join('|')
  const translatingEnglish = englishOn && missingEnglish.length > 0 && !englishError

  // Translate whatever is shown in English but has none yet: everything once
  // "Show English" is on (and each new message while it stays on), or the one
  // message whose Translate button was pressed.
  useEffect(() => {
    if (!missingKey || englishError) return
    // The first answer carries the English for the whole transcript (the route
    // reuses one translation for every copy of a text), so it goes on its own:
    // four requests opening together would each read the same repeated
    // check-in. Whatever is still missing afterwards fans out.
    const atOnce = englishSettled === 0 ? 1 : ENGLISH_REQUESTS_AT_ONCE
    for (const group of missingKey.split('|')) {
      if (englishInFlight.current >= atOnce) break
      const ids = group.split(',').filter((id) => !requestedEnglish.current.has(id))
      if (ids.length === 0) continue
      for (const id of ids) requestedEnglish.current.add(id)
      englishInFlight.current += 1
      void fetch(`/api/v1/episodes/${episodeId}/messages/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
        .then(async (res) => {
          const json = (await res.json().catch(() => ({}))) as { data?: { translations: Record<string, string> }; error?: string; message?: string }
          if (!res.ok || !json.data) throw new Error(json.message ?? json.error ?? 'Could not translate')
          const got = json.data.translations
          setFetchedEnglish((prev) => ({ ...prev, ...got }))
          // Left out by the model: say so on the bubble instead of asking again and again.
          const left = ids.filter((id) => !got[id])
          if (left.length > 0) setNoEnglish((prev) => new Set([...prev, ...left]))
        })
        .catch((err: unknown) => {
          for (const id of ids) requestedEnglish.current.delete(id)
          setEnglishError(err instanceof Error ? err.message : 'Could not translate')
        })
        .finally(() => {
          englishInFlight.current -= 1
          setEnglishSettled((n) => n + 1)
        })
    }
  }, [missingKey, englishError, englishSettled, episodeId])

  function retryEnglish() {
    for (const id of noEnglish) requestedEnglish.current.delete(id)
    setNoEnglish(new Set())
    setEnglishError(null)
  }

  /** One message's own Translate button: show (translating it if need be) or hide its English. */
  function toggleMessageEnglish(id: string) {
    const opening = !openEnglish.has(id)
    setOpenEnglish((prev) => {
      const next = new Set(prev)
      if (opening) next.add(id)
      else next.delete(id)
      return next
    })
    if (opening) {
      // Pressing it is also the retry for this message.
      requestedEnglish.current.delete(id)
      setNoEnglish((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setEnglishError(null)
    }
  }

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
      // Rows change in place: delivery receipts (sent → delivered → read, or
      // failed), translations, and a voice note once it has been heard.
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'whatsapp_messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const updated = payload.new as TranscriptMessage
        setMessages((prev) => prev.map((m) => (m.id === updated.id
          ? { ...m, status: updated.status, metadata: updated.metadata, content: updated.content ?? m.content, media_storage_path: updated.media_storage_path ?? m.media_storage_path }
          : m)))
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversationId, supabase])

  // Shared number: follow the routing session as the webhook writes it, so
  // "currently taken to be about …" and "waiting for the sender" are live.
  useEffect(() => {
    if (sharedWith.length === 0) return
    const channel = supabase
      .channel(`number-session-${patientPhone}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'whatsapp_number_sessions',
        filter: `wa_phone=eq.${patientPhone}`,
      }, (payload) => {
        const row = payload.new as { active_patient_id: string | null; active_until: string | null; pending_choice: unknown } | null
        setSession(row && 'active_patient_id' in row ? summariseNumberSession(row) : { activePatientId: null, choicePending: false })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [patientPhone, sharedWith.length, supabase])

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

  /** Sends the draft, or — from the "Send as typed" toast — exactly the text that could not be translated. */
  async function send(retry?: { text: string; translate: false }) {
    const text = retry?.text ?? draft.trim()
    if (!text || sendingNow.current) return
    const translate = retry ? retry.translate : foreign && translateOutgoing
    sendingNow.current = true
    setSending(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, translate }),
      })
      const json = (await res.json()) as {
        data?: { message: TranscriptMessage | null; conversation_state: ConversationStateRecord }
        error?: string
        message?: string
        code?: string
      }
      if (json.code === 'translation_failed') {
        // Nothing went out. Whether the patient gets it untranslated is the nurse's call.
        toast.error(json.error ?? `Could not translate into ${languageName}`, {
          description: json.message,
          duration: 15_000,
          action: { label: 'Send as typed', onClick: () => void send({ text, translate: false }) },
        })
        return
      }
      if (!res.ok || !json.data) {
        throw new Error(json.message ? `${json.error}: ${json.message}` : (json.error ?? 'Could not send'))
      }
      if (json.data.message) {
        const logged = json.data.message
        setMessages((prev) => (prev.some((m) => m.id === logged.id) ? prev : [...prev, logged]))
      }
      setState(json.data.conversation_state)
      setDraft((current) => (current.trim() === text ? '' : current))
      textareaRef.current?.focus()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the message')
    } finally {
      sendingNow.current = false
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

  // Shared number: who the sender is currently taken to be writing about.
  const shared = sharedWith.length > 0
  const activeIsThisPatient = session?.activePatientId === patientId
  const activeOther = sharedWith.find((p) => p.patientId === session?.activePatientId) ?? null
  const hasMemory = Boolean(session?.activePatientId || session?.choicePending)

  async function forgetRouting() {
    setForgetting(true)
    try {
      const res = await fetch(`/api/v1/episodes/${episodeId}/number-session`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Could not reset')
      setSession({ activePatientId: null, choicePending: false })
      toast.success('The next message from this number will be routed from scratch')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reset')
    } finally {
      setForgetting(false)
    }
  }

  return (
    <div className="flex flex-col" data-tour="conversation">
      {/* Toolbar: who is answering, and the reading aids. (Name and number are in the page header.) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
        <Badge variant="outline" className={cn('text-xs', attending ? 'border-brand/30 bg-brand-soft text-brand' : state.state === 'idle' ? 'text-muted-foreground' : 'border-warning/30 bg-warning-soft text-warning')}>
          {attending ? <UserRound className="mr-1 h-3 w-3" aria-hidden="true" /> : <Bot className="mr-1 h-3 w-3" aria-hidden="true" />}
          {stateLabel}
        </Badge>
        <div className="flex flex-wrap items-center gap-2">
          {foreign && messages.length > 0 && (
            <Button
              type="button"
              variant={showEnglish ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => writeShowEnglish(!showEnglish)}
              aria-pressed={showEnglish}
              className="h-8 text-xs"
              title={showEnglish ? 'Hide the English translations' : `Show an English translation under each ${languageName} message`}
            >
              {englishOn && translatingEnglish
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                : <Languages className="h-3.5 w-3.5" aria-hidden="true" />}
              {showEnglish ? 'Showing English' : 'Show English'}
            </Button>
          )}
          {attending && canSend && (
            <Button type="button" variant="ghost" size="sm" onClick={handBack} disabled={handingBack} className="h-8 text-xs">
              {handingBack ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Hand back to assistant
            </Button>
          )}
        </div>
      </div>

      {(englishOn || openEnglish.size > 0) && englishError && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Could not translate the conversation: {englishError}</span>
          <Button type="button" variant="ghost" size="sm" onClick={retryEnglish} className="h-6 px-1.5 text-xs">Try again</Button>
        </p>
      )}

      {/* Shared number */}
      {shared && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-foreground" role="note">
          <p className="flex items-start gap-2">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
            <span>
              <span className="font-medium">Shared number.</span> {patientPhone} is also linked to{' '}
              {sharedWith.map((p, i) => (
                <span key={p.episodeId}>
                  {i > 0 && (i === sharedWith.length - 1 ? ' and ' : ', ')}
                  <Link href={`/episodes/${p.episodeId}`} className="underline underline-offset-2 hover:text-brand">{p.patientName}</Link>
                </span>
              ))}
              . A message that does not say who it is about goes to the conversation waiting for a reply, else to the patient written about most recently; when that is unclear the sender is asked.
            </span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 pl-[22px] text-muted-foreground">
            <span>
              {session?.choicePending
                ? 'Waiting for the sender to say who their last message is about — it is held until they answer.'
                : activeIsThisPatient
                  ? `Messages from this number are currently taken to be about ${patientName.split(' ')[0]}.`
                  : activeOther
                    ? `Messages from this number are currently taken to be about ${activeOther.patientName.split(' ')[0]}.`
                    : 'The next message without a name will be asked about, unless one conversation is waiting for a reply.'}
            </span>
            {hasMemory && canSend && (
              <Button type="button" variant="ghost" size="sm" onClick={forgetRouting} disabled={forgetting} className="h-6 px-1.5 text-xs" title="Forget who this number is writing about; the next message is routed from scratch">
                {forgetting ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                Forget
              </Button>
            )}
          </p>
        </div>
      )}

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
            const routed = shared ? routingLabel(m) : null
            const typist = m.direction === 'inbound' ? typedBy(m, patientName) : null
            const original = originalOf(m)
            const unclear = unclearVoice(m)
            const translatable = foreign && wantsEnglish(m)
            const english = translatable && englishShown(m) ? englishOf(m, fetchedEnglish) : null
            const showTranslation = english !== null && !sameText(english, m.content ?? '')
            const englishPending = translatable && englishShown(m) && english === null && !englishError

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
                      <div>
                        <p className="flex items-start gap-2 italic" dir="auto">
                          <Mic className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="whitespace-pre-wrap break-words">Voice note{m.content ? `: “${m.content}”` : ''}</span>
                        </p>
                        {m.media_storage_path && <VoiceNotePlayer path={m.media_storage_path} supabase={supabase} />}
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap break-words" dir="auto">{m.content || <span className="italic opacity-70">(empty message)</span>}</p>
                    )}
                    {original && (
                      <p className={cn('mt-1.5 whitespace-pre-wrap break-words border-t pt-1.5 text-xs', SECOND_LINE[sender.kind])} dir="auto" title={`Typed by ${sender.name ?? 'the nurse'}; the patient received the translation above`}>
                        <span className="mr-1 font-medium">Original:</span>{original}
                      </p>
                    )}
                    {showTranslation && (
                      <p className={cn('mt-1.5 whitespace-pre-wrap break-words border-t pt-1.5 text-xs', SECOND_LINE[sender.kind])} lang="en" title="Machine translation for the care team — the patient did not see this">
                        <span className="mr-1 font-medium">English:</span>{english}
                      </p>
                    )}
                    {englishPending && (
                      <p className={cn('mt-1.5 border-t pt-1.5 text-xs italic', SECOND_LINE[sender.kind])}>
                        {noEnglish.has(m.id) ? 'No English translation came back for this message.' : 'Translating…'}
                      </p>
                    )}
                    <div className={cn(
                      'mt-1 flex items-center gap-2 text-[11px]',
                      sender.kind === 'nurse' && 'justify-end text-brand-foreground/75',
                      sender.kind === 'assistant' && 'justify-end text-brand/60',
                      sender.kind === 'patient' && 'text-muted-foreground',
                    )}>
                      <span>{sender.kind === 'patient' ? patientName.split(' ')[0] : sender.name}</span>
                      {typist && <span title="WhatsApp profile name of the phone that sent this">(typed by {typist})</span>}
                      {m.metadata?.simulated === true && (
                        <span className="rounded-sm bg-brand-soft px-1 font-medium text-brand" title="Written in the demo’s “Reply as the patient” box, not sent from the patient’s phone">
                          Demo reply
                        </span>
                      )}
                      {unclear && (
                        <span
                          className="inline-flex items-center gap-1 rounded-sm bg-warning-soft px-1 font-medium text-warning"
                          title="Not heard clearly enough to act on: a nurse should listen to it. The words above may be wrong."
                        >
                          <EarOff className="h-3 w-3" aria-hidden="true" />
                          Unclear{unclear.clarity !== null ? ` · ${unclear.clarity}%` : ''}
                        </span>
                      )}
                      <span>·</span>
                      <span>{format(date, 'HH:mm')}</span>
                      {translatable && !englishOn && (
                        <button
                          type="button"
                          onClick={() => toggleMessageEnglish(m.id)}
                          aria-pressed={openEnglish.has(m.id)}
                          className="inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                          title={openEnglish.has(m.id) ? 'Hide the English translation' : 'Show this message in English'}
                        >
                          <Languages className="h-3 w-3" aria-hidden="true" />
                          {openEnglish.has(m.id) ? 'Hide English' : 'Translate'}
                        </button>
                      )}
                      {routed && (
                        <span className="inline-flex items-center gap-1" title="How this message was matched to this patient on the shared number">
                          <Users className="h-3 w-3" aria-hidden="true" /> {routed}
                        </span>
                      )}
                      {failed && (
                        <span className="inline-flex items-center gap-1 text-danger" title={error ?? 'Delivery failed'}>
                          <AlertCircle className="h-3 w-3" aria-hidden="true" /> Not delivered
                        </span>
                      )}
                      {outbound && !failed && m.status === 'sent' && (
                        <Check className="h-3 w-3" aria-label="Sent" />
                      )}
                      {outbound && m.status === 'delivered' && (
                        <CheckCheck className="h-3 w-3" aria-label="Delivered" />
                      )}
                      {outbound && m.status === 'read' && (
                        <CheckCheck className="h-3 w-3 text-info" aria-label="Read" />
                      )}
                    </div>
                    {failed && error && (
                      <p className="mt-1.5 rounded-md bg-danger-soft px-2 py-1 text-[11px] leading-snug text-danger">{error}</p>
                    )}
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
          data-tour="nurse-composer"
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
              placeholder={foreign && translateOutgoing
                ? `Write to ${patientName.split(' ')[0]} — it is sent in ${languageName}…`
                : `Write to ${patientName.split(' ')[0]} on WhatsApp…`}
              rows={2}
              maxLength={1000}
              disabled={sending}
              className="min-h-11 resize-none"
            />
            <Button type="submit" disabled={sending || !draft.trim()} aria-busy={sending} className="h-11 shrink-0" aria-label="Send message">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              <span className="hidden sm:inline">{sending && foreign && translateOutgoing ? 'Translating…' : 'Send'}</span>
            </Button>
          </div>
          {foreign && (
            <label className="mt-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={translateOutgoing}
                onChange={(e) => setTranslateOutgoing(e.target.checked)}
                disabled={sending}
                className="h-3.5 w-3.5 accent-brand"
              />
              Translate into {languageName} before sending
            </label>
          )}
          <p className="mt-1.5 text-xs text-muted-foreground">
            {foreign && translateOutgoing
              ? `Sent as you, in ${languageName} — ${patientName.split(' ')[0]} receives the translation, and what you typed stays on this transcript.`
              : 'Sent as you, in the language you type.'}{' '}
            The assistant stays quiet for 30 minutes after your last message; emergencies still escalate. Enter to send, Shift+Enter for a new line.
            {shared && (
              <> This number is shared with {sharedWith.map((p) => p.patientName.split(' ')[0]).join(' and ')} — say who you are writing about; replies come back to {patientName.split(' ')[0]} while you are chatting.</>
            )}
          </p>
        </form>
      )}
    </div>
  )
}
