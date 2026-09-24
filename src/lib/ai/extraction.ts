import { generate } from './gemini'
import { parseModelJson } from './json'

export interface ExtractedMedication {
  name: string
  dosage: string
  frequency: string
  instructions: string
  reminder_times: string[]
}

export interface ExtractedFollowUp {
  specialty: string
  deadline: string | null
  instructions: string | null
}

/** Demographics read off the document so the intake form can be pre-filled. */
export interface ExtractedPatient {
  full_name: string | null
  mrn: string | null
  date_of_birth: string | null      // YYYY-MM-DD
  gender: 'male' | 'female' | null
  nationality: string | null
  phone: string | null              // rarely present; the nurse types it either way
}

export interface ExtractedEncounter {
  diagnosis: string | null
  admission_date: string | null     // YYYY-MM-DD
  discharge_date: string | null     // YYYY-MM-DD
  ward: string | null
  attending_physician: string | null
}

export interface ExtractionResult {
  patient?: ExtractedPatient
  encounter?: ExtractedEncounter
  medications: ExtractedMedication[]
  follow_up_requirements: ExtractedFollowUp[]
  emergency_symptoms: string[]
  lifestyle_instructions: string[]
  restrictions: string[]
  activities: string[]
  source_language: string
}

const EXTRACTION_SYSTEM_PROMPT = `
You are a clinical data extraction assistant. Extract structured discharge information from the provided hospital discharge document text.

Return ONLY valid JSON matching the schema below: no comments, no trailing commas, no markdown, no explanation, nothing outside the JSON.

Schema:
{
  "patient": {
    "full_name": "string or null",
    "mrn": "string or null (medical record number / hospital number / file number / patient ID)",
    "date_of_birth": "YYYY-MM-DD or null",
    "gender": "male | female | null",
    "nationality": "string or null",
    "phone": "string in E.164 (+971...) or null"
  },
  "encounter": {
    "diagnosis": "string or null (the primary / final diagnosis, short)",
    "admission_date": "YYYY-MM-DD or null",
    "discharge_date": "YYYY-MM-DD or null",
    "ward": "string or null",
    "attending_physician": "string or null"
  },
  "medications": [
    {
      "name": "string",
      "dosage": "string",
      "frequency": "string (e.g. twice daily, every 8 hours)",
      "instructions": "string (e.g. take with food)",
      "reminder_times": ["HH:MM", ...]
    }
  ],
  "follow_up_requirements": [
    {
      "specialty": "string (e.g. Cardiology, General Practice)",
      "deadline": "YYYY-MM-DD or null (the date the visit should happen BY)",
      "instructions": "string or null"
    }
  ],
  "emergency_symptoms": ["string (a symptom that needs immediate medical attention)", ...],
  "lifestyle_instructions": ["string", ...],
  "restrictions": ["string (something the patient must NOT do)", ...],
  "activities": ["string (something the patient SHOULD do)", ...],
  "source_language": "en | ar | hi | ta | tl"
}

Rules:
- patient / encounter: copy values exactly as written; use null when a field is not in the document. Never guess a name, MRN, date of birth or phone number.
- Dates: convert any format (12/03/2024, 12 Mar 2024, 2024-03-12) to YYYY-MM-DD. Day-first is the norm in UAE documents when ambiguous.
- follow_up_requirements.deadline: if the document gives a date, use it; if it gives a timeframe ("in 2 weeks", "within 3 months", "after 10-14 days"), compute the date from the discharge date using the END of the range; null only when no timeframe is given at all.
- Extract ALL medications listed, even if instructions are brief.
- For reminder_times: infer sensible dose times, 24-hour HH:MM, from frequency (e.g. "twice daily" → ["08:00", "20:00"]).
- Emergency symptoms: extract ONLY symptoms explicitly listed as warning signs or reasons to call emergency services.
- If a field has no relevant content, return an empty array.
- source_language: detect the primary language of the document.
`.trim()

