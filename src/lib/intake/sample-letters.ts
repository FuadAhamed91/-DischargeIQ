/**
 * The sample discharge letters: fictional patients a demo can add in two
 * clicks. The same three letters are in docs/ as PDFs; the Add patient page
 * offers them beside the letter box, printed with today's dates
 * (GET /api/v1/intake/sample-letters/[id]),
 * so a demo always shows a patient discharged today with follow-ups ahead.
 *
 * Each letter is kept here as structured data, which gives two things:
 *   - the letter itself (sampleLetterBlocks → lib/pdf/text-pdf.ts), and
 *   - what reading it should give (sampleExtraction), which the intake uses
 *     when the AI reader is unavailable (no key, quota spent, Google busy),
 *     so a sample letter never ends in "Couldn't read that letter".
 *
 * A letter is recognised by its patient name and MRN; its dates are read
 * back from the text, so an older copy (the docs/ PDFs) still gets its own
 * dates rather than today's.
 */

import type { ExtractionResult } from '@/lib/ai/extraction'
import type { PdfBlock } from '@/lib/pdf/text-pdf'

/** A date relative to the discharge day. */
interface Offset {
  days?: number
  months?: number
}

/** Formats an offset from the discharge day the way the letters write dates (dd/mm/yyyy). */
type DateText = (offset?: Offset) => string

interface SampleMedication {
  /** As printed after the number in DISCHARGE MEDICATIONS. */
  line: string
  name: string
  dosage: string
  frequency: string
  instructions: string
  reminder_times: string[]
}

interface SampleFollowUp {
  line: (d: DateText) => string
  specialty: string
  by: Offset
  instructions: string
}

export interface SampleLetter {
  id: string
  /** What the Add patient page says about the letter. */
  headline: string
  department: string
  patient: {
    full_name: string
    mrn: string
    date_of_birth: string // YYYY-MM-DD
    gender: 'male' | 'female'
    nationality: string
  }
  ward: string
  physician: string
  /** The physician's name alone, for "Prepared by". */
  signedBy: string
  signedAt: string // HH:MM on the discharge day
  admittedDaysBefore: number
  diagnosis: {
    /** Short form for the episode. */
    summary: string
    primary: (d: DateText) => string
    secondary: string
  }
  course: string
  medications: SampleMedication[]
  followUps: SampleFollowUp[]
  /** Printed under FOLLOW-UP without being a visit of its own. */
  followUpNote?: string
  emergency_symptoms: string[]
  lifestyle_instructions: string[]
  restrictions: string[]
  activities: string[]
}

