'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Upload, FileText, Loader2, CheckCircle2, AlertCircle, Sparkles, Pill, CalendarClock, ShieldAlert, X, PenLine, Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
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

const E164 = /^\+[1-9]\d{6,14}$/

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

export default function NewEpisodePage() {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('upload')
  const [manual, setManual] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [dragOver, setDragOver] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
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

  // The one field the document never has: put the cursor there.
  useEffect(() => {
    if (phase === 'confirm') phoneRef.current?.focus()
  }, [phase])

  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function readDocument(f: File) {
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      toast.error('Only PDF files are accepted')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error('File must be under 20MB')
      return
    }
    setFile(f)
    setReadError(null)
    setPhase('reading')

    try {
      const body = new FormData()
      body.append('file', f)
      const res = await fetch('/api/v1/intake/extract', { method: 'POST', body })
      const json = (await res.json()) as { data?: { extraction: ExtractionResult }; error?: string; message?: string }
      if (!res.ok || !json.data) throw new Error(json.error ?? 'Could not read the document')
      setExtraction(json.data.extraction)
      setForm(formFromExtraction(json.data.extraction))
      setPhase('confirm')
    } catch (err) {
      setReadError(err instanceof Error ? err.message : 'Could not read the document')
      setPhase('upload') // `file` is kept so the nurse can retry without re-selecting it
    }
  }

  function startOver() {
    setFile(null)
    setExtraction(null)
    setForm(EMPTY_FORM)
    setReadError(null)
    setManual(false)
    setPhase('upload')
  }

  function validate(): string | null {
    if (form.full_name.trim().length < 2) return 'Full name is required'
    if (!form.mrn.trim()) return 'MRN is required'
    if (!/^\+[1-9]\d{6,14}$/.test(form.phone_e164.trim())) return 'WhatsApp number must be in international format, e.g. +971501234567'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.discharge_date)) return 'Discharge date is required'
    return null
  }

  async function submit() {
    const problem = validate()
    if (problem) {
      toast.error(problem)
      return
    }
    setSaving(true)
    try {
      if (manual || !file || !extraction) {
        await createWithoutDocument()
        return
      }
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
      const json = (await res.json()) as { data?: { episode_id: string; patient_existed?: boolean }; error?: string; message?: string }

      if (res.status === 409 && json.data?.episode_id) {
        const id = json.data.episode_id
        toast.error('This patient already has an open episode', {
          action: { label: 'Open it', onClick: () => router.push(`/episodes/${id}`) },
          duration: 10000,
        })
        return
      }
      if (!res.ok || !json.data) throw new Error(json.message ? `${json.error}: ${json.message}` : (json.error ?? 'Could not create the episode'))

      toast.success(json.data.patient_existed ? 'Returning patient — new episode created. Review the summary.' : 'Patient created. Review the summary before it goes out.')
      router.push(`/episodes/${json.data.episode_id}/review`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSaving(false)
    }
  }

  // Fallback for paper-only discharges: register the patient, open the episode,
  // and let the nurse attach a document later from the episode page.
  async function createWithoutDocument() {
    const patientRes = await fetch('/api/v1/patients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: form.full_name.trim(),
        mrn: form.mrn.trim(),
        phone_e164: form.phone_e164.trim(),
        preferred_language: form.preferred_language,
        date_of_birth: form.date_of_birth || null,
      }),
    })
    const patientData = (await patientRes.json()) as { data?: { id: string }; error?: string }
    let patientId = patientData.data?.id
    if (patientRes.status === 409) {
      const lookup = await fetch(`/api/v1/patients?search=${encodeURIComponent(form.mrn.trim())}&limit=5`)
      const lookupData = (await lookup.json()) as { data?: Array<{ id: string; mrn: string }> }
      patientId = lookupData.data?.find((p) => p.mrn === form.mrn.trim())?.id
      if (!patientId) throw new Error('A patient with this MRN exists but is assigned to someone else. Ask a coordinator to open the episode.')
      toast.info('Patient already registered — creating a new episode for them.')
    } else if (!patientRes.ok || !patientId) {
      throw new Error(patientData.error ?? 'Failed to create patient')
    }
    const episodeRes = await fetch('/api/v1/episodes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patient_id: patientId, discharge_date: form.discharge_date }),
    })
    const episodeData = (await episodeRes.json()) as { data?: { id: string }; error?: string }
    if (!episodeRes.ok || !episodeData.data) throw new Error(episodeData.error ?? 'Failed to create episode')
    toast.success('Episode created — attach the discharge document when you have it.')
    router.push(`/episodes/${episodeData.data.id}`)
  }

  const found = (value: string) => value.trim().length > 0

  return (
    <div className="max-w-3xl space-y-5">
      <Link href="/patients" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> All patients
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New patient</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload the discharge summary. The details are read from it — you only add the WhatsApp number and check the rest.
        </p>
      </div>

      {/* Step 1 — document */}
      {phase !== 'confirm' && !manual && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-brand" aria-hidden="true" /> Discharge document
            </CardTitle>
            <CardDescription>PDF only, up to 20MB. Scanned images can’t be read yet.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              role="button"
              tabIndex={phase === 'reading' ? -1 : 0}
              aria-label="Upload discharge PDF"
              aria-busy={phase === 'reading'}
              className={cn(
                'rounded-lg border-2 border-dashed p-10 text-center transition-colors duration-200 outline-none',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                dragOver ? 'border-brand bg-brand-tint' : 'border-border hover:border-brand/50 hover:bg-muted/40',
                phase === 'reading' ? 'pointer-events-none' : 'cursor-pointer',
              )}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void readDocument(f) }}
            >
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void readDocument(f); e.target.value = '' }}
              />
              {phase === 'reading' ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="h-9 w-9 animate-spin text-brand" aria-hidden="true" />
                  <p className="font-medium">Reading {file?.name}</p>
                  <p className="text-sm text-muted-foreground">Extracting patient details, medicines and warning signs — usually 10–30 seconds.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
                  <p className="font-medium">Drop the discharge PDF here</p>
                  <p className="text-sm text-muted-foreground">or click to browse</p>
                </div>
              )}
            </div>

            {readError && (
              <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                <div className="flex-1">
                  <p className="font-medium text-danger">Couldn’t read that document</p>
                  <p className="mt-0.5 text-danger/90">{readError}</p>
                  {file && (
                    <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => readDocument(file)}>
                      Try again with {file.name}
                    </Button>
                  )}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              No document to hand?{' '}
              <button type="button" className="font-medium text-brand underline-offset-2 hover:underline" onClick={() => { setManual(true); setForm(EMPTY_FORM); setPhase('confirm') }}>
                Enter the details manually
              </button>
            </p>
          </CardContent>
        </Card>
      )}

      {/* Step 2 — confirm */}
      {phase === 'confirm' && (
        <form
          className="space-y-5"
          onSubmit={(e) => { e.preventDefault(); void submit() }}
        >
          {extraction && !manual && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              <span className="font-medium text-success">Read {file?.name}</span>
              <span className="text-muted-foreground">— check the details below, then review the summary.</span>
              <button type="button" onClick={startOver} className="ml-auto inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-background hover:text-foreground">
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Use a different file
              </button>
            </div>
          )}
          {manual && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
              <PenLine className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span>Entering details manually — you can attach the discharge document from the episode page afterwards.</span>
              <button type="button" onClick={startOver} className="ml-auto text-xs font-medium text-brand hover:underline">Upload a document instead</button>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Patient</CardTitle>
              <CardDescription>
                {manual ? 'Enter the patient’s details.' : 'Read from the document. Fields marked “not found” need your input.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name" required found={!manual && found(form.full_name)} className="sm:col-span-2">
                <Input id="full_name" value={form.full_name} onChange={(e) => set('full_name')(e.target.value)} placeholder="Ahmed Al Mansoori" autoComplete="off" className="h-11" required />
              </Field>
              <Field label="MRN" required found={!manual && found(form.mrn)}>
                <Input id="mrn" value={form.mrn} onChange={(e) => set('mrn')(e.target.value)} placeholder="DGH-2024-001" autoComplete="off" className="h-11 font-mono" required />
              </Field>
              <Field label="Date of birth" found={!manual && found(form.date_of_birth)}>
                <Input id="date_of_birth" type="date" value={form.date_of_birth} onChange={(e) => set('date_of_birth')(e.target.value)} className="h-11" />
              </Field>
              <Field label="Gender" found={!manual && found(form.gender)}>
                <Select value={form.gender || 'unspecified'} onValueChange={(v) => set('gender')(v === 'unspecified' ? '' : (v as 'male' | 'female'))}>
                  <SelectTrigger id="gender" className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unspecified">Not specified</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Nationality" found={!manual && found(form.nationality)}>
                <Input id="nationality" value={form.nationality} onChange={(e) => set('nationality')(e.target.value)} className="h-11" />
              </Field>

              <div className="sm:col-span-2"><Separator /></div>

              <Field label="WhatsApp number" required hint="Not in the document — type it in international format." className="sm:col-span-1">
                <Input
                  ref={phoneRef}
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  value={form.phone_e164}
                  onChange={(e) => set('phone_e164')(e.target.value.replace(/[\s()-]/g, ''))}
                  placeholder="+971501234567"
                  autoComplete="tel"
                  className="h-11"
                  required
                />
                {numberInUse.length > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-warning" role="status">
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Also used by{' '}
                      {numberInUse.map((p, i) => (
                        <span key={p.episode_id}>
                          {i > 0 && (i === numberInUse.length - 1 ? ' and ' : ', ')}
                          <Link href={`/episodes/${p.episode_id}`} className="font-medium underline underline-offset-2">{p.full_name}</Link>
                        </span>
                      ))}
                      {' '}(open episode). Fine for a shared family phone — the assistant asks who a message is about when it cannot tell. Check the digits if that is not expected.
                    </span>
                  </p>
                )}
              </Field>
              <Field label="Preferred language" hint="The summary and every check-in go out in this language.">
                <Select value={form.preferred_language} onValueChange={(v) => set('preferred_language')(v as LanguageCode)}>
                  <SelectTrigger id="language" className="h-11 w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SUPPORTED_LANGUAGES) as [LanguageCode, string][]).map(([code, name]) => (
                      <SelectItem key={code} value={code}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Admission</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Discharge date" required found={!manual && found(extraction?.encounter?.discharge_date ?? '')}>
                <Input id="discharge_date" type="date" value={form.discharge_date} onChange={(e) => set('discharge_date')(e.target.value)} className="h-11" required />
              </Field>
              <Field label="Admission date" found={!manual && found(form.admission_date)}>
                <Input id="admission_date" type="date" value={form.admission_date} onChange={(e) => set('admission_date')(e.target.value)} className="h-11" />
              </Field>
              <Field label="Diagnosis" found={!manual && found(form.diagnosis)} className="sm:col-span-2">
                <Input id="diagnosis" value={form.diagnosis} onChange={(e) => set('diagnosis')(e.target.value)} className="h-11" />
              </Field>
              <Field label="Ward / department" found={!manual && found(form.ward)}>
                <Input id="ward" value={form.ward} onChange={(e) => set('ward')(e.target.value)} className="h-11" />
              </Field>
              <Field label="Attending physician" found={!manual && found(form.attending_physician)}>
                <Input id="physician" value={form.attending_physician} onChange={(e) => set('attending_physician')(e.target.value)} className="h-11" />
              </Field>
            </CardContent>
          </Card>

          {extraction && !manual && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand" aria-hidden="true" /> What was found
                </CardTitle>
                <CardDescription>You’ll be able to edit all of this on the review screen before anything is sent.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FoundGroup icon={Pill} label={`${extraction.medications.length} medication${extraction.medications.length === 1 ? '' : 's'}`} items={extraction.medications.map((m) => `${m.name}${m.dosage ? ` · ${m.dosage}` : ''}`)} />
                <FoundGroup icon={CalendarClock} label={`${extraction.follow_up_requirements.length} follow-up${extraction.follow_up_requirements.length === 1 ? '' : 's'}`} items={extraction.follow_up_requirements.map((f) => `${f.specialty}${f.deadline ? ` · by ${f.deadline}` : ''}`)} />
                <FoundGroup icon={ShieldAlert} label={`${extraction.emergency_symptoms.length} warning sign${extraction.emergency_symptoms.length === 1 ? '' : 's'}`} items={extraction.emergency_symptoms} />
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Next: review the summary and approve it. Nothing is sent to the patient until you approve.
            </p>
            <Button type="submit" disabled={saving} aria-busy={saving} className="h-11 sm:min-w-56">
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {saving ? 'Creating…' : manual ? 'Create patient & episode' : 'Create patient & review summary'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function Field({
  label, required, found, hint, className, children,
}: {
  label: string
  required?: boolean
  /** undefined = no auto-fill indicator; true = read from the document; false = not found */
  found?: boolean
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm">
          {label}{required && <span className="text-danger" aria-hidden="true"> *</span>}
        </Label>
        {found === true && <Badge variant="outline" className="h-5 border-success/30 bg-success-soft text-[10px] font-medium text-success">From document</Badge>}
        {found === false && <Badge variant="outline" className="h-5 border-warning/30 bg-warning-soft text-[10px] font-medium text-warning">Not found</Badge>}
      </div>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function FoundGroup({ icon: Icon, label, items }: { icon: React.ElementType; label: string; items: string[] }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {label}
      </p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {items.slice(0, 5).map((item, i) => <li key={i} className="truncate" title={item}>{item}</li>)}
          {items.length > 5 && <li>+{items.length - 5} more</li>}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">None in the document</p>
      )}
    </div>
  )
}
