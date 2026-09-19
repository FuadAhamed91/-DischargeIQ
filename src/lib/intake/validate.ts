import { z } from 'zod'

export const INTAKE_ROLES = new Set(['super_admin', 'hospital_admin', 'discharge_coordinator', 'nurse'])

export const MAX_PDF_BYTES = 20 * 1024 * 1024

/** Returns an error message, or null when the upload is an acceptable PDF. */
export function validatePdfUpload(file: FormDataEntryValue | null): string | null {
  if (!file || typeof file === 'string') return 'No file provided'
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return 'Only PDF files are accepted'
  if (file.size > MAX_PDF_BYTES) return 'File must be under 20MB'
  if (file.size === 0) return 'The file is empty'
  return null
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optionalText = z.string().trim().max(500).nullish().transform((v) => (v ? v : null))

const MedicationSchema = z.object({
  name: z.string().trim().min(1),
  dosage: z.string().trim().max(200).default(''),
  frequency: z.string().trim().max(200).default(''),
  instructions: z.string().trim().max(1000).default(''),
  reminder_times: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(12).default([]),
})

const FollowUpSchema = z.object({
  specialty: z.string().trim().min(1),
  deadline: isoDate.nullish().transform((v) => v ?? null),
  instructions: optionalText,
})

/** What the confirm form posts back: the nurse-checked patient details + the extraction they approved. */
export const IntakeCommitSchema = z.object({
  patient: z.object({
    full_name: z.string().trim().min(2, 'Full name is required'),
    mrn: z.string().trim().min(1, 'MRN is required'),
    phone_e164: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format e.g. +971501234567'),
    preferred_language: z.enum(['ar', 'en', 'hi', 'ta', 'tl']).default('en'),
    date_of_birth: isoDate.nullish().transform((v) => v ?? null),
    gender: z.enum(['male', 'female']).nullish().transform((v) => v ?? null),
    nationality: optionalText,
  }),
  episode: z.object({
    discharge_date: isoDate,
    diagnosis: optionalText,
    admission_date: isoDate.nullish().transform((v) => v ?? null),
    ward: optionalText,
    attending_physician: optionalText,
  }),
  extraction: z.object({
    medications: z.array(MedicationSchema).max(40).default([]),
    follow_up_requirements: z.array(FollowUpSchema).max(20).default([]),
    emergency_symptoms: z.array(z.string().trim().min(1)).max(40).default([]),
    lifestyle_instructions: z.array(z.string().trim().min(1)).max(40).default([]),
    restrictions: z.array(z.string().trim().min(1)).max(40).default([]),
    activities: z.array(z.string().trim().min(1)).max(40).default([]),
    source_language: z.string().default('en'),
  }),
})

export type IntakeCommitInput = z.infer<typeof IntakeCommitSchema>
