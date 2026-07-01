'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, UserPlus, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { DischargeUpload } from '@/components/episodes/discharge-upload'
import { toast } from 'sonner'
import { SUPPORTED_LANGUAGES } from '@/types/enums'
import type { LanguageCode } from '@/types/enums'

type Step = 'patient' | 'episode' | 'upload'

export default function NewEpisodePage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('patient')

  // Patient form
  const [fullName, setFullName] = useState('')
  const [mrn, setMrn] = useState('')
  const [phone, setPhone] = useState('')
  const [language, setLanguage] = useState<LanguageCode>('en')
  const [dob, setDob] = useState('')

  // Episode form
  const [dischargeDate, setDischargeDate] = useState(new Date().toISOString().split('T')[0])

  // IDs
  const [patientId, setPatientId] = useState<string | null>(null)
  const [episodeId, setEpisodeId] = useState<string | null>(null)

  const [loading, setLoading] = useState(false)

  async function handleCreatePatientAndEpisode() {
    if (!fullName || !mrn || !phone) {
      toast.error('Full name, MRN, and phone number are required')
      return
    }
    if (!phone.match(/^\+[1-9]\d{6,14}$/)) {
      toast.error('Phone must be in E.164 format e.g. +971501234567')
      return
    }

    setLoading(true)

    try {
      // 1. Create or find patient
      const patientRes = await fetch('/api/v1/patients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName,
          mrn,
          phone_e164: phone,
          preferred_language: language,
          date_of_birth: dob || null,
        }),
      })

      const patientData = await patientRes.json() as { data?: { id: string }; error?: string }

      let pId: string | undefined = patientData.data?.id

      if (patientRes.status === 409) {
        // MRN already exists — look up the existing patient to get their ID
        const lookupRes = await fetch(`/api/v1/patients?search=${encodeURIComponent(mrn)}&limit=1`)
        const lookupData = await lookupRes.json() as { data?: Array<{ id: string; mrn: string }> }
        const existing = lookupData.data?.find((p) => p.mrn === mrn)
        if (!existing) {
          throw new Error('A patient with this MRN already exists but could not be found. Please check the MRN.')
        }
        pId = existing.id
        toast.info('Patient already registered — creating a new episode for them.')
      } else if (!patientRes.ok) {
        throw new Error(patientData.error ?? 'Failed to create patient')
      }

      if (!pId) throw new Error('Could not determine patient ID. Please try again.')
      setPatientId(pId)

      // 2. Create care episode
      const episodeRes = await fetch('/api/v1/episodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patient_id: pId,
          discharge_date: dischargeDate,
        }),
      })

      const episodeData = await episodeRes.json()

      if (!episodeRes.ok) {
        throw new Error(episodeData.error ?? 'Failed to create episode')
      }

      setEpisodeId(episodeData.data.id)
      setStep('upload')
      toast.success('Episode created — now upload the discharge PDF')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  function handleUploadComplete() {
    toast.success('AI extraction complete. Review the summary.')
    router.push(`/episodes/${episodeId}/review`)
  }

  return (
    <div className="max-w-2xl space-y-5">
      <Link href="/patients" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> All patients
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Discharge Episode</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Register the patient, create the episode, then upload the discharge PDF.
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {(['patient', 'upload'] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium border-2 transition-colors ${
              step === s || (s === 'patient' && step === 'upload')
                ? 'border-[#1C0770] bg-[#1C0770] text-white'
                : step === 'upload' && s === 'patient'
                ? 'border-[#1C0770] bg-[#1C0770] text-white'
                : 'border-border text-muted-foreground'
            }`}>
              {i + 1}
            </div>
            <span className={step === s ? 'font-medium' : 'text-muted-foreground'}>
              {s === 'patient' ? 'Patient & Episode' : 'Upload PDF'}
            </span>
            {i < 1 && <span className="text-muted-foreground mx-1">→</span>}
          </div>
        ))}
      </div>

      {/* Step 1: Patient + Episode */}
      {step !== 'upload' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Patient Information
            </CardTitle>
            <CardDescription>
              Enter the patient's details and discharge date.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label>Full name *</Label>
                <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Ahmed Al Mansoori" />
              </div>
              <div className="space-y-1.5">
                <Label>MRN (Medical Record No.) *</Label>
                <Input value={mrn} onChange={(e) => setMrn(e.target.value)} placeholder="DGH-2024-001" />
              </div>
              <div className="space-y-1.5">
                <Label>Date of birth</Label>
                <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp number (E.164) *</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+971501234567" />
              </div>
              <div className="space-y-1.5">
                <Label>Preferred language</Label>
                <Select value={language} onValueChange={(v) => setLanguage(v as LanguageCode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(SUPPORTED_LANGUAGES) as [LanguageCode, string][]).map(([code, name]) => (
                      <SelectItem key={code} value={code}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Separator />

            <div className="space-y-1.5">
              <Label>Discharge date *</Label>
              <Input
                type="date"
                value={dischargeDate}
                onChange={(e) => setDischargeDate(e.target.value)}
                className="max-w-xs"
              />
            </div>

            <Button
              onClick={handleCreatePatientAndEpisode}
              disabled={loading}
              className="w-full"
              style={{ backgroundColor: '#1C0770' }}
            >
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Continue to PDF upload
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 2: PDF Upload */}
      {step === 'upload' && episodeId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upload Discharge PDF</CardTitle>
            <CardDescription>
              Upload the patient's discharge document. Our AI will extract medications, follow-up requirements, and emergency symptoms automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DischargeUpload
              episodeId={episodeId}
              onUploadComplete={handleUploadComplete}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
