/**
 * Processes inbound WhatsApp webhook payloads from Twilio.
 *
 * Responsibilities:
 *  1. Parse the Twilio form-encoded payload into a normalised ParsedInbound struct.
 *  2. Resolve the patient + episode by phone number and Twilio sandbox number.
 *  3. Persist the raw message in whatsapp_messages.
 *  4. Run the FSM to decide next action.
 *  5. Dispatch the action (confirm appt, log reminder, route to AI/triage).
 *  6. Persist the timeline event.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { resolveHospital, patientsOnNumber, findOpenEpisodesByPhone, getOrCreateConversation } from './recipient'
import type { ServiceClient, InboundHospital, InboundPatient, InboundEpisode, OpenEpisodeCandidate } from './recipient'
import { alreadyHandled, logInbound } from './inbound-log'
import { loadNumberSession, saveNumberSession } from './number-session'
import { redeliverFailedCarePlan } from './care-plan'
import { loadRoutingCandidates, askWhoIsThisAbout } from './shared-number'
import { routeInbound, sessionAfterDelivery, EMPTY_SESSION } from './routing'
import type { RoutedVia, RoutingDecision } from './routing'
import { buildNowAboutMessage } from './routing-templates'
import { shouldReplyToUnknown } from './unknown-number'
import { withSenderLock, senderKey } from './sender-queue'
import { sendMessage, markAsRead } from './client'
import type { OutboundMessage } from './client'
import { sendAndLog } from './outbound'
import {
  buildNotRegisteredMessage,
  buildNoOpenEpisodeMessage,
  buildEscalationAcknowledgement,
  buildAcknowledgementReply,
  buildGreetingReply,
  buildEmergencyEscalationMessage,
  buildCannotReadMediaReply,
  buildReminderThanks,
} from './templates'
import { transition, readConversationState } from './fsm'
import type { ParsedInbound, ConversationState, FsmResult } from './fsm'
import { storeVoiceNote, recordVoiceNote, heardClearly } from './voice-note'
import {
  buildCheckinSymptomQuestion,
  buildCheckinGoodnight,
  buildTriageReply,
} from './checkin-templates'
import {
  buildAppointmentConfirmedReply,
  buildNoPendingAppointmentReply,
} from './appointment-templates'
import { offerNewTimes, handleSlotReply } from './reschedule'
import type { RescheduleContext } from './reschedule'
import type { LanguageCode } from '@/types/enums'
import { classifyRisk, downloadTwilioMedia, transcribeVoiceNote, bareMimeType } from '@/lib/ai/triage'
import type { TriageResult, HeardVoiceNote } from '@/lib/ai/triage'
import { answerPatientQuestion } from '@/lib/ai/chat'
import { classifyPreIntent } from '@/lib/ai/intent'
import { raiseEpisodeRisk } from '@/lib/episodes/risk'
import type { DischargeSummary, Medication } from '@/types/database'

// ------------------------------------
// Triage persistence (voice notes, text symptom reports, nightly check-in)
// ------------------------------------

interface RecordTriageParams {
  supabase: ServiceClient
  episodeId: string
  hospitalId: string
  patient: { full_name: string; language: LanguageCode; to: string }
  reply: (outbound: OutboundMessage) => Promise<unknown>
  triage: TriageResult
  waMessageId: string
  source: 'voice' | 'text' | 'nightly_checkin'
  voiceArtifactId?: string | null
}

/**
 * Stores a triage result and tells the patient what to do next. Shared by
 * every path that classifies a symptom report so the dashboard sees one shape.
 *
 * The alert and the episode risk level are NOT written here: migration 00003
 * has AFTER INSERT triggers on triage_assessments (create_alert_on_triage,
 * sync_episode_risk_on_triage) that do both — and assign the alert to the
 * nurse. Inserting them here as well produced two alerts per red triage.
 */
async function recordTriage(params: RecordTriageParams): Promise<void> {
  const { supabase, episodeId, hospitalId, patient, reply, triage, waMessageId, source } = params

  const { error } = await supabase
    .from('triage_assessments')
    .insert({
      episode_id: episodeId,
      hospital_id: hospitalId,
      voice_artifact_id: params.voiceArtifactId ?? null,
      inbound_text: triage.transcript,
      risk_level: triage.riskLevel,
      matched_symptoms: triage.keySymptoms,
      reasoning: triage.reasoning,
      model_version: 'gemini-2.5-flash',
    })
  if (error) throw new Error(`triage_assessments insert failed: ${error.message}`)

  await reply(buildTriageReply({
    to: patient.to,
    patientName: patient.full_name,
    language: patient.language,
    riskLevel: triage.riskLevel,
  }))

  await supabase.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: hospitalId,
    event_type: 'triage_completed',
    payload: {
      risk_level: triage.riskLevel,
      transcript: triage.transcript,
      key_symptoms: triage.keySymptoms,
      source,
      wa_message_id: waMessageId,
    },
    risk_level: triage.riskLevel,
  })
}

interface AwaitingAppointment {
  id: string
  specialty: string
  scheduled_at: string
  location: string | null
}

