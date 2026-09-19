/**
 * Prints the care plan WhatsApp message for a sample episode so wording and
 * layout can be checked without sending anything. No network or keys needed.
 * Run with:  npx --yes tsx scripts/preview-care-plan.ts [en|ar|hi|ta|tl]
 */
// Must be set before the templates module is evaluated (it reads the flag at load time),
// hence the dynamic import at the bottom.
process.env.WHATSAPP_USE_TEXT_FALLBACK = 'true'

import type { LanguageCode } from '@/types/enums'
import type { DischargeSummary, Medication } from '@/types/database'

const language = (process.argv[2] ?? 'en') as LanguageCode

const summary = {
  emergency_symptoms: ['Fever above 38.5 C or shaking chills', 'Redness, swelling or pus at a wound site', 'Yellowing of the skin or eyes'],
  lifestyle_instructions: ['Eat small, low-fat meals for 2-4 weeks', 'Drink 2 litres of water a day', 'Keep wounds dry for 48 hours'],
  restrictions: [], activities: [],
} as unknown as DischargeSummary

const medications = [
  { name: 'Paracetamol', dosage: '1 g', frequency: 'four times daily for 5 days' },
  { name: 'Amoxicillin-clavulanate', dosage: '625 mg', frequency: 'three times daily for 5 days' },
  { name: 'Ferrous sulfate', dosage: '200 mg', frequency: 'once daily in the morning' },
] as unknown as Medication[]

const appointments = [
  { specialty: 'Surgical outpatient clinic', scheduled_at: '2026-10-03T05:00:00.000Z', location: null, time_tbc: true },
  { specialty: 'Full blood count', scheduled_at: '2026-10-17T06:30:00.000Z', location: 'Outpatient laboratory, Level 1', time_tbc: false },
]

const translation = language === 'hi' ? {
  medications: [
    { name: 'पैरासिटामोल', dosage: '1 ग्राम', frequency: 'दिन में चार बार, 5 दिन तक' },
    { name: 'एमोक्सिसिलिन-क्लैवुलैनेट', dosage: '625 मि.ग्रा.', frequency: 'दिन में तीन बार, 5 दिन तक' },
    { name: 'फेरस सल्फेट', dosage: '200 मि.ग्रा.', frequency: 'रोज़ सुबह एक बार' },
  ],
  lifestyle_instructions: ['2-4 हफ़्ते तक थोड़ा-थोड़ा, कम वसा वाला भोजन लें', 'रोज़ 2 लीटर पानी पिएँ', '48 घंटे तक घाव सूखे रखें'],
  emergency_symptoms: ['38.5 C से ऊपर बुखार या कँपकँपी', 'घाव पर लालिमा, सूजन या मवाद', 'त्वचा या आँखों का पीला पड़ना'],
} : null

void import('@/lib/whatsapp/templates').then(({ buildDischargeSummaryMessage }) => {
  const msg = buildDischargeSummaryMessage({
    to: '+971500000000', patientName: 'Farzana Arif', hospitalName: 'Dubai General Hospital',
    language, summary, medications, appointments, timezone: 'Asia/Dubai', translation,
  })
  console.log(msg.type === 'text' ? msg.body : JSON.stringify(msg, null, 2))
  console.log(`\n(${msg.type === 'text' ? msg.body.length : 0} characters)`)
})