export const SAMPLE_LETTERS: SampleLetter[] = [
  {
    id: 'fatima-al-hashimi',
    headline: 'Heart failure, diabetes',
    department: 'Cardiology',
    patient: {
      full_name: 'Fatima Al Hashimi',
      mrn: 'DGH-2026-0417',
      date_of_birth: '1962-06-14',
      gender: 'female',
      nationality: 'United Arab Emirates',
    },
    ward: 'Cardiology Ward B, Bed 7',
    physician: 'Dr. Rashid Al Marzouqi, Consultant Cardiologist',
    signedBy: 'Dr. Rashid Al Marzouqi',
    signedAt: '10:40',
    admittedDaysBefore: 7,
    diagnosis: {
      summary: 'Acute decompensated heart failure (NYHA class III), reduced ejection fraction (LVEF 35%)',
      primary: () => 'Acute decompensated heart failure (NYHA class III), reduced ejection fraction (LVEF 35%).',
      secondary: 'Type 2 diabetes mellitus, hypertension.',
    },
    course:
      'Admitted with 5 days of progressive breathlessness and bilateral leg swelling. Treated with IV diuretics, with good response (weight down 4.2 kg). Echocardiogram showed LVEF 35%. Guideline-directed medical therapy started and up-titrated. Euvolaemic at discharge, walking on the flat without breathlessness.',
    medications: [
      { line: 'Furosemide 40 mg tablet - once daily in the morning. Take with a glass of water; weigh yourself every morning.', name: 'Furosemide', dosage: '40 mg', frequency: 'Once daily in the morning', instructions: 'Take with a glass of water; weigh yourself every morning.', reminder_times: ['08:00'] },
      { line: 'Bisoprolol 2.5 mg tablet - once daily in the morning. Do not stop suddenly.', name: 'Bisoprolol', dosage: '2.5 mg', frequency: 'Once daily in the morning', instructions: 'Do not stop suddenly.', reminder_times: ['08:00'] },
      { line: 'Ramipril 5 mg tablet - once daily at night. May cause dizziness when standing up quickly.', name: 'Ramipril', dosage: '5 mg', frequency: 'Once daily at night', instructions: 'May cause dizziness when standing up quickly.', reminder_times: ['21:00'] },
      { line: 'Metformin 500 mg tablet - twice daily with breakfast and dinner.', name: 'Metformin', dosage: '500 mg', frequency: 'Twice daily', instructions: 'Take with breakfast and dinner.', reminder_times: ['08:00', '20:00'] },
      { line: 'Atorvastatin 20 mg tablet - once daily at night.', name: 'Atorvastatin', dosage: '20 mg', frequency: 'Once daily at night', instructions: '', reminder_times: ['21:00'] },
    ],
    followUps: [
      { line: (d) => `Cardiology clinic (Dr. Al Marzouqi): within 2 weeks of discharge, by ${d({ days: 14 })}. Bring your weight diary.`, specialty: 'Cardiology', by: { days: 14 }, instructions: 'Clinic review with Dr. Al Marzouqi. Bring your weight diary.' },
      { line: (d) => `Blood tests (kidney function and potassium): in 1 week, by ${d({ days: 7 })}, at the outpatient laboratory.`, specialty: 'Blood tests (kidney function and potassium)', by: { days: 7 }, instructions: 'At the outpatient laboratory.' },
      { line: () => 'Diabetes clinic: routine review in 3 months.', specialty: 'Diabetes clinic', by: { months: 3 }, instructions: 'Routine review.' },
    ],
    emergency_symptoms: [
      'Chest pain or pressure',
      'Severe shortness of breath, or breathlessness while lying flat',
      'Weight gain of more than 2 kg in 3 days',
      'Fainting or near-fainting',
      'Rapid or irregular heartbeat',
      'Confusion or severe drowsiness',
    ],
    lifestyle_instructions: [
      'Limit salt to less than 2 grams per day; avoid pickles, processed meat and canned soups.',
      'Limit fluids to 1.5 litres per day including tea, coffee and soup.',
      'Weigh yourself every morning after using the toilet and record it.',
      'Walk for 15-20 minutes daily, increasing gradually as tolerated.',
    ],
    restrictions: [
      'Do not lift anything heavier than 5 kg for 2 weeks.',
      'Do not take ibuprofen, diclofenac or other anti-inflammatory painkillers.',
      'No driving for 1 week.',
    ],
    activities: [
      'Take all medicines exactly as listed above.',
      'Check your blood sugar before breakfast and dinner.',
      'Keep your follow-up appointments.',
    ],
  },
  {
    id: 'umar-siddiqui',
    headline: 'Heart attack, stent fitted',
    department: 'Cardiology',
    patient: {
      full_name: 'Umar Siddiqui',
      mrn: 'DGH-2026-0611',
      date_of_birth: '1974-02-22',
      gender: 'male',
      nationality: 'Pakistan',
    },
    ward: 'Cardiac Care Unit, then Cardiology Ward A, Bed 4',
    physician: 'Dr. Noor Al Suwaidi, Consultant Interventional Cardiologist',
    signedBy: 'Dr. Noor Al Suwaidi',
    signedAt: '11:05',
    admittedDaysBefore: 3,
    diagnosis: {
      summary: 'Acute inferior STEMI, treated with primary PCI and a drug-eluting stent to the right coronary artery',
      primary: (d) => `Acute inferior ST-elevation myocardial infarction (STEMI), treated with primary PCI and a drug-eluting stent to the right coronary artery on ${d({ days: -3 })}.`,
      secondary: 'Hypertension, dyslipidaemia, ex-smoker (stopped on admission).',
    },
    course:
      'Presented to the emergency department with 2 hours of central crushing chest pain. ECG showed inferior ST elevation; taken directly for primary PCI with a drug-eluting stent to a 95% RCA lesion. Uncomplicated recovery on the Cardiac Care Unit. Echocardiogram: mild inferior hypokinesia, LVEF 48%. Pain-free and mobilising on the ward at discharge. Smoking cessation counselling given.',
    medications: [
      { line: 'Aspirin 75 mg tablet - once daily in the morning, lifelong. Take after food.', name: 'Aspirin', dosage: '75 mg', frequency: 'Once daily in the morning, lifelong', instructions: 'Take after food.', reminder_times: ['08:00'] },
      { line: 'Ticagrelor 90 mg tablet - twice daily (morning and evening) for 12 months. Do NOT stop without speaking to your cardiologist - the stent can block.', name: 'Ticagrelor', dosage: '90 mg', frequency: 'Twice daily (morning and evening) for 12 months', instructions: 'Do not stop without speaking to your cardiologist - the stent can block.', reminder_times: ['08:00', '20:00'] },
      { line: 'Atorvastatin 80 mg tablet - once daily at night.', name: 'Atorvastatin', dosage: '80 mg', frequency: 'Once daily at night', instructions: '', reminder_times: ['21:00'] },
      { line: 'Bisoprolol 2.5 mg tablet - once daily in the morning.', name: 'Bisoprolol', dosage: '2.5 mg', frequency: 'Once daily in the morning', instructions: '', reminder_times: ['08:00'] },
      { line: 'Ramipril 2.5 mg tablet - once daily at night. May cause a dry cough or dizziness.', name: 'Ramipril', dosage: '2.5 mg', frequency: 'Once daily at night', instructions: 'May cause a dry cough or dizziness.', reminder_times: ['21:00'] },
      { line: 'Glyceryl trinitrate (GTN) 400 mcg spray - one or two sprays under the tongue when needed for chest pain. If pain lasts more than 15 minutes, call 998.', name: 'Glyceryl trinitrate (GTN) spray', dosage: '400 mcg, one or two sprays under the tongue', frequency: 'When needed for chest pain', instructions: 'If pain lasts more than 15 minutes, call 998.', reminder_times: [] },
    ],
    followUps: [
      { line: (d) => `Cardiology clinic (Dr. Al Suwaidi): in 2 weeks, by ${d({ days: 14 })}, for review and blood pressure check.`, specialty: 'Cardiology', by: { days: 14 }, instructions: 'Review and blood pressure check with Dr. Al Suwaidi.' },
      { line: (d) => `Cardiac rehabilitation programme: to start within 4 weeks of discharge, by ${d({ days: 28 })}.`, specialty: 'Cardiac rehabilitation', by: { days: 28 }, instructions: 'Start the cardiac rehabilitation programme.' },
      { line: (d) => `Blood tests (lipid profile, kidney function): in 6 weeks, by ${d({ days: 42 })}, at the outpatient laboratory.`, specialty: 'Blood tests (lipid profile, kidney function)', by: { days: 42 }, instructions: 'At the outpatient laboratory.' },
    ],
    emergency_symptoms: [
      'Chest pain or pressure lasting more than 15 minutes, or not relieved by GTN spray',
      'Severe shortness of breath at rest or when lying flat',
      'Fainting, or a racing or irregular heartbeat',
      'Bleeding that will not stop, black or bloody stools, or vomiting blood',
      'Swelling, pain or a growing lump at the wrist puncture site',
      'Sudden weakness of the face, arm or leg, or difficulty speaking',
    ],
    lifestyle_instructions: [
      'Do not smoke. Nicotine replacement has been prescribed; the smoking cessation clinic will call you.',
      'Eat a heart-healthy diet: less salt, less fried food, more vegetables, fish and whole grains.',
      'Walk 10-15 minutes twice a day this week, increasing gradually as advised by cardiac rehab.',
      'Check your blood pressure daily and record it.',
    ],
    restrictions: [
      'No driving for 4 weeks.',
      'No lifting more than 5 kg for 2 weeks.',
      'Do not take ibuprofen, diclofenac or other anti-inflammatory painkillers - they increase bleeding risk with ticagrelor.',
    ],
    activities: [
      'Carry your GTN spray with you at all times.',
      'Take every medicine exactly as listed, especially ticagrelor and aspirin.',
      'Keep your follow-up appointments.',
    ],
  },
  {
    id: 'farzana-arif',
    headline: 'Gallbladder removed',
    department: 'General Surgery',
    patient: {
      full_name: 'Farzana Arif',
      mrn: 'DGH-2026-0522',
      date_of_birth: '1985-11-03',
      gender: 'female',
      nationality: 'Pakistan',
    },
    ward: 'Surgical Ward C, Bed 12',
    physician: 'Dr. Layla Haddad, Consultant General Surgeon',
    signedBy: 'Dr. Layla Haddad',
    signedAt: '09:15',
    admittedDaysBefore: 3,
    diagnosis: {
      summary: 'Acute calculous cholecystitis, treated by laparoscopic cholecystectomy',
      primary: (d) => `Acute calculous cholecystitis, treated by laparoscopic cholecystectomy on ${d({ days: -2 })}.`,
      secondary: 'Iron-deficiency anaemia (Hb 10.2 g/dL).',
    },
    course:
      'Presented with 2 days of right upper quadrant pain, fever and vomiting. Ultrasound confirmed gallstones with a thickened gallbladder wall. Started on IV antibiotics and underwent an uncomplicated laparoscopic cholecystectomy the following day (four small port sites, no drain). Tolerating a normal diet, pain controlled on oral analgesia, wounds clean and dry at discharge.',
    medications: [
      { line: 'Paracetamol 1 g tablet - four times daily for 5 days, then as needed. Do not exceed 4 g in 24 hours.', name: 'Paracetamol', dosage: '1 g', frequency: 'Four times daily for 5 days, then as needed', instructions: 'Do not exceed 4 g in 24 hours.', reminder_times: ['08:00', '12:00', '16:00', '20:00'] },
      { line: 'Ibuprofen 400 mg tablet - three times daily with food for 5 days. Stop if you have stomach pain or black stools.', name: 'Ibuprofen', dosage: '400 mg', frequency: 'Three times daily for 5 days', instructions: 'Take with food. Stop if you have stomach pain or black stools.', reminder_times: ['08:00', '14:00', '20:00'] },
      { line: 'Amoxicillin-clavulanate 625 mg tablet - three times daily for 5 days. Complete the full course.', name: 'Amoxicillin-clavulanate', dosage: '625 mg', frequency: 'Three times daily for 5 days', instructions: 'Complete the full course.', reminder_times: ['08:00', '14:00', '20:00'] },
      { line: 'Ferrous sulfate 200 mg tablet - once daily in the morning. Take with orange juice, not with tea or milk.', name: 'Ferrous sulfate', dosage: '200 mg', frequency: 'Once daily in the morning', instructions: 'Take with orange juice, not with tea or milk.', reminder_times: ['08:00'] },
      { line: 'Omeprazole 20 mg capsule - once daily before breakfast while taking ibuprofen.', name: 'Omeprazole', dosage: '20 mg', frequency: 'Once daily before breakfast', instructions: 'Take while taking ibuprofen.', reminder_times: ['07:30'] },
    ],
    followUps: [
      { line: (d) => `Surgical outpatient clinic (Dr. Haddad): wound check in 10-14 days, by ${d({ days: 14 })}.`, specialty: 'General Surgery', by: { days: 14 }, instructions: 'Wound check with Dr. Haddad; the gallbladder histology result is discussed at this visit.' },
      { line: (d) => `Full blood count: repeat in 4 weeks at the outpatient laboratory, by ${d({ days: 28 })}.`, specialty: 'Full blood count', by: { days: 28 }, instructions: 'Repeat at the outpatient laboratory.' },
    ],
    followUpNote: 'Histology result of the gallbladder will be discussed at the clinic visit.',
    emergency_symptoms: [
      'Fever above 38.5 C or shaking chills',
      'Redness, swelling, warmth or pus at any of the wound sites',
      'Severe or worsening abdominal pain not relieved by painkillers',
      'Yellowing of the skin or eyes, dark urine or pale stools',
      'Persistent vomiting or inability to keep fluids down',
      'Shortness of breath or chest pain',
    ],
    lifestyle_instructions: [
      'Eat small, low-fat meals for the first 2-4 weeks; fatty or fried food may cause bloating and loose stools.',
      'Drink 2 litres of water a day.',
      'Keep wounds dry for 48 hours, then shower normally and pat dry; leave the strips in place until they fall off.',
      'Walk several times a day; increase activity gradually.',
    ],
    restrictions: [
      'No lifting more than 5 kg for 2 weeks.',
      'No swimming or bathing in a tub for 2 weeks.',
      'No driving for 1 week or while taking pain medication that causes drowsiness.',
    ],
    activities: [
      'Take the antibiotic course to the end even if you feel well.',
      'Check the wound sites once a day for redness or discharge.',
      'Keep your follow-up appointments.',
    ],
  },
]