/** The appointment a YES/NO reply refers to: by id when the channel gave one, else the latest one asked about. */
async function findAwaitingAppointment(supabase: ServiceClient, episodeId: string, appointmentId?: string): Promise<AwaitingAppointment | null> {
  let query = supabase
    .from('appointments')
    .select('id, specialty, scheduled_at, location')
    .eq('episode_id', episodeId)
  query = appointmentId
    ? query.eq('id', appointmentId)
    : query.eq('status', 'confirmation_pending').order('confirmation_requested_at', { ascending: false, nullsFirst: false })
  const { data } = await query.limit(1).maybeSingle()
  return (data as AwaitingAppointment | null) ?? null
}

interface NurseHandover {
  episodeId: string
  hospitalId: string
  reason: string
  /** untriaged_symptom_report: the model could not assess it; unclear_voice_note: it could not be heard clearly. */
  intent: 'untriaged_symptom_report' | 'unclear_voice_note'
  waMessageId: string
  text?: string
  clarity?: number | null
}

/**
 * A report the assistant could not act on — the model was unavailable, or a
 * voice note was not heard clearly: a nurse takes it (medium alert) rather
 * than it being lost, and the patient turns yellow.
 */
async function handToNurse(supabase: ServiceClient, h: NurseHandover): Promise<void> {
  await supabase.from('alerts').insert({
    episode_id: h.episodeId,
    hospital_id: h.hospitalId,
    type: 'escalation',
    severity: 'medium',
  })
  await raiseEpisodeRisk(supabase, h.episodeId, 'yellow')
  await supabase.from('patient_timeline_events').insert({
    episode_id: h.episodeId,
    hospital_id: h.hospitalId,
    event_type: 'escalation_created',
    payload: {
      reason: h.reason,
      intent: h.intent,
      severity: 'medium',
      text: h.text || null,
      wa_message_id: h.waMessageId,
      ...(h.clarity !== undefined ? { clarity: h.clarity } : {}),
    },
    risk_level: 'yellow',
  })
}

// ------------------------------------
// Voice notes
// ------------------------------------

interface VoiceNoteParams {
  supabase: ServiceClient
  hospitalId: string
  episodeId: string
  patient: { full_name: string; language: LanguageCode; to: string }
  state: ConversationState
  message: ParsedInbound
  /** The logged inbound row (null when logging failed): gets the transcript, the audio path and the clarity. */
  messageId: string | null
  reply: (outbound: OutboundMessage) => Promise<unknown>
}

type VoiceOutcome =
  /** Heard clearly: carry on as if the patient had typed the transcript. */
  | { kind: 'as_text'; message: ParsedInbound; voiceArtifactId: string | null }
  /** Already dealt with here: nothing more to do but set the state. */
  | { kind: 'handled'; nextState: ConversationState }

/**
 * A voice note: keep the audio for the nurse, hear it, and decide —
 *  - heard clearly → as if the patient had typed it (a question is answered,
 *    a check-in answer counts, a symptom is triaged);
 *  - not clearly → a nurse listens (medium alert, patient yellow), unless
 *    what was heard is red: an emergency never waits for someone to press play;
 *  - while a nurse is chatting → only a red result is acted on; the nurse
 *    hears the rest.
 */
async function takeVoiceNote(p: VoiceNoteParams): Promise<VoiceOutcome> {
  const { supabase, hospitalId, episodeId, patient, state, message, messageId, reply } = p
  const attending = state === 'nurse_attending'
  const settled: ConversationState = attending ? 'nurse_attending' : 'idle'

  let heard: HeardVoiceNote
  let audioPath: string | null = null
  try {
    if (!message.audioUrl) throw new Error('the voice note came without a media URL')
    const mimeType = bareMimeType(message.audioMimeType ?? 'audio/ogg')
    const audio = await downloadTwilioMedia(message.audioUrl)
    audioPath = await storeVoiceNote(supabase, { hospitalId, episodeId, name: message.waMessageId, audio, mimeType })
    heard = await transcribeVoiceNote(audio, mimeType)
  } catch (err) {
    // Never lost: a nurse gets it, with the audio when it was saved.
    console.error('[Voice note] could not be heard:', err)
    if (messageId && audioPath) await recordVoiceNote(supabase, messageId, { transcript: '', clarity: null, audioPath })
    if (!attending) await reply(buildEscalationAcknowledgement({ to: patient.to, patientName: patient.full_name, language: patient.language }))
    await handToNurse(supabase, {
      episodeId, hospitalId, intent: 'untriaged_symptom_report', waMessageId: message.waMessageId,
      reason: audioPath
        ? 'Voice note could not be transcribed automatically — listen to it on the Conversation tab'
        : 'Voice note could not be downloaded or transcribed automatically',
    })
    return { kind: 'handled', nextState: settled }
  }

  if (messageId) await recordVoiceNote(supabase, messageId, { ...heard, audioPath })
  const voiceArtifactId = messageId && audioPath
    ? await saveVoiceArtifact(supabase, { episodeId, hospitalId, messageId, audioPath, transcript: heard.transcript })
    : null
  const redNow = () => actOnRedOnly(p, heard.transcript, voiceArtifactId)

  if (attending) {
    if (heard.transcript) await redNow()
    return { kind: 'handled', nextState: 'nurse_attending' }
  }

  if (heardClearly(heard)) {
    return { kind: 'as_text', message: { ...message, type: 'text', text: heard.transcript }, voiceArtifactId }
  }

  if (heard.transcript && (await redNow())) return { kind: 'handled', nextState: 'idle' }

  await reply(buildEscalationAcknowledgement({ to: patient.to, patientName: patient.full_name, language: patient.language }))
  await handToNurse(supabase, {
    episodeId, hospitalId, intent: 'unclear_voice_note', waMessageId: message.waMessageId,
    text: heard.transcript, clarity: heard.clarity,
    reason: heard.clarity === null
      ? 'Voice note — how clearly it was heard is unknown; listen to it on the Conversation tab'
      : `Voice note unclear (clarity ${heard.clarity}%) — listen to it on the Conversation tab`,
  })
  return { kind: 'handled', nextState: 'idle' }
}

