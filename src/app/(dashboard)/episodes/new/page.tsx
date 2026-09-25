'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Upload, Loader2, CheckCircle2, AlertCircle, X, Users, Check, ChevronRight, ChevronDown, Smartphone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { siteConfig } from '@/config/site'
import { SampleLetterPanel, SAMPLE_LETTER_DRAG_TYPE, fetchSampleLetter } from '@/components/intake/sample-letter-panel'
import { signalTour } from '@/lib/tour/signals'
import { E164, phoneLine, tidyPhone } from '@/lib/intake/phone'
import { formatPhone } from '@/lib/format'
import { SandboxJoinPanel } from '@/components/whatsapp/sandbox-join'
import { SUPPORTED_LANGUAGES } from '@/types/enums'
import type { LanguageCode } from '@/types/enums'
import type { ExtractionResult } from '@/lib/ai/extraction'

type Phase = 'upload' | 'reading' | 'confirm'

/** Another patient with an open episode on the WhatsApp number being typed (GET /api/v1/intake/number-in-use). */
interface NumberInUse {
  patient_id: string
  full_name: string
  episode_id: string
  episode_status: string
}

/** Demo:the team's test phone, one click away for anyone who doesn't want to use their own. */
const DEMO_PHONE = siteConfig.demoWhatsAppNumber

interface FormState {
  full_name: string
  mrn: string
  date_of_birth: string
  gender: '' | 'male' | 'female'
  nationality: string
  phone_e164: string
  preferred_language: LanguageCode
  discharge_date: string
  diagnosis: string
  admission_date: string
  ward: string
  attending_physician: string
}

/** The fields a patient cannot be added without, in the order they appear. */
const REQUIRED = ['full_name', 'mrn', 'discharge_date', 'phone_e164'] as const
type RequiredField = (typeof REQUIRED)[number]

const GENDERS = { unspecified: 'Not specified', female: 'Female', male: 'Male' }
const STEPS = ['Discharge letter', 'Patient details', 'Care plan']

const LANGS = new Set<string>(Object.keys(SUPPORTED_LANGUAGES))
const today = () => new Date().toISOString().slice(0, 10)

const EMPTY_FORM: FormState = {
  full_name: '', mrn: '', date_of_birth: '', gender: '', nationality: '', phone_e164: '',
  preferred_language: 'en', discharge_date: today(), diagnosis: '', admission_date: '', ward: '', attending_physician: '',
}

function formFromExtraction(x: ExtractionResult): FormState {
  const p = x.patient
  const e = x.encounter
  return {
    full_name: p?.full_name ?? '',
    mrn: p?.mrn ?? '',
    date_of_birth: p?.date_of_birth ?? '',
    gender: p?.gender ?? '',
    nationality: p?.nationality ?? '',
    phone_e164: p?.phone ?? '',
    preferred_language: (LANGS.has(x.source_language) ? x.source_language : 'en') as LanguageCode,
    discharge_date: e?.discharge_date ?? today(),
    diagnosis: e?.diagnosis ?? '',
    admission_date: e?.admission_date ?? '',
    ward: e?.ward ?? '',
    attending_physician: e?.attending_physician ?? '',
  }
}

function problemWith(field: RequiredField, form: FormState): string | null {
  switch (field) {
    case 'full_name': return form.full_name.trim().length < 2 ? 'Enter the patient’s full name.' : null
    case 'mrn': return form.mrn.trim() ? null : 'Enter the MRN.'
    case 'discharge_date': return /^\d{4}-\d{2}-\d{2}$/.test(form.discharge_date) ? null : 'Enter the discharge date.'
    case 'phone_e164': return E164.test(form.phone_e164.trim()) ? null : 'Type the WhatsApp number with its country code, e.g. +971 50 123 4567.'
  }
}

