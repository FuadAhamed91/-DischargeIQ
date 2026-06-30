import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

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
 * Extracts text from a PDF buffer using pdf-parse.
 * Falls back gracefully if the PDF is scanned/image-only.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  // Dynamic import to avoid issues with Next.js edge runtime
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>
  const data = await pdfParse(buffer)
  return data.text.trim()
}

/**
 * Sends extracted PDF text to GPT-4o for structured clinical data extraction.
 */
export async function extractDischargeData(pdfText: string): Promise<ExtractionResult> {
  if (!pdfText || pdfText.length < 50) {
    throw new Error('PDF text is too short or empty. The document may be scanned/image-only.')
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Extract structured discharge information from this document:\n\n${pdfText.slice(0, 12000)}`,
      },
    ],
  })

  const content = response.choices[0]?.message?.content
  if (!content) throw new Error('No response from extraction model')

  const result = JSON.parse(content) as ExtractionResult
  return result
}