/**
 * Triage on the words of a voice note that is not otherwise acted on, and act
 * only when it is red. True when it was.
 */
async function actOnRedOnly(p: VoiceNoteParams, transcript: string, voiceArtifactId: string | null): Promise<boolean> {
  const { supabase, episodeId, hospitalId, patient, message, reply } = p
  try {
    const { data: summary } = await supabase
      .from('discharge_summaries')
      .select('emergency_symptoms')
      .eq('episode_id', episodeId)
      .maybeSingle()
    const triage = await classifyRisk({
      transcript,
      emergencySymptoms: (summary?.emergency_symptoms as string[]) ?? [],
      patientName: patient.full_name,
    })
    if (triage.riskLevel !== 'red') return false
    await recordTriage({ supabase, episodeId, hospitalId, patient, reply, triage, waMessageId: message.waMessageId, source: 'voice', voiceArtifactId })
    return true
  } catch (err) {
    console.error('[Voice note] triage of what was heard failed:', err)
    return false
  }
}

/** The voice_artifacts row the triage assessment links to. */
async function saveVoiceArtifact(
  supabase: ServiceClient,
  a: { episodeId: string; hospitalId: string; messageId: string; audioPath: string; transcript: string },
): Promise<string | null> {
  const { data, error } = await supabase
    .from('voice_artifacts')
    .insert({
      episode_id: a.episodeId,
      hospital_id: a.hospitalId,
      message_id: a.messageId,
      audio_storage_path: a.audioPath,
      transcript: a.transcript || null,
    })
    .select('id')
    .single()
  if (error) console.error('[Voice note] voice_artifacts insert failed:', error.message)
  return (data as { id: string } | null)?.id ?? null
}

// ------------------------------------
// Main handler
// ------------------------------------

export interface HandlerDeps {
  /** Injected by scripts/check-webhook.ts (in-memory fake); production uses the service client. */
  supabase?: ServiceClient
}