/**
 * Extracts text from a PDF buffer using unpdf (serverless-compatible, no browser APIs needed).
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const { getDocumentProxy, extractText } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  return text.trim()
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || /^(null|n\/?a|none|unknown|-)$/i.test(trimmed)) return null
  return trimmed
}

function cleanDate(value: unknown): string | null {
  const s = cleanString(value)
  return s && ISO_DATE.test(s) && !Number.isNaN(Date.parse(s)) ? s : null
}

/** Model output is untrusted: coerce every field to the shape the app expects. */
function normaliseExtraction(raw: Partial<ExtractionResult>): ExtractionResult {
  const p = (raw.patient ?? {}) as Partial<ExtractedPatient>
  const e = (raw.encounter ?? {}) as Partial<ExtractedEncounter>
  const gender = cleanString(p.gender)?.toLowerCase()
  const phone = cleanString(p.phone)?.replace(/[\s().-]/g, '') ?? null
  const strings = (v: unknown) => (Array.isArray(v) ? v.map(cleanString).filter((x): x is string => !!x) : [])

  return {
    patient: {
      full_name: cleanString(p.full_name),
      mrn: cleanString(p.mrn),
      date_of_birth: cleanDate(p.date_of_birth),
      gender: gender === 'male' || gender === 'female' ? gender : null,
      nationality: cleanString(p.nationality),
      phone: phone && /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null,
    },
    encounter: {
      diagnosis: cleanString(e.diagnosis),
      admission_date: cleanDate(e.admission_date),
      discharge_date: cleanDate(e.discharge_date),
      ward: cleanString(e.ward),
      attending_physician: cleanString(e.attending_physician),
    },
    medications: (Array.isArray(raw.medications) ? raw.medications : [])
      .filter((m) => m && cleanString(m.name))
      .map((m) => ({
        name: cleanString(m.name) ?? '',
        dosage: cleanString(m.dosage) ?? '',
        frequency: cleanString(m.frequency) ?? '',
        instructions: cleanString(m.instructions) ?? '',
        reminder_times: strings(m.reminder_times).filter((t) => /^\d{2}:\d{2}$/.test(t)),
      })),
    follow_up_requirements: (Array.isArray(raw.follow_up_requirements) ? raw.follow_up_requirements : [])
      .filter((f) => f && cleanString(f.specialty))
      .map((f) => ({
        specialty: cleanString(f.specialty) ?? '',
        deadline: cleanDate(f.deadline),
        instructions: cleanString(f.instructions),
      })),
    emergency_symptoms: strings(raw.emergency_symptoms),
    lifestyle_instructions: strings(raw.lifestyle_instructions),
    restrictions: strings(raw.restrictions),
    activities: strings(raw.activities),
    source_language: cleanString(raw.source_language) ?? 'en',
  }
}

/**
 * Sends extracted PDF text to Gemini for structured clinical data extraction.
 * Retries and falls back to another model when Gemini is overloaded; throws
 * GeminiUnavailableError when nothing answered so the route can say "busy".
 */
export async function extractDischargeData(pdfText: string, opts: { budgetMs?: number } = {}): Promise<ExtractionResult> {
  if (!pdfText || pdfText.length < 50) {
    throw new Error('PDF text is too short or empty. The document may be scanned/image-only.')
  }

  const prompt = `${EXTRACTION_SYSTEM_PROMPT}\n\nExtract structured discharge information from this document:\n\n${pdfText.slice(0, 15000)}`

  // The route allows 60 s; PDF parsing already used a little of it. Copying a
  // letter into fields needs no reasoning step, and the thinking was most of
  // the wait; the nurse checks every field before anything is sent.
  const { text: content } = await generate(
    { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } },
    { label: 'extraction', budgetMs: opts.budgetMs ?? 45_000, noThinking: true },
  )

  if (!content) throw new Error('No response from extraction model')

  // Strip markdown code fences if present
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Extraction model returned invalid JSON')

  return normaliseExtraction(parseModelJson(jsonMatch[0]) as Partial<ExtractionResult>)
}

/** True when the model found something clinically useful (guards against wrong-document uploads). */
export function hasMeaningfulContent(extracted: ExtractionResult): boolean {
  return (
    extracted.medications.length > 0 ||
    extracted.emergency_symptoms.length > 0 ||
    extracted.lifestyle_instructions.length > 0 ||
    extracted.restrictions.length > 0
  )
}