export default function NewEpisodePage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Partial<Record<RequiredField, string>>>({})
  const [dragOver, setDragOver] = useState(false)
  /** A demo letter is being dragged: the box says where to drop it. */
  const [sampleDragging, setSampleDragging] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  /** "sample" when the AI reader was unavailable and a sample letter's built-in reading filled the form. */
  const [readBy, setReadBy] = useState<'ai' | 'sample' | null>(null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  // A WhatsApp number is not unique (a family phone, a relative writing for
  // two patients). Once the number is complete, show who else is on it so
  // the nurse knows messages will be routed — or catches a typo. The answer
  // is kept with the number it was fetched for, so editing the number
  // clears the hint without an extra render.
  const [inUse, setInUse] = useState<{ phone: string; patients: NumberInUse[] } | null>(null)
  const phone = form.phone_e164.trim()
  useEffect(() => {
    if (!E164.test(phone)) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/intake/number-in-use?phone=${encodeURIComponent(phone)}`, { signal: controller.signal })
        const json = (await res.json()) as { data?: { patients: NumberInUse[] } }
        if (res.ok && json.data) setInUse({ phone, patients: json.data.patients })
      } catch {
        // Aborted or offline: the hint is a courtesy, never a blocker.
      }
    }, 400)
    return () => { clearTimeout(timer); controller.abort() }
  }, [phone])
  const numberInUse = inUse?.phone === phone
    ? inUse.patients.filter((p) => p.full_name.trim().toLowerCase() !== form.full_name.trim().toLowerCase())
    : []

  const fromLetter = Boolean(extraction)

  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    if (key in errors) setErrors((e) => { const rest = { ...e }; delete rest[key as RequiredField]; return rest })
  }

  /** Props that tie a required input to the message under it. */
  const describe = (field: RequiredField, hasHint = false) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] || hasHint || (fromLetter && !form[field].trim()) ? `${field}-note` : undefined,
  })

  /** Under a required field: the error after a failed save, else a nudge when the letter did not have it. */
  const noteFor = (field: RequiredField, hint?: string): { text: string; tone: 'error' | 'warning' | 'hint' } | null => {
    if (errors[field]) return { text: errors[field], tone: 'error' }
    if (fromLetter && !form[field].trim()) return { text: hint ?? 'Not in the letter. Please fill it in.', tone: 'warning' }
    return hint ? { text: hint, tone: 'hint' } : null
  }

  async function readDocument(f: File) {
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF files can be read')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error('The file must be under 20 MB')
      return
    }
    setFile(f)
    setReadError(null)
    setPhase('reading')
    signalTour('intake:reading')

    try {
      const body = new FormData()
      body.append('file', f)
      const res = await fetch('/api/v1/intake/extract', { method: 'POST', body })
      const json = (await res.json()) as { data?: { extraction: ExtractionResult; read_by?: 'ai' | 'sample' }; error?: string; message?: string }
      if (!res.ok || !json.data) throw new Error(json.error ?? 'Could not read the letter')
      setExtraction(json.data.extraction)
      setReadBy(json.data.read_by ?? 'ai')
      setForm(formFromExtraction(json.data.extraction))
      setErrors({})
      setPhase('confirm')
      signalTour('intake:read')
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Could not read the letter')
      setPhase('upload') // `file` is kept so the nurse can retry without re-selecting it
      signalTour('intake:failed')
    }
  }

  /** A demo letter (dragged in, or clicked): fetched as a PDF with today's dates, then read like an upload. */
  async function readSampleLetter(id: string) {
    setSampleDragging(false)
    setReadError(null)
    // The box says it is reading from the moment the letter lands, not once the PDF has downloaded.
    setFile(null)
    setPhase('reading')
    signalTour('intake:reading')
    try {
      await readDocument(await fetchSampleLetter(id))
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Could not load the demo letter')
      setPhase('upload')
      signalTour('intake:failed')
    }
  }

  function startOver() {
    setFile(null)
    setExtraction(null)
    setReadBy(null)
    setForm(EMPTY_FORM)
    setErrors({})
    setReadError(null)
    setPhase('upload')
  }

  async function submit() {
    const found: Partial<Record<RequiredField, string>> = {}
    for (const field of REQUIRED) {
      const problem = problemWith(field, form)
      if (problem) found[field] = problem
    }
    setErrors(found)
    const first = REQUIRED.find((field) => found[field])
    if (first) {
      document.getElementById(first)?.focus()
      return
    }
    setSaving(true)
    try {
      if (!file || !extraction) return // the details step is only reached from a letter
      const payload = {
        patient: {
          full_name: form.full_name.trim(),
          mrn: form.mrn.trim(),
          phone_e164: form.phone_e164.trim(),
          preferred_language: form.preferred_language,
          date_of_birth: form.date_of_birth || null,
          gender: form.gender || null,
          nationality: form.nationality.trim() || null,
        },
        episode: {
          discharge_date: form.discharge_date,
          diagnosis: form.diagnosis.trim() || null,
          admission_date: form.admission_date || null,
          ward: form.ward.trim() || null,
          attending_physician: form.attending_physician.trim() || null,
        },
        extraction: {
          medications: extraction.medications,
          follow_up_requirements: extraction.follow_up_requirements,
          emergency_symptoms: extraction.emergency_symptoms,
          lifestyle_instructions: extraction.lifestyle_instructions,
          restrictions: extraction.restrictions,
          activities: extraction.activities,
          source_language: extraction.source_language,
        },
      }
      const body = new FormData()
      body.append('file', file)
      body.append('payload', JSON.stringify(payload))
      const res = await fetch('/api/v1/intake/commit', { method: 'POST', body })
      const json = (await res.json()) as { data?: { episode_id: string; patient_existed?: boolean; restarted_sample?: boolean }; error?: string; message?: string }

      if (res.status === 409 && json.data?.episode_id) {
        const id = json.data.episode_id
        toast.error('This patient already has an open care plan', {
          action: { label: 'Open it', onClick: () => router.push(`/episodes/${id}`) },
          duration: 10000,
        })
        return
      }
      if (!res.ok || !json.data) throw new Error(json.message ? `${json.error}: ${json.message}` : (json.error ?? 'Could not add the patient'))

      toast.success(
        json.data.restarted_sample
          ? `Fresh start for ${form.full_name.trim()}: the sample patient’s previous care plan was closed. Check the new one before it is sent.`
          : json.data.patient_existed ? 'Returning patient: a new care plan is started. Check it before it is sent.' : 'Patient added. Check the care plan before it is sent.',
      )
      // The tour tells a visitor who used their own phone to go and look at it.
      signalTour('intake:saved', form.phone_e164.trim() === DEMO_PHONE ? 'demo' : 'own')
      router.push(`/episodes/${json.data.episode_id}/review`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  const nameNote = noteFor('full_name')
  const mrnNote = noteFor('mrn')
  const dischargeNote = noteFor('discharge_date')
  // The number is checked as it is typed; after a failed save, an empty one says what to do.
  const phoneCheck = phoneLine(form.phone_e164)
  const usingDemoPhone = Boolean(DEMO_PHONE) && form.phone_e164.trim() === DEMO_PHONE
  const phoneNote: { text: string; tone: 'error' | 'warning' | 'hint' | 'ok' } =
    errors.phone_e164 && !form.phone_e164.trim()
      ? { tone: 'error', text: DEMO_PHONE ? 'Type a WhatsApp number, or click Use demo number.' : errors.phone_e164 }
      : errors.phone_e164 && phoneCheck.tone !== 'ok'
        ? { tone: 'error', text: phoneCheck.text }
        : usingDemoPhone
          ? { tone: 'ok', text: 'Demo number: the messages go to our test phone.' }
          : phoneCheck.tone === 'ok'
            ? { tone: 'ok', text: `${phoneCheck.text}: the messages go to this WhatsApp.` }
            : phoneCheck
  const phoneReady = phoneCheck.tone === 'ok'

  return (
    <div className="max-w-5xl space-y-5">
      <Link href="/patients" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Patients
      </Link>

      <div className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Add patient</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drop the discharge letter in the box, or drag in one of the demo letters. The details are read from it:
            you check them, add the WhatsApp number, then approve the care plan.
          </p>
        </div>
        <Steps current={phase === 'confirm' ? 2 : 1} />
      </div>

      {/* Step 1: the letter, with the demo letters beside the box to drag in */}
      {phase !== 'confirm' && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]" data-tour="intake-letters">
          <Card>
            <CardContent className="space-y-4">
              <div
                role="button"
                data-tour="intake-dropzone"
                tabIndex={phase === 'reading' ? -1 : 0}
                aria-label="Choose the discharge letter (PDF)"
                aria-busy={phase === 'reading'}
                className={cn(
                  'flex min-h-56 flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center outline-none transition-colors duration-200 sm:p-10 lg:min-h-[19rem]',
                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  dragOver
                    ? 'border-brand bg-brand-tint'
                    : sampleDragging
                      ? 'border-brand/60 bg-brand-tint/60'
                      : 'border-border hover:border-brand/50 hover:bg-muted/40',
                  phase === 'reading' ? 'pointer-events-none' : 'cursor-pointer',
                )}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const sample = e.dataTransfer.getData(SAMPLE_LETTER_DRAG_TYPE)
                  if (sample) { void readSampleLetter(sample); return }
                  const f = e.dataTransfer.files[0]
                  if (f) void readDocument(f)
                }}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void readDocument(f); e.target.value = '' }}
                />
                {phase === 'reading' ? (
                  <div className="flex flex-col items-center gap-2" role="status">
                    <Loader2 className="h-9 w-9 animate-spin text-brand" aria-hidden="true" />
                    <p className="max-w-full truncate font-medium">Reading {file?.name ?? 'the letter'}</p>
                    <p className="text-sm text-muted-foreground">Finding the patient’s details, medicines and warning signs. This usually takes 10 to 30 seconds.</p>
                  </div>
                ) : sampleDragging || dragOver ? (
                  <div className="pointer-events-none flex flex-col items-center gap-2">
                    <Upload className="h-9 w-9 text-brand motion-safe:animate-bounce" aria-hidden="true" />
                    <p className="font-medium text-brand">Drop the letter here</p>
                    <p className="text-sm text-muted-foreground">It is read straight away.</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
                    <p className="font-medium">Drop the discharge letter here</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="hidden lg:inline">Drag in a demo letter from the right, or </span>
                      <span className="lg:hidden">Drag in a demo letter, or </span>
                      click to choose a PDF (up to 20 MB)
                    </p>
                  </div>
                )}
              </div>

              {readError && (
                <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-danger">Couldn’t read that letter</p>
                    <p className="mt-0.5 text-danger/90">{readError}</p>
                    {file && (
                      <Button type="button" variant="outline" size="sm" className="mt-2 h-8 max-w-full" onClick={() => readDocument(file)}>
                        <span className="truncate">Try again with {file.name}</span>
                      </Button>
                    )}
                  </div>
                </div>
              )}

            </CardContent>
          </Card>

          <SampleLetterPanel
            onUse={(id) => void readSampleLetter(id)}
            onDragChange={setSampleDragging}
            disabled={phase === 'reading'}
          />
        </div>
      )}

      {/* Step 2: the details */}
      {phase === 'confirm' && (
        <form className="max-w-3xl space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit() }}>
          {fromLetter && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <span className="min-w-0 truncate font-medium text-success">Read {file?.name}</span>
              {readBy === 'sample' && (
                <span className="basis-full text-xs text-muted-foreground sm:order-last">
                  The AI reader isn’t available right now, so this sample letter was filled in from its built-in copy.
                </span>
              )}
              <button type="button" onClick={startOver} className="ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground">
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Use a different file
              </button>
            </div>
          )}

          <Card data-tour="intake-patient">
            <CardHeader>
              <CardTitle className="text-base">Patient</CardTitle>
              {fromLetter && <CardDescription>Read from the letter. Check it matches the patient.</CardDescription>}
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="full_name" label="Full name" required note={nameNote} className="sm:col-span-2">
                <Input id="full_name" value={form.full_name} onChange={(e) => set('full_name')(e.target.value)} placeholder="e.g. Ahmed Al Mansoori" autoComplete="off" className="h-11" {...describe('full_name')} />
              </Field>
              <Field id="mrn" label="MRN" required note={mrnNote}>
                <Input id="mrn" value={form.mrn} onChange={(e) => set('mrn')(e.target.value)} placeholder="e.g. DGH-2024-001" autoComplete="off" className="h-11 font-mono" {...describe('mrn')} />
              </Field>
              <Field id="date_of_birth" label="Date of birth">
                <Input id="date_of_birth" type="date" value={form.date_of_birth} onChange={(e) => set('date_of_birth')(e.target.value)} className="h-11" />
              </Field>
              <Field id="discharge_date" label="Discharge date" required note={dischargeNote}>
                <Input id="discharge_date" type="date" value={form.discharge_date} onChange={(e) => set('discharge_date')(e.target.value)} className="h-11" {...describe('discharge_date')} />
              </Field>
            </CardContent>
          </Card>

          {/* Until a good number is in, the card stands out: it's the one thing a letter never has. */}
          <Card data-tour="intake-whatsapp" className={cn(!phoneReady && 'ring-2 ring-brand/45')}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Smartphone className="h-4 w-4 text-brand" aria-hidden="true" /> WhatsApp
              </CardTitle>
              <CardDescription>The care plan, the nightly check-ins and the assistant’s answers all go to this number.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field id="phone_e164" label="WhatsApp number" required note={phoneCheck.fix ? null : phoneNote} className="sm:col-span-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative sm:max-w-xs sm:flex-1">
                    <Input
                      ref={phoneRef}
                      id="phone_e164"
                      type="tel"
                      inputMode="tel"
                      value={form.phone_e164}
                      onChange={(e) => set('phone_e164')(tidyPhone(e.target.value))}
                      placeholder="+971 50 123 4567"
                      autoComplete="tel"
                      className={cn('h-11 pr-9 tnum', phoneCheck.tone === 'error' && 'border-danger focus-visible:ring-danger/40')}
                      {...describe('phone_e164', true)}
                    />
                    {phoneReady && <CheckCircle2 className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-success" aria-hidden="true" />}
                  </div>
                  {DEMO_PHONE && (
                    <Button
                      type="button"
                      variant={usingDemoPhone ? 'secondary' : 'outline'}
                      className="h-11 shrink-0"
                      data-tour="use-demo-number"
                      onClick={() => set('phone_e164')(DEMO_PHONE)}
                      title={`Our test phone, ${formatPhone(DEMO_PHONE)}`}
                    >
                      {usingDemoPhone ? <Check className="h-4 w-4" aria-hidden="true" /> : <Smartphone className="h-4 w-4" aria-hidden="true" />}
                      {usingDemoPhone ? 'Demo number in' : 'Use demo number'}
                    </Button>
                  )}
                </div>
                {/* What's wrong, then the number it was probably meant to be, one click away */}
                {phoneCheck.fix && (
                  <p id="phone_e164-note" className="text-xs text-danger">
                    {phoneNote.text}{' '}
                    <button
                      type="button"
                      onClick={() => set('phone_e164')(phoneCheck.fix as string)}
                      className="rounded-sm font-medium text-brand underline underline-offset-2 hover:text-brand/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Use {formatPhone(phoneCheck.fix)}
                    </button>
                  </p>
                )}
                {numberInUse.length > 0 && usingDemoPhone && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground" role="status">
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Also on this number: {numberInUse.slice(0, 3).map((p) => p.full_name).join(', ')}
                      {numberInUse.length > 3 && ` and ${numberInUse.length - 3} more`}. Replies are matched to the right patient.
                    </span>
                  </p>
                )}
                {numberInUse.length > 0 && !usingDemoPhone && (
                  <p className="flex items-start gap-1.5 text-xs text-warning" role="status">
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Also the number of{' '}
                      {numberInUse.map((p, i) => (
                        <span key={p.episode_id}>
                          {i > 0 && (i === numberInUse.length - 1 ? ' and ' : ', ')}
                          <Link href={`/episodes/${p.episode_id}`} className="font-medium underline underline-offset-2">{p.full_name}</Link>
                        </span>
                      ))}
                      . That’s fine for a family phone. If not, check the digits.
                    </span>
                  </p>
                )}
              </Field>
              <Field
                id="language"
                label="Language for messages"
                note={{ text: 'Set to the letter’s language. Change it if the patient reads another.', tone: 'hint' }}
              >
                <Select items={SUPPORTED_LANGUAGES} value={form.preferred_language} onValueChange={(v) => set('preferred_language')(v as LanguageCode)}>
                  <SelectTrigger id="language" className="h-11 w-full" aria-describedby="language-note"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SUPPORTED_LANGUAGES) as [LanguageCode, string][]).map(([code, name]) => (
                      <SelectItem key={code} value={code}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {/* Demo: anyone can get the messages on their own phone once it has joined the WhatsApp sandbox */}
              {DEMO_PHONE && <SandboxJoinPanel className="sm:col-span-2" />}
            </CardContent>
          </Card>

          {fromLetter && extraction && (
            <>
              <details className="group rounded-lg bg-card ring-1 ring-border">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  <span>
                    More from the letter
                    <span className="ml-1.5 font-normal text-muted-foreground">diagnosis, ward, doctor (optional)</span>
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="grid grid-cols-1 gap-4 border-t px-4 py-4 sm:grid-cols-2">
                  <Field id="diagnosis" label="Diagnosis" className="sm:col-span-2">
                    <Input id="diagnosis" value={form.diagnosis} onChange={(e) => set('diagnosis')(e.target.value)} className="h-11" />
                  </Field>
                  <Field id="admission_date" label="Admission date">
                    <Input id="admission_date" type="date" value={form.admission_date} onChange={(e) => set('admission_date')(e.target.value)} className="h-11" />
                  </Field>
                  <Field id="ward" label="Ward or department">
                    <Input id="ward" value={form.ward} onChange={(e) => set('ward')(e.target.value)} className="h-11" />
                  </Field>
                  <Field id="physician" label="Doctor">
                    <Input id="physician" value={form.attending_physician} onChange={(e) => set('attending_physician')(e.target.value)} className="h-11" />
                  </Field>
                  <Field id="gender" label="Gender">
                    <Select items={GENDERS} value={form.gender || 'unspecified'} onValueChange={(v) => set('gender')(v === 'unspecified' ? '' : (v as 'male' | 'female'))}>
                      <SelectTrigger id="gender" className="h-11 w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(GENDERS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field id="nationality" label="Nationality">
                    <Input id="nationality" value={form.nationality} onChange={(e) => set('nationality')(e.target.value)} className="h-11" />
                  </Field>
                </div>
              </details>

              <p className="text-sm text-muted-foreground">
                Also read from the letter: {plural(extraction.medications.length, 'medicine')}, {plural(extraction.emergency_symptoms.length, 'warning sign')} and {plural(extraction.follow_up_requirements.length, 'follow-up')}.
                You check them in the next step.
              </p>
            </>
          )}

          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Nothing is sent to the patient until you approve the care plan.
            </p>
            <Button type="submit" disabled={saving} aria-busy={saving} className="h-11 sm:min-w-56" data-tour="intake-save">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {saving ? 'Saving…' : 'Save and check the care plan'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Where the nurse is in adding a patient: letter, details, then the care plan on the next page. */
function Steps({ current }: { current: 1 | 2 }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {STEPS.map((label, i) => {
        const n = i + 1
        const done = n < current
        const now = n === current
        return (
          <li key={label} className="flex items-center gap-2" aria-current={now ? 'step' : undefined}>
            <span
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold tnum',
                done && 'bg-success text-success-foreground',
                now && 'bg-primary text-primary-foreground',
                !done && !now && 'bg-muted text-muted-foreground',
              )}
            >
              {done ? <Check className="h-3 w-3" aria-hidden="true" /> : n}
            </span>
            <span className={now ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              {label}{done && <span className="sr-only"> (done)</span>}
            </span>
            {n < STEPS.length && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}

function Field({
  id, label, required, note, className, children,
}: {
  id: string
  label: string
  required?: boolean
  /** The line under the field: an error after a failed save, a nudge, a hint, or that it's right. */
  note?: { text: string; tone: 'error' | 'warning' | 'hint' | 'ok' } | null
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className="text-sm">
        {label}
        {required && <span className="text-danger" aria-hidden="true">*</span>}
        {required && <span className="sr-only">(required)</span>}
      </Label>
      {children}
      {note && (
        <p
          id={`${id}-note`}
          className={cn('text-xs', note.tone === 'error' ? 'text-danger' : note.tone === 'warning' ? 'text-warning' : note.tone === 'ok' ? 'text-success' : 'text-muted-foreground')}
        >
          {note.text}
        </p>
      )}
    </div>
  )
}