export async function handleInboundMessage(
  phoneNumberId: string,
  message: ParsedInbound,
  deps: HandlerDeps = {},
): Promise<void> {
  const supabase = deps.supabase ?? (await createServiceClient())

  // 0. A redelivered webhook carries a SID we have already answered.
  if (await alreadyHandled(supabase, message.waMessageId)) {
    console.warn('[WhatsApp] duplicate delivery ignored:', message.waMessageId)
    return
  }

  // 1. Resolve hospital from phone_number_id
  const hospital = await resolveHospital(supabase, phoneNumberId)
  if (!hospital) {
    console.error('[WhatsApp] No hospital found for phone_number_id:', phoneNumberId)
    return
  }

  // 2 + 3. Every open episode behind this number. A number is not unique to
  // one patient (a shared family phone, a tester's own number on several demo
  // patients); the old single-row lookup failed on the second registration
  // and answered "not registered" to a patient who very much was.
  const candidates = await findOpenEpisodesByPhone(supabase, hospital.id, message.from)

  if (candidates.length === 0) {
    // Once an hour per number: a stranger's fourth message gets no fourth reply.
    if (!shouldReplyToUnknown(`${phoneNumberId}|${message.from}`)) return
    const known = await patientsOnNumber(supabase, hospital.id, message.from)
    if (known.length > 0) {
      // Registered, but every episode is closed — by name when the number is
      // one patient's, in their language when everyone on it shares one.
      const languages = new Set(known.map((p) => p.preferred_language))
      const language = languages.size === 1 ? known[0].preferred_language : 'en'
      await sendMessage(phoneNumberId, buildNoOpenEpisodeMessage(message.from, known.length === 1 ? known[0].full_name : null, language))
    } else {
      await sendMessage(phoneNumberId, buildNotRegisteredMessage(message.from))
    }
    return
  }

  // 4. Which patient is this message about? One open episode: no question.
  // Several (a shared family phone, a caregiver, a tester's own number): the
  // number's session and the routing rules decide, and when they cannot,
  // the sender is asked and the message held until they answer.
  const shared = candidates.length > 1
  const session = shared ? await loadNumberSession(supabase, hospital.id, message.from) : EMPTY_SESSION
  if (session.pendingChoice?.held?.waMessageId === message.waMessageId) {
    // A held message is not logged until it is replayed, so the SID check
    // above cannot catch its redelivery.
    console.warn('[WhatsApp] duplicate delivery of a held message ignored:', message.waMessageId)
    return
  }

  const decision = routeInbound(await loadRoutingCandidates(supabase, candidates), session, message)
  logDecision(message, candidates.length, decision)

  if (decision.kind === 'ask') {
    const asked = await askWhoIsThisAbout({
      supabase,
      phoneNumberId,
      hospitalId: hospital.id,
      phone: message.from,
      options: decision.options,
      held: decision.held,
      repeat: decision.repeat,
      session,
    })
    if (asked || !decision.held) {
      await redeliverOnSharedNumber(supabase, phoneNumberId, hospital, message.from, candidates, null)
      return
    }
    // The question never reached them (Twilio down, number left the
    // sandbox). Rather than hold a message nobody will unlock, handle it for
    // the likeliest patient and say so on the transcript.
    const likeliest = decision.options[0]
    const target = candidates.find((c) => c.patient.id === likeliest.patientId) ?? candidates[0]
    await processForPatient({
      supabase, phoneNumberId, hospital, patient: target.patient, episode: target.episode,
      message: decision.held, routing: { via: 'fallback', linkedPatients: candidates.length },
    })
    await flagBestGuess(supabase, hospital.id, target.episode.id, decision.held, candidates.length)
    await redeliverOnSharedNumber(supabase, phoneNumberId, hospital, message.from, candidates, target.episode.id)
    return
  }

  const target = candidates.find((c) => c.patient.id === decision.candidate.patientId) ?? candidates[0]
  const routing = shared ? { via: decision.via, linkedPatients: candidates.length } : undefined
  if (shared) await saveNumberSession(supabase, hospital.id, message.from, sessionAfterDelivery(decision.candidate))

  if (decision.kind === 'switched') {
    await confirmSwitch({ supabase, phoneNumberId, hospital, patient: target.patient, episode: target.episode, message, routing })
    await redeliverOnSharedNumber(supabase, phoneNumberId, hospital, message.from, candidates, null)
    return
  }

  // A bare "2" answers the question and carries nothing to act on, but the
  // transcript should still show it next to the message it unlocked.
  if (decision.via === 'choice' && !decision.messages.some((m) => m.waMessageId === message.waMessageId)) {
    await logRoutingAnswer({ supabase, phoneNumberId, hospital, patient: target.patient, episode: target.episode, message, routing })
  }

  // A held message replays first, then the one that answered the question.
  for (const routed of decision.messages) {
    await processForPatient({ supabase, phoneNumberId, hospital, patient: target.patient, episode: target.episode, message: routed, routing })
  }
  if (decision.via === 'fallback') {
    await flagBestGuess(supabase, hospital.id, target.episode.id, decision.messages[decision.messages.length - 1], candidates.length)
  }
  if (shared) await redeliverOnSharedNumber(supabase, phoneNumberId, hospital, message.from, candidates, target.episode.id)
}

type OneOrMany<T> = T | T[] | null
const one = <T>(value: OneOrMany<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value)

/**
 * A message written on a demo patient's behalf from their page ("Reply as
 * Fatima"), for judges who cannot hold the patient's phone. It is handled
 * exactly as if it had come from that phone: logged on the conversation,
 * answered, triaged and escalated by the same code, and the replies go out
 * on WhatsApp. The patient is known, so the shared-number routing is
 * skipped; the row is marked `simulated` so the transcript can say so.
 * False when the episode, its patient's number or the hospital's is missing.
 */
export async function handleSimulatedPatientMessage(
  params: { episodeId: string; text: string },
  deps: HandlerDeps = {},
): Promise<boolean> {
  const supabase = deps.supabase ?? (await createServiceClient())
  const { data, error } = await supabase
    .from('care_episodes')
    .select('id, status, hospitals(id, name, timezone, settings, whatsapp_phone_number_id), patients(id, full_name, preferred_language, hospital_id, phone_e164)')
    .eq('id', params.episodeId)
    .single()
  if (error || !data) {
    console.error('[WhatsApp] simulated reply: episode not found:', params.episodeId, error?.message)
    return false
  }
  const row = data as unknown as {
    id: string
    status: string
    hospitals: OneOrMany<InboundHospital & { whatsapp_phone_number_id: string | null }>
    patients: OneOrMany<InboundPatient & { phone_e164: string | null }>
  }
  const hospital = one(row.hospitals)
  const patient = one(row.patients)
  if (!hospital?.whatsapp_phone_number_id || !patient?.phone_e164) return false
  const phoneNumberId = hospital.whatsapp_phone_number_id
  const phone = patient.phone_e164

  const message: ParsedInbound = {
    waMessageId: `SIM${crypto.randomUUID().replace(/-/g, '')}`,
    from: phone,
    senderName: patient.full_name,
    type: 'text',
    text: params.text,
    timestamp: Math.floor(Date.now() / 1000),
  }
  await withSenderLock(senderKey(phoneNumberId, phone), () => processForPatient({
    supabase,
    phoneNumberId,
    hospital,
    patient,
    episode: { id: row.id, status: row.status },
    message,
    extraMetadata: { simulated: true },
  }))
  return true
}

