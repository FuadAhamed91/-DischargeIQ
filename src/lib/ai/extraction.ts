import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
const gemini = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

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

export interface ExtractionResult {
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

Return ONLY valid JSON matching the schema below. Do not include markdown, explanation, or any text outside the JSON.

Schema:
{
  "medications": [
    {
      "name": "string",
      "dosage": "string",
      "frequency": "string (e.g. twice daily, every 8 hours)",
      "instructions": "string (e.g. take with food)",
      "reminder_times": ["HH:MM", ...] // suggested reminder times in 24h format
    }
  ],
  "follow_up_requirements": [
    {
      "specialty": "string (e.g. Cardiology, General Practice)",
      "deadline": "YYYY-MM-DD or null",
      "instructions": "string or null"
    }
  ],
  "emergency_symptoms": ["string", ...], // symptoms that require immediate medical attention
  "lifestyle_instructions": ["string", ...],
  "restrictions": ["string", ...], // things the patient must NOT do
  "activities": ["string", ...], // things the patient SHOULD do
  "source_language": "en | ar | hi | ta | tl"
}

Rules:
- Extract ALL medications listed, even if instructions are brief.
- For reminder_times: infer sensible times from frequency (e.g. "twice daily" → ["08:00", "20:00"]).
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

/**
 * Sends extracted PDF text to Gemini 2.5 Flash for structured clinical data extraction.
 */
export async function extractDischargeData(pdfText: string): Promise<ExtractionResult> {
  if (!pdfText || pdfText.length < 50) {
    throw new Error('PDF text is too short or empty. The document may be scanned/image-only.')
  }

  const prompt = `${EXTRACTION_SYSTEM_PROMPT}\n\nExtract structured discharge information from this document:\n\n${pdfText.slice(0, 15000)}`

  const response = await gemini.generateContent(prompt)
  const content = response.response.text().trim()

  if (!content) throw new Error('No response from extraction model')

  // Strip markdown code fences if present
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Extraction model returned invalid JSON')

  const result = JSON.parse(jsonMatch[0]) as ExtractionResult
  return result
}