export function findSampleLetter(id: string): SampleLetter | null {
  return SAMPLE_LETTERS.find((l) => l.id === id) ?? null
}

/** True for an MRN that belongs to a sample patient: the intake may restart their care plan. */
export function isSampleMrn(mrn: string): boolean {
  const wanted = mrn.trim().toUpperCase()
  return SAMPLE_LETTERS.some((l) => l.patient.mrn === wanted)
}

export function sampleLetterFileName(letter: SampleLetter): string {
  return `discharge-summary-${letter.id}.pdf`
}

// ---------------------------------------------------------------------------
// Dates: calendar arithmetic on YYYY-MM-DD, no timezones involved.

function shift(iso: string, offset: Offset = {}): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + (offset.months ?? 0), d + (offset.days ?? 0)))
  return date.toISOString().slice(0, 10)
}

const letterDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

function ageOn(dob: string, day: string): number {
  const [by, bm, bd] = dob.split('-').map(Number)
  const [y, m, d] = day.split('-').map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

/** The patient's age in years on `day` (YYYY-MM-DD), as the letter prints it. */
export function sampleLetterAge(letter: SampleLetter, day: string): number {
  return ageOn(letter.patient.date_of_birth, day)
}

// ---------------------------------------------------------------------------

/** The letter as printed, for a patient discharged on `discharge` (YYYY-MM-DD). */
export function sampleLetterBlocks(letter: SampleLetter, discharge: string): PdfBlock[] {
  const d: DateText = (offset) => letterDate(shift(discharge, offset))
  const p = letter.patient
  const heading = (text: string): PdfBlock => ({ kind: 'text', text, font: 'bold', size: 11.5, spaceBefore: 14 })
  const line = (text: string): PdfBlock => ({ kind: 'text', text, spaceBefore: 3 })
  const item = (marker: string, text: string): PdfBlock => ({ kind: 'text', text: `${marker} ${text}`, spaceBefore: 3, hangingIndent: 14 })

  return [
    { kind: 'text', text: 'DUBAI GENERAL HOSPITAL', font: 'bold', size: 16, align: 'center' },
    { kind: 'text', text: `Department of ${letter.department} - Discharge Summary`, size: 10.5, align: 'center', spaceBefore: 4, muted: true },
    { kind: 'rule', spaceBefore: 12, spaceAfter: 2 },
    heading('PATIENT DETAILS'),
    line(`Patient name: ${p.full_name}`),
    line(`MRN / File number: ${p.mrn}`),
    line(`Date of birth: ${letterDate(p.date_of_birth)} (${p.gender === 'female' ? 'Female' : 'Male'}, ${ageOn(p.date_of_birth, discharge)} years)`),
    line(`Nationality: ${p.nationality}`),
    line(`Admission date: ${d({ days: -letter.admittedDaysBefore })}`),
    line(`Discharge date: ${d()}`),
    line(`Ward: ${letter.ward}`),
    line(`Attending physician: ${letter.physician}`),
    heading('DIAGNOSIS'),
    line(`Primary diagnosis: ${letter.diagnosis.primary(d)}`),
    line(`Secondary: ${letter.diagnosis.secondary}`),
    heading('HOSPITAL COURSE'),
    line(letter.course),
    heading('DISCHARGE MEDICATIONS'),
    ...letter.medications.map((m, i) => item(`${i + 1}.`, m.line)),
    heading('FOLLOW-UP'),
    ...letter.followUps.map((f) => item('-', f.line(d))),
    ...(letter.followUpNote ? [item('-', letter.followUpNote)] : []),
    heading('WARNING SIGNS - SEEK IMMEDIATE MEDICAL ATTENTION IF YOU HAVE:'),
    ...letter.emergency_symptoms.map((s) => item('-', s)),
    heading('LIFESTYLE INSTRUCTIONS'),
    ...letter.lifestyle_instructions.map((s) => item('-', s)),
    heading('RESTRICTIONS'),
    ...letter.restrictions.map((s) => item('-', s)),
    heading('ACTIVITIES'),
    ...letter.activities.map((s) => item('-', s)),
    { kind: 'rule', spaceBefore: 16, spaceAfter: 4 },
    {
      kind: 'text',
      text: `Prepared by: ${letter.signedBy} | Signed electronically ${d()} ${letter.signedAt} | This is a fictional document for software testing.`,
      font: 'italic',
      size: 8.5,
      muted: true,
    },
  ]
}

/** What reading the letter gives: the same shape the AI reader returns. */
export function sampleExtraction(letter: SampleLetter, discharge: string): ExtractionResult {
  const p = letter.patient
  return {
    patient: {
      full_name: p.full_name,
      mrn: p.mrn,
      date_of_birth: p.date_of_birth,
      gender: p.gender,
      nationality: p.nationality,
      phone: null,
    },
    encounter: {
      diagnosis: letter.diagnosis.summary,
      admission_date: shift(discharge, { days: -letter.admittedDaysBefore }),
      discharge_date: discharge,
      ward: letter.ward,
      attending_physician: letter.physician,
    },
    medications: letter.medications.map(({ name, dosage, frequency, instructions, reminder_times }) => ({
      name, dosage, frequency, instructions, reminder_times: [...reminder_times],
    })),
    follow_up_requirements: letter.followUps.map((f) => ({
      specialty: f.specialty,
      deadline: shift(discharge, f.by),
      instructions: f.instructions,
    })),
    emergency_symptoms: [...letter.emergency_symptoms],
    lifestyle_instructions: [...letter.lifestyle_instructions],
    restrictions: [...letter.restrictions],
    activities: [...letter.activities],
    source_language: 'en',
  }
}

/**
 * The sample letter this PDF text is, with the discharge date printed on it,
 * or null for any other document. Needs the patient's name and MRN, and a
 * readable discharge date.
 */
export interface SampleLetterMatch {
  letter: SampleLetter
  /** The discharge date printed on it, YYYY-MM-DD. */
  discharge: string
}

export function recogniseSampleLetter(pdfText: string): SampleLetterMatch | null {
  const text = pdfText.replace(/\s+/g, ' ')
  const date = text.match(/Discharge date:\s*(\d{2})\/(\d{2})\/(\d{4})/)
  if (!date) return null
  const discharge = `${date[3]}-${date[2]}-${date[1]}`
  if (shift(discharge) !== discharge) return null // 31/02 and the like
  const letter = SAMPLE_LETTERS.find((l) => text.includes(`Patient name: ${l.patient.full_name}`) && text.includes(l.patient.mrn))
  return letter ? { letter, discharge } : null
}