/**
 * WhatsApp's 24-hour window belongs to the phone, not to the patient a
 * message was about: a family phone writing about Farzana has just made it
 * possible to deliver Umar's care plan too. Every patient on the number whose
 * last plan never got through gets it now (the routed patient's own is
 * handled in processForPatient, before their reply). Only existing
 * conversations are looked at, and who the number is taken to be writing
 * about does not change.
 */
async function redeliverOnSharedNumber(
  supabase: ServiceClient,
  phoneNumberId: string,
  hospital: InboundHospital,
  phone: string,
  candidates: OpenEpisodeCandidate[],
  handledEpisodeId: string | null,
): Promise<void> {
  const others = candidates.filter((c) => c.episode.id !== handledEpisodeId)
  if (others.length === 0) return
  const { data } = await supabase
    .from('whatsapp_conversations')
    .select('id, episode_id')
    .in('episode_id', others.map((c) => c.episode.id))
  const conversationByEpisode = new Map(((data ?? []) as Array<{ id: string; episode_id: string }>).map((c) => [c.episode_id, c.id]))

  for (const c of others) {
    const conversationId = conversationByEpisode.get(c.episode.id)
    if (!conversationId) continue
    try {
      await redeliverFailedCarePlan({
        supabase,
        conversationId,
        episodeId: c.episode.id,
        hospital: { id: hospital.id, name: hospital.name, whatsapp_phone_number_id: phoneNumberId, timezone: hospital.timezone },
        patient: { id: c.patient.id, full_name: c.patient.full_name, phone, preferred_language: c.patient.preferred_language },
      })
    } catch (err) {
      console.error(`[WhatsApp] care plan re-send for episode ${c.episode.id} on a shared number failed:`, err)
    }
  }
}

/**
 * A message went to this patient because the sender would not say who it
 * was about (or the question could not be sent). Whatever it triggered may
 * belong to the other patient on the number — a nurse should glance at it.
 */
async function flagBestGuess(
  supabase: ServiceClient,
  hospitalId: string,
  episodeId: string,
  message: ParsedInbound,
  linkedPatients: number,
): Promise<void> {
  await supabase.from('alerts').insert({
    episode_id: episodeId,
    hospital_id: hospitalId,
    type: 'escalation',
    severity: 'low',
  })
  await supabase.from('patient_timeline_events').insert({
    episode_id: episodeId,
    hospital_id: hospitalId,
    event_type: 'escalation_created',
    payload: {
      reason: `Message matched to this patient by best guess — the number is shared by ${linkedPatients} patients and the sender did not say who it was about`,
      intent: 'shared_number_best_guess',
      severity: 'low',
      wa_message_id: message.waMessageId,
      text: message.text ?? null,
    },
  })
}

interface RoutingInfo {
  via: RoutedVia
  linkedPatients: number
}

/** Last four digits only: enough to follow one sender through the logs, not enough to identify them. */
function maskPhone(phone: string): string {
  return `…${phone.slice(-4)}`
}

/**
 * One line per inbound message in the server logs — the first place to look
 * when "a patient's reply wasn't handled" (README → Troubleshooting).
 */
function logDecision(message: ParsedInbound, linkedPatients: number, decision: RoutingDecision): void {
  const who = decision.kind === 'ask' ? `ask ${decision.options.length} options${decision.held ? ', holding' : ''}${decision.repeat ? ', repeat' : ''}` : `${decision.kind} → ${decision.candidate.patientId} (${decision.via})`
  console.log(`[WhatsApp] ${message.waMessageId} from ${maskPhone(message.from)} type=${message.type} linked=${linkedPatients} ${who}`)
}

interface PatientMessageParams {
  supabase: ServiceClient
  phoneNumberId: string
  hospital: InboundHospital
  patient: InboundPatient
  episode: InboundEpisode
  message: ParsedInbound
  /** Set when the number is linked to more than one patient: how this message was matched. */
  routing?: RoutingInfo
  /** Stored on the inbound row with the rest of its metadata (a demo reply is marked `simulated`). */
  extraMetadata?: Record<string, unknown>
}

function routingMetadata(routing?: RoutingInfo): Record<string, unknown> | undefined {
  return routing ? { routing: { via: routing.via, linked_patients: routing.linkedPatients } } : undefined
}

/** The reply that only said who a message is about: recorded on that patient's transcript, nothing to act on. */
async function logRoutingAnswer(params: PatientMessageParams): Promise<'logged' | 'duplicate' | 'failed'> {
  const { supabase, hospital, patient, episode, message, routing } = params
  const conversation = await getOrCreateConversation(supabase, {
    episodeId: episode.id,
    hospitalId: hospital.id,
    patientId: patient.id,
    phone: message.from,
  })
  if (!conversation) return 'failed'
  const metadata = { ...routingMetadata(routing), answer: true }
  const logged = await logInbound({ supabase, conversationId: conversation.id, hospitalId: hospital.id, message, metadata })
  return logged.status
}

