# PRODUCT NAME
CareLoop

# PRODUCT VISION
CareLoop is an enterprise B2B healthcare platform designed to reduce hospital readmissions by automating post-discharge patient care and follow-up through WhatsApp.

The hospital's responsibility should not end when a patient leaves the hospital.

CareLoop bridges the gap between discharge and recovery by providing multilingual discharge support, automated follow-ups, appointment management, and AI-powered risk monitoring.

The nurse interacts with a web dashboard.
The patient interacts only through WhatsApp.

Patients should never need to:
- Download an app
- Create an account
- Remember passwords
- Learn a new platform

Everything should happen directly inside WhatsApp.

---------------------------------------------------
THE PROBLEM
---------------------------------------------------

Hospitals lose visibility over patients immediately after discharge.

Common issues include:

- Patients do not understand discharge instructions.
- Medication schedules are forgotten.
- Follow-up appointments are missed.
- Nurses spend hours manually making follow-up calls.
- Readmissions occur because warning signs are missed.
- Elderly patients struggle with complicated instructions.
- Non-English speakers often receive instructions in a language they do not fully understand.

In the UAE this is especially important because hospitals regularly serve:

- Arabic speakers
- English speakers
- Hindi speakers
- Tamil speakers
- Tagalog speakers

---------------------------------------------------
TARGET CUSTOMERS
---------------------------------------------------

- Government hospitals
- Private hospitals
- Specialty clinics
- Discharge coordinators
- Ward nurses
- Case managers

Primary market:
United Arab Emirates

Future expansion:
Middle East and GCC region

---------------------------------------------------
SYSTEM OVERVIEW
---------------------------------------------------

CareLoop consists of five major systems:

1. Clinical Ingestion Engine
2. Patient WhatsApp Interface
3. Reminder Engine
4. AI Triage Engine
5. Clinical Dashboard

---------------------------------------------------
SYSTEM 1 — CLINICAL INGESTION ENGINE
---------------------------------------------------

The nurse uploads a discharge PDF.

The system automatically extracts:

- Medications
- Dosages
- Frequencies
- Activities
- Restrictions
- Lifestyle instructions
- Emergency warning signs
- Follow-up requirements
- Follow-up specialties
- Appointment deadlines

The system translates the extracted information into the patient's preferred language.

Supported languages:

- Arabic
- English
- Hindi
- Tamil
- Tagalog

The nurse reviews the extracted information before approval.

The nurse can:
- Edit information
- Add notes
- Approve the discharge summary
- Send it to the patient

---------------------------------------------------
SYSTEM 2 — PATIENT WHATSAPP EXPERIENCE
---------------------------------------------------

After approval, the patient receives:

- Medication instructions
- Exercise instructions
- Lifestyle guidance
- Emergency warning signs
- Appointment information

Messages should use:
- Simple language
- Large buttons
- Minimal medical terminology

Features:

- Medication reminders
- Exercise reminders
- Water reminders
- Appointment reminders
- Voice note support
- Audio playback of care plans
- Appointment confirmations
- One phone, several patients: a household shares a number, a relative writes for two patients.
  Each patient keeps their own conversation; the assistant works out who a message is about
  (a name at the start, the question that is waiting, who was written about last) and asks
  when it cannot tell.

---------------------------------------------------
APPOINTMENT MANAGEMENT
---------------------------------------------------

The system should actively manage follow-up appointments.

Workflow:

1. Patient receives discharge summary.

2. Patient receives appointment details.

3. Patient is asked:

"Can you attend this appointment?"

Options:

- Yes
- No

If patient selects YES:

- Appointment is confirmed.
- Dashboard updates immediately.
- Reminder messages are scheduled.

If patient selects NO:

- CareLoop retrieves the next available appointment slots from the hospital scheduling system.
- Alternative appointment times are shown.
- Patient selects preferred slot.
- Appointment is automatically rebooked.
- Dashboard updates in real time.

Additional features:

- Appointment confirmations
- Appointment rescheduling
- Missed appointment tracking
- Escalation for unconfirmed appointments
- Calendar integration
- Real-time updates

---------------------------------------------------
SYSTEM 3 — DAILY REMINDER ENGINE
---------------------------------------------------

Reminder schedules are automatically generated from discharge instructions.

Examples:

08:00 AM
Medication reminder

10:00 AM
Exercise reminder

01:00 PM
Hydration reminder

08:00 PM
Daily symptom check

Patients can respond using:

- Yes
- No
- Text messages
- Voice notes

Every response is stored in the patient timeline.
---------------------------------------------------
PATIENT COMMUNICATION MODES
---------------------------------------------------

Patients can interact with CareLoop in two ways:

1. Text Chat
2. Voice Chat

Patients can ask questions in their preferred language at any time.

Supported languages:
- Arabic
- English
- Hindi
- Tamil
- Tagalog

Examples:

Text:
- "Can I take my medicine after lunch?"
- "I forgot whether I took my tablet."
- "Can I go for a longer walk?"
- "What foods should I avoid?"
- "When is my next appointment?"

Voice:
Patient records a WhatsApp voice note asking the same questions naturally in their own language.

Examples:
- "Can I drink coffee with this medicine?"
- "I feel slightly dizzy today."
- "When should I take my water pill?"
- "Can I reschedule my appointment?"

The system should:

For text:
- Understand the question.
- Answer using information from the patient's discharge summary.
- Respond in the patient's preferred language.

For voice:
- Transcribe audio using Whisper.
- Understand intent using AI.
- Generate an answer.
- Return both text and optional voice responses.

The AI assistant should only answer using:
- The patient's discharge instructions.
- Hospital-approved guidance.
- Appointment information.

If confidence is low or a medical question exceeds allowed scope:
- Escalate to a nurse.
- Inform the patient that a member of the care team will contact them.

The AI assistant must never:
- Diagnose diseases.
- Recommend new medications.
- Change prescribed dosages.
- Replace emergency medical care.

If emergency symptoms are detected:
- Trigger the triage engine immediately.
- Notify clinical staff.

---------------------------------------------------
SYSTEM 4 — AI TRIAGE ENGINE
---------------------------------------------------

When a patient sends a voice note:

Step 1:
Transcribe audio using Whisper.

Step 2:
Compare symptoms against the emergency symptoms extracted from THAT patient's discharge summary.

Step 3:
Assign risk level.

Risk levels:

GREEN
Patient appears stable.

YELLOW
Minor symptoms detected.
Requires nurse review.

RED
Critical symptoms detected.
Immediate nurse attention required.

When RED risk occurs:

- Dashboard alert is triggered.
- Transcript is stored.
- Audio file is stored.
- Patient receives reassurance message.
- Assigned nurse receives notification.

Target processing time:

Under 15 seconds.

---------------------------------------------------
SYSTEM 5 — CLINICAL DASHBOARD
---------------------------------------------------

Nurses should see:

- Patient list
- Language
- Appointment status
- Compliance status
- Risk status
- Alerts

Patient profile includes:

- Discharge summary
- Medication history
- Daily logs
- Voice notes
- Transcripts
- Risk history
- Appointment history
- Compliance trends

---------------------------------------------------
ANALYTICS
---------------------------------------------------

Dashboard metrics:

- Active patients
- Alerts triggered
- Readmissions prevented
- Estimated savings
- Appointment completion rate
- Medication adherence rate
- Response rates
- Compliance rates

---------------------------------------------------
BUSINESS VALUE
---------------------------------------------------

CareLoop aims to reduce:

- Hospital readmissions
- Missed appointments
- Manual follow-up workload

CareLoop aims to increase:

- Patient adherence
- Follow-up attendance
- Patient satisfaction
- Operational efficiency

---------------------------------------------------
TECH STACK
---------------------------------------------------

Frontend:
- Next.js 15
- TypeScript
- TailwindCSS
- shadcn/ui

Backend:
- Supabase
- PostgreSQL
- Row Level Security

AI:
- OpenAI GPT
- OpenAI Whisper
- Google Gemini

Messaging:
- WhatsApp Business API

Realtime:
- Supabase Realtime

Scheduling:
- Cron Jobs

Storage:
- Supabase Storage

Deployment:
- Vercel
- Supabase

---------------------------------------------------
DESIGN REQUIREMENTS
---------------------------------------------------

Design style:

- Enterprise healthcare SaaS
- Modern
- Minimal
- Professional
- Accessible

Design inspiration:

- Stripe Dashboard
- Linear
- Notion

Brand colors:

Primary:
#1C0770

Secondary:
#30D5C8

---------------------------------------------------
IMPORTANT INSTRUCTIONS
---------------------------------------------------

This file is the single source of truth for the project.

Read and understand this context completely before making technical decisions.

Do not generate application code yet.

Only create PROJECT_CONTEXT.md.
Wait for further instructions.