/** A bare name or a choice with nothing to pass on: log it, confirm who we are talking about now. */
async function confirmSwitch(params: PatientMessageParams): Promise<void> {
  const { supabase, phoneNumberId, hospital, patient, episode, message } = params
  if ((await logRoutingAnswer(params)) === 'duplicate') return
  await sendAndLog({
    supabase,
    phoneNumberId,
    message: buildNowAboutMessage({ to: message.from, patientName: patient.full_name, language: (patient.preferred_language as LanguageCode) ?? 'en' }),
    episodeId: episode.id,
    hospitalId: hospital.id,
    patientId: patient.id,
  })
}

// ------------------------------------
// One message, one patient
// ------------------------------------

async function processForPatient(params: PatientMessageParams): Promise<void> {
  const { supabase, phoneNumberId, hospital, patient, episode, message, routing } = params

  // 5. Get or create the conversation record (messages hang off it)
  const conversation = await getOrCreateConversation(supabase, {
    episodeId: episode.id,
    hospitalId: hospital.id,
    patientId: patient.id,
    phone: message.from,
  })
  if (!conversation) return

  const state = readConversationState(conversation.conversation_state).state

  // Every reply from here on is sent AND recorded on the conversation so the
  // dashboard transcript shows both sides. Conversation state is set in step 8.
  const reply = (outbound: OutboundMessage) =>
    sendAndLog({
      supabase,
      phoneNumberId,
      message: outbound,
      episodeId: episode.id,
      hospitalId: hospital.id,
      patientId: patient.id,
    })

  // 6. Persist inbound message. The UNIQUE wa_message_id makes this the
  // claim: if another delivery of the same SID got here first, it is already
  // replying and this one must not (Twilio retries, double-taps).
  const logged = await logInbound({
    supabase,
    conversationId: conversation.id,
    hospitalId: hospital.id,
    message,
    metadata: { ...routingMetadata(routing), ...params.extraMetadata },
  })
  if (logged.status === 'duplicate') {
    console.warn('[WhatsApp] duplicate delivery ignored:', message.waMessageId)
    return
  }
  const savedMsg = logged.status === 'logged' ? { id: logged.messageId } : null

  // 6b. A care plan that never reached this patient (sent outside WhatsApp's
  // 24-hour window, sandbox not joined) can go out now: their message just
  // opened the window. Independent of what the message says.
  await redeliverFailedCarePlan({
    supabase,
    conversationId: conversation.id,
    episodeId: episode.id,
    hospital: { id: hospital.id, name: hospital.name, whatsapp_phone_number_id: phoneNumberId, timezone: hospital.timezone },
    patient: { id: patient.id, full_name: patient.full_name, phone: message.from, preferred_language: patient.preferred_language },
  })

  const lang = (patient.preferred_language as LanguageCode) ?? 'en'
  const rescheduleContext = (): RescheduleContext => ({
    supabase,
    hospital,
    episodeId: episode.id,
    patient: { full_name: patient.full_name, language: lang, to: message.from },
    reply,
    waMessageId: message.waMessageId,
  })

  // 7. A voice note is heard first. Heard clearly, it carries on below exactly
  // as if the patient had typed the words; otherwise takeVoiceNote dealt with it.
  let inbound = message
  let voiceArtifactId: string | null = null
  let result: FsmResult
  if (message.type === 'audio') {
    const voice = await takeVoiceNote({
      supabase,
      hospitalId: hospital.id,
      episodeId: episode.id,
      patient: { full_name: patient.full_name, language: lang, to: message.from },
      state,
      message,
      messageId: savedMsg?.id ?? null,
      reply,
    })
    if (voice.kind === 'as_text') {
      inbound = voice.message
      voiceArtifactId = voice.voiceArtifactId
      result = transition(state, inbound)
    } else {
      result = { nextState: voice.nextState, action: 'noop' }
    }
  } else {
    result = transition(state, message)
  }
  const spoken = inbound !== message
  // An action may still change where the conversation goes next (a
  // reschedule reply that cannot be read keeps the times on offer).
  let nextState = result.nextState

  // 8. Execute action
  switch (result.action) {
    case 'confirm_appointment': {
      // A text "1"/"YES" carries no id: take the appointment most recently
      // asked about. (Status is confirmation_pending — a stale lookup for
      // 'pending_confirmation' here meant a "1" confirmed nothing.)
      const appointment = await findAwaitingAppointment(supabase, episode.id, result.appointmentId)

      if (!appointment) {
        await reply(buildNoPendingAppointmentReply({ to: message.from, patientName: patient.full_name, language: lang }))
        break
      }

      await supabase
        .from('appointments')
        .update({ status: 'confirmed', confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', appointment.id)

      await reply(buildAppointmentConfirmedReply({
        to: message.from,
        patientName: patient.full_name,
        language: lang,
        appointment,
        timezone: hospital.timezone ?? 'Asia/Dubai',
      }))

      await supabase.from('patient_timeline_events').insert({
        episode_id: episode.id,
        hospital_id: hospital.id,
        event_type: 'appointment_confirmed',
        payload: { appointment_id: appointment.id, specialty: appointment.specialty, wa_message_id: message.waMessageId },
      })
      break
    }

    case 'start_reschedule': {
      // "2": offer the next clinic days, numbered (lib/whatsapp/reschedule.ts).
      const appointment = await findAwaitingAppointment(supabase, episode.id, result.appointmentId)
      if (!appointment) {
        await reply(buildNoPendingAppointmentReply({ to: message.from, patientName: patient.full_name, language: lang }))
        nextState = 'idle'
        break
      }
      nextState = await offerNewTimes(rescheduleContext(), appointment)
      break
    }

    case 'choose_slot': {
      nextState = await handleSlotReply(rescheduleContext(), result.slotReply ?? '')
      break
    }

    case 'log_reminder_response':
    case 'log_symptom_ok': {
      await supabase.from('patient_timeline_events').insert({
        episode_id: episode.id,
        hospital_id: hospital.id,
        event_type: 'reminder_response',
        payload: {
          response: result.reminderResponse ?? 'symptom_ok',
          wa_message_id: message.waMessageId,
          message_id: savedMsg?.id,
        },
      })
      await reply(buildReminderThanks({ to: message.from, patientName: patient.full_name, language: lang }))
      break
    }

    case 'triage_text': {
      // Free-text symptom report (nightly check-in answer, or instead of one) — typed or spoken.
      const text = (inbound.text ?? '').trim()
      try {
        const { data: summary } = await supabase
          .from('discharge_summaries')
          .select('emergency_symptoms')
          .eq('episode_id', episode.id)
          .maybeSingle()

        const triage = await classifyRisk({
          transcript: text,
          emergencySymptoms: (summary?.emergency_symptoms as string[]) ?? [],
          patientName: patient.full_name,
        })

        await recordTriage({
          supabase,
          episodeId: episode.id,
          hospitalId: hospital.id,
          patient: { full_name: patient.full_name, language: lang, to: message.from },
          reply,
          triage,
          waMessageId: message.waMessageId,
          source: spoken ? 'voice' : state === 'idle' ? 'text' : 'nightly_checkin',
          voiceArtifactId,
        })
      } catch (err) {
        // The model is down or returned garbage: never drop a symptom report
        // on the floor. Acknowledge, and hand it to a nurse at medium.
        console.error('[Triage text] failed:', err)
        await reply(buildEscalationAcknowledgement({ to: message.from, patientName: patient.full_name, language: lang }))
        await handToNurse(supabase, {
          episodeId: episode.id, hospitalId: hospital.id, intent: 'untriaged_symptom_report',
          reason: 'Symptom report could not be triaged automatically', waMessageId: message.waMessageId, text,
        })
      }
      break
    }

    case 'log_checkin_meds': {
      const taken = result.medsTaken ?? 'all'

      // Tie the answer to the latest check-in job when there is one.
      const { data: job } = await supabase
        .from('reminder_jobs')
        .select('id')
        .eq('episode_id', episode.id)
        .eq('status', 'sent')
        .order('fire_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      // reminder_response is only written when at least some medicines were
      // taken; "none" becomes an escalation (intent missed_medication, severity
      // medium), which lib/analytics/checkins.ts also counts as an answer.
      if (taken !== 'none') {
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'reminder_response',
          payload: {
            response: taken,
            source: 'nightly_checkin',
            job_id: job?.id ?? null,
            wa_message_id: message.waMessageId,
            message_id: savedMsg?.id,
          },
        })
      }

      if (taken !== 'all') {
        const severity = taken === 'none' ? 'medium' : 'low'
        await supabase.from('alerts').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          type: 'missed_medication',
          severity,
        })
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'escalation_created',
          payload: {
            reason: taken === 'none' ? 'Patient took none of their medicines today' : 'Patient missed some medicines today',
            intent: 'missed_medication',
            severity,
            job_id: job?.id ?? null,
            wa_message_id: message.waMessageId,
          },
          risk_level: taken === 'none' ? 'yellow' : null,
        })
      }

      await reply(buildCheckinSymptomQuestion({
        to: message.from,
        patientName: patient.full_name,
        language: lang,
        medsTaken: taken,
      }))
      break
    }

    case 'checkin_ok': {
      await reply(buildCheckinGoodnight({ to: message.from, patientName: patient.full_name, language: lang }))
      break
    }

    case 'route_to_ai': {
      const text = inbound.text ?? ''
      const preIntent = classifyPreIntent(text)

      // Emergency keyword: instant, deterministic, critical — no model in the loop.
      if (preIntent === 'emergency') {
        await reply(buildEmergencyEscalationMessage({ to: message.from, patientName: patient.full_name, language: lang }))
        await supabase.from('alerts').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          type: 'escalation',
          severity: 'critical',
        })
        await raiseEpisodeRisk(supabase, episode.id, 'red')
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'escalation_created',
          payload: { reason: 'Emergency keyword in patient message', intent: 'emergency', wa_message_id: message.waMessageId },
          risk_level: 'red',
        })
        break
      }

      // Plain acknowledgement or greeting: reply instantly, no model, no alert.
      // (These used to be sent to the model, which escalated them as "unanswerable".)
      if (preIntent === 'acknowledgement' || preIntent === 'greeting') {
        const instantReply = preIntent === 'greeting'
          ? buildGreetingReply({ to: message.from, patientName: patient.full_name, language: lang })
          : buildAcknowledgementReply({ to: message.from, patientName: patient.full_name, language: lang })
        await reply(instantReply)
        break
      }

      try {
        // Load discharge context
        const { data: summary } = await supabase
          .from('discharge_summaries')
          .select('*, medications(*)')
          .eq('episode_id', episode.id)
          .single()

        const { data: guidance } = await supabase
          .from('hospital_approved_guidance')
          .select('category, answer')
          .eq('hospital_id', hospital.id)
          .eq('is_active', true)

        const chatResult = await answerPatientQuestion({
          question: text,
          patientName: patient.full_name,
          language: (lang as string) ?? 'en',
          summary: summary as unknown as DischargeSummary,
          medications: (summary as unknown as { medications: Medication[] })?.medications ?? [],
          approvedGuidance: (guidance ?? []).map((g) => ({
            category: g.category as string,
            answer: g.answer as Record<string, string>,
          })),
        })

        // Send AI answer to patient
        await reply({
          type: 'text',
          to: message.from,
          body: chatResult.answer,
        })

        // Escalation is derived from the classified intent (lib/ai/chat.ts):
        // never for acknowledgements/greetings, low for out-of-scope questions,
        // medium/high for reported concerns — which also colour the patient
        // (medium yellow, high red: it matched one of their warning signs).
        if (chatResult.shouldEscalate) {
          const severity = chatResult.severity ?? 'low'
          await supabase.from('alerts').insert({
            episode_id: episode.id,
            hospital_id: hospital.id,
            type: 'escalation',
            severity,
          })
          if (severity === 'high') await raiseEpisodeRisk(supabase, episode.id, 'red')
          else if (severity === 'medium') await raiseEpisodeRisk(supabase, episode.id, 'yellow')
          await supabase.from('patient_timeline_events').insert({
            episode_id: episode.id,
            hospital_id: hospital.id,
            event_type: 'escalation_created',
            payload: {
              reason: chatResult.escalationReason ?? null,
              intent: chatResult.intent,
              severity,
              wa_message_id: message.waMessageId,
            },
            risk_level: severity === 'high' ? 'red' : severity === 'medium' ? 'yellow' : null,
          })
        }

        await supabase.from('ai_interactions').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          input_type: spoken ? 'voice' : 'text',
          model: chatResult.model ?? 'none',
          input_text: text,
          output_text: chatResult.answer,
          confidence: chatResult.confidence === 'high' ? 0.9 : chatResult.confidence === 'medium' ? 0.6 : 0.3,
          escalated: chatResult.shouldEscalate,
        })

        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'ai_response',
          payload: {
            question: text,
            intent: chatResult.intent,
            escalated: chatResult.shouldEscalate,
            wa_message_id: message.waMessageId,
          },
        })
      } catch (err) {
        console.error('[AI chat] failed:', err)
        await reply(buildEscalationAcknowledgement({ to: message.from, patientName: patient.full_name, language: lang }))
        await supabase.from('alerts').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          type: 'escalation',
          severity: 'low',
        })
        await supabase.from('patient_timeline_events').insert({
          episode_id: episode.id,
          hospital_id: hospital.id,
          event_type: 'escalation_created',
          payload: { reason: 'AI assistant unavailable', intent: 'unknown', severity: 'low', wa_message_id: message.waMessageId },
        })
      }
      break
    }

    case 'unsupported_media': {
      // A picture of the wound, a photo of the prescription: nobody looks at
      // it and it must not be silently ignored — say so, in their language.
      await reply(buildCannotReadMediaReply({ to: message.from, patientName: patient.full_name, language: lang }))
      break
    }

    case 'noop':
    default:
      break
  }

  // 9. Update conversation state (the row is guaranteed to exist from step 5).
  // While a nurse is attending, keep the stored object (it carries the expiry)
  // instead of flattening it to a bare string.
  const keepAttending = nextState === 'nurse_attending' && state === 'nurse_attending'
  await supabase
    .from('whatsapp_conversations')
    .update({
      conversation_state: keepAttending ? conversation.conversation_state : nextState,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id)

  // 10. Timeline: the inbound message and what it did to the conversation.
  // On a shared number the routing reason goes in too, so the Timeline tab
  // tells the same story as the transcript.
  await supabase.from('patient_timeline_events').insert({
    episode_id: episode.id,
    hospital_id: hospital.id,
    event_type: 'whatsapp_inbound',
    payload: {
      wa_message_id: message.waMessageId,
      type: message.type,
      state_transition: { from: state, to: nextState, action: result.action },
      ...(routing ? { routing: { via: routing.via, linked_patients: routing.linkedPatients } } : {}),
      ...(message.senderName ? { sender_name: message.senderName } : {}),
    },
  })

  // 11. Mark as read
  await markAsRead(phoneNumberId, message.waMessageId)
}
