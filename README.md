# DischargeIQ

Post-discharge patient follow-up over WhatsApp, for hospitals in the UAE.

Clinical staff use a web dashboard; patients never install anything. A nurse uploads the
discharge document, checks the details it was read into, and approves the summary; the patient
then receives their care plan on WhatsApp in their own language, gets one check-in every night
(medicines taken? how are you feeling?), can ask questions that are answered strictly from their
own discharge instructions, and is escalated to a nurse the moment they report a warning sign.

- **Product context:** [PROJECT_CONTEXT.md](./PROJECT_CONTEXT.md) (vision, systems, languages)
- **Design:** [ARCHITECTURE.md](./ARCHITECTURE.md) (schema, roles, workflows — the original proposal)
- **Agent notes:** [AGENTS.md](./AGENTS.md) (this is Next.js 16; read `node_modules/next/dist/docs/` before writing framework code)

---

## Contents

1. [Stack](#stack)
2. [How it works](#how-it-works)
3. [Repository layout](#repository-layout)
4. [Local development](#local-development)
5. [Database](#database)
6. [Background jobs](#background-jobs)
7. [Deployment](#deployment)
8. [Operations runbook](#operations-runbook)
9. [Security model](#security-model)
10. [Testing](#testing)
11. [Known limitations](#known-limitations)

---

## Stack

| Layer | Technology |
|---|---|
| Dashboard | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind 4, shadcn/ui, Recharts |
| Backend | Next.js route handlers on Vercel; Supabase (Postgres 17, Auth, Storage, Realtime, Vault) |
| Scheduling | Vercel Cron (daily jobs) + `pg_cron` / `pg_net` inside Supabase (5-minute dispatch) |
| Messaging | WhatsApp via **Twilio** (currently the sandbox; text only) |
| AI | Gemini 2.5 Flash (extraction, translation, patient Q&A, triage, voice-note transcription) through `lib/ai/gemini.ts`, which retries 429/5xx and falls back to `gemini-2.5-flash-lite` → `gemini-2.5-pro` when Google reports high demand; OpenAI Whisper only as an optional transcription fallback |
| PDF | `unpdf` (serverless-safe text extraction) |

Multi-tenant: every row carries `hospital_id` and Postgres Row Level Security enforces isolation.
Roles: `super_admin`, `hospital_admin`, `discharge_coordinator`, `nurse`, `case_manager`, `read_only`.

---

## How it works

### 1. Discharge → care plan (nurse)

Intake is **document-first**: the nurse drops the discharge PDF and the form fills itself.

```
drop PDF   ──► /api/v1/intake/extract            (unpdf → Gemini: patient demographics + encounter + medications,
                                                   follow-ups, warning signs; nothing written yet)
nurse checks ► /episodes/new                      (pre-filled; nurse types the WhatsApp number — it is never in
                                                   the document — fixes anything marked "not found", confirms)
           ──► /api/v1/intake/commit             (patient by MRN or new · episode · PDF → Storage
                                                   discharge-documents/<hospital>/<episode>/… · discharge_documents
                                                   · draft summary + medications + follow_up_requirements
                                                   └─ after(): translate into patient + hospital languages)
nurse reviews ► /episodes/[id]/review             (edit, notes, approve — nothing reaches the patient before this)
           ──► /api/v1/episodes/[id]/summary/send (WhatsApp care plan; episode → active; nightly check-in scheduled)
```

`lib/intake/persist-extraction.ts` is the single place an extraction becomes a summary; the older
`/api/v1/episodes/[id]/documents` + `/extract` pair still works for re-uploading on an existing
episode (and for the "enter details manually" fallback when there is no readable PDF).

Approval activates the episode, which creates its `whatsapp_conversations` row (DB trigger).

The care plan message (`buildDischargeSummaryMessage`, plain text on the sandbox) lists medicines,
key instructions, **follow-up appointments** (booked slots with time and place, or the letter's
"by" date marked "time to be confirmed") and the warning signs. Section headings are in the
patient's language and the content uses the stored `discharge_summary_translations` row when the
patient's language differs from the document's. Preview it without sending:
`npx --yes tsx scripts/preview-care-plan.ts hi`.

### 2. Nightly check-in (automatic)

One scheduled conversation per patient per day, at **21:00 hospital-local** (override:
`hospitals.settings.checkin_time`). Per-dose medication reminders were retired in migration 00009;
dose times stay on the medications as instructions in the care plan.

```mermaid
flowchart LR
  A[reminder_schedules<br/>one symptom_check per episode<br/>nightly_checkin_v1] -->|00:00 UTC daily<br/>Vercel cron| B["/api/cron/reminders/generate"]
  B -->|next 24h, hospital tz| C[(reminder_jobs<br/>pending)]
  D[pg_cron every 5 min] -->|GET + CRON_SECRET from Vault| E["/api/cron/reminders/dispatch"]
  C --> E
  E -->|Twilio: Q1 medicines 1/2/3| F((patient WhatsApp))
  E -->|sendAndLog| G[(whatsapp_messages<br/>timeline: reminder_sent)]
  E -->|state| H[conversation:<br/>awaiting_checkin_meds]
```

- `lib/reminders/checkin.ts` builds the schedule row; `summary/send` inserts it when the plan goes out.
- `lib/reminders/generator.ts` converts the wall-clock time in the hospital's timezone to a UTC
  instant with `date-fns-tz` (`fromZonedTime`) — correct regardless of the server's timezone.
- `reminder_jobs (schedule_id, fire_at)` is unique, so re-running the generator is idempotent.
- `lib/reminders/dispatcher.ts` sends everything due (`status = pending AND fire_at <= now()`).
- Wording for all five languages lives in `lib/whatsapp/checkin-templates.ts`.

### 3. Inbound WhatsApp (patient)

Twilio POSTs to `/api/webhooks/whatsapp`. The route verifies the Twilio signature, returns `200`
immediately, and does the work inside Next's `after()` so Vercel keeps the function alive.

```mermaid
flowchart TD
  M[inbound message] --> S{conversation state<br/>lib/whatsapp/fsm.ts}
  S -->|awaiting_appointment_confirm| AP[confirm / start reschedule]
  S -->|awaiting_checkin_meds| Q1{1 · 2 · 3 ?}
  Q1 -->|all · some| L[log reminder_response<br/>adherence ✓ · some → alert: low]
  Q1 -->|none| N[alert: missed_medication medium]
  L --> Q2ask[ask Q2: how are you feeling?]
  N --> Q2ask
  Q1 -->|free text instead| T2[text triage]
  S -->|awaiting_checkin_symptoms| Q2{OK / fine?}
  Q2 -->|yes| GN[good night, no alert]
  Q2 -->|symptoms in own words| T2
  T2 -->|classifyRisk vs own warning signs| TR[triage_assessments<br/>yellow → alert medium · red → alert critical + urgent reply]
  S -->|idle / anything else| P{pre-intent<br/>lib/ai/intent.ts}
  P -->|emergency keyword| E[instant emergency reply<br/>alert: critical]
  P -->|acknowledgement / greeting| I[instant localised reply<br/>no alert]
  P -->|unknown| G[Gemini bounded Q&A<br/>lib/ai/chat.ts]
  G -->|question_in_scope| A1[answer from discharge plan]
  G -->|question_out_of_scope| A2[deflect + alert: low]
  G -->|concern| A3[empathise + alert: medium<br/>high if it matches a listed warning sign]
  G -->|acknowledgement / social| A4[reply, no alert]
```

Escalation is **derived in code** from the classified intent (`deriveEscalation()`), never left to
the model's discretion: a thank-you cannot page a nurse, a symptom report always does.

Voice notes: `triageVoiceNote()` transcribes with Whisper and grades the transcript against the
patient's own emergency symptoms. Text symptom reports use the same `classifyRisk()`. Both land in
`recordTriage()` (webhook handler): a `triage_assessments` row — DB triggers from 00003 then raise
the yellow/red alert (assigned to the nurse) and bump the episode's `current_risk_level` — plus a
localised reply telling the patient what to do and a `triage_completed` timeline event. If the
model is unavailable the report is still acknowledged and escalated at medium — a symptom report
is never dropped.

Every outbound message — from any path — goes through `lib/whatsapp/outbound.ts` `sendAndLog()`,
which sends via Twilio and records the exact delivered text on the conversation. The episode page's
**Conversation** tab renders this transcript live.

**One number, several patients.** One hospital number serves every patient, and a patient's own
number is not unique either: a family shares a phone, a daughter writes for both parents, a tester
registers three demo patients on their own number. Every open episode behind the sender's number
is a candidate (`findOpenEpisodesByPhone()`), each patient keeps their own conversation, state and
transcript, and `lib/whatsapp/routing.ts` decides which one a message belongs to — first match wins:

| Rule | Example |
|---|---|
| One open episode behind the number | everything below is skipped — the usual case |
| A "who is this about?" question is pending | `2`, `Umar`, `it's for Farzana`, `2: can she eat rice?` |
| The message starts with a patient's name | `Umar: can I walk today?`, `for Farzana – she is dizzy` |
| `switch` | lists the patients again |
| The remembered patient is mid-dialogue | a check-in question is waiting on their conversation |
| Exactly one conversation is waiting for a reply | `1` answers that check-in |
| The patient written about in the last 24 h | a follow-up `thanks` |
| An emergency keyword | goes to the likeliest patient at once — never held |
| Otherwise | the assistant asks, holds the message, and replays it once answered |

The per-number memory (`whatsapp_number_sessions`, migration 00011) holds the remembered patient
and any pending question with the held message. The question is logged on every linked transcript;
inbound rows on a shared number carry `metadata.routing = { via, linked_patients }` and the
Conversation tab shows a "Shared number" notice plus how each message was matched. Intake warns
when a number is already on another open episode. Table-tested in `scripts/check-routing.ts` and
end to end in `scripts/check-webhook.ts` (in-memory Supabase, captured Twilio).

Two more things the handler does for many senders on one number: a redelivered Twilio message
(retry, double-tap) is handled once — the UNIQUE `wa_message_id` insert is the claim — and messages
from the same sender are handled in order, one at a time, while different senders run side by side
(`lib/whatsapp/sender-queue.ts`).

**Nurse chat.** Clinical staff can write to the patient from that tab (`POST /api/v1/episodes/[id]/messages`).
The message is sent as the nurse (logged with `metadata.sender = 'nurse'`, shown in a solid bubble
with their name) and the conversation enters `nurse_attending` for 30 minutes: patient replies are
logged and streamed to the dashboard but the assistant does not answer over the nurse. Emergency
keywords still escalate instantly and voice notes are still triaged. "Hand back to assistant"
(`PATCH { attending: false }`) or the 30-minute expiry returns the conversation to `idle`; the
nightly check-in also takes over when it fires.

### 4. Appointments

**From the letter, automatically.** Every dated follow-up in a discharge summary ("Cardiology
clinic by 3 Oct") becomes a provisional appointment the moment the document is read
(`lib/appointments/sync-follow-ups.ts`, called from `persistExtraction()` and from the review
PATCH): `time_tbc = true`, `scheduled_at` = the "by" date at 09:00 hospital-local, linked through
`appointments.follow_up_id`. The Appointments screen shows these as "Due by … · time to confirm"
with the letter's instructions; booking a real time (appointment PATCH) clears the flag. Follow-ups
without a timeframe are listed under "Needs a date" until the nurse adds one on the review page.
Edits in review re-sync: untouched provisional rows move or disappear with their follow-up; anything
a nurse has booked, confirmed or cancelled is left alone.

`/api/v1/episodes/[id]/appointments/[appointmentId]/send-confirmation` asks the patient "Can you
attend?" and puts the conversation in `awaiting_appointment_confirm`. YES confirms; NO starts the
reschedule flow (`awaiting_slot_selection`, slots from `appointment_slots_cache`). The daily
`escalate` job raises an `unconfirmed_appointment` alert after 48h and marks past-due, unconfirmed
appointments as missed. The scheduling adapter is currently `manual` — no hospital PAS integration yet.

### 5. Dashboard

| Route | Purpose |
|---|---|
| `/` | Overview: KPIs, recent alerts, live alert banner |
| `/patients`, `/patients/[id]` | Patient list and profile |
| `/episodes/new`, `/episodes/[id]`, `/episodes/[id]/review` | Document-first intake (drop PDF → pre-filled form), episode detail (Summary · Conversation · Timeline · Triage · AI Chat), review/approve |
| `/appointments` | Appointment status across the hospital |
| `/alerts` | Open / acknowledged / resolved alerts, realtime |
| `/analytics` | Compliance trend, risk distribution, alert activity, appointment funnel |
| `/settings` | Hospital settings |

Realtime (`postgres_changes`) is enabled for `alerts`, `patient_timeline_events` and `whatsapp_messages`.

Theme: light / dark / system toggle in the header (and on the login page), persisted by `next-themes`.
All colours are semantic tokens in `src/app/globals.css` (`brand`, `teal`, `success|warning|danger|info` with
`-soft` and `-foreground` variants, `chart-1…5`, `sidebar-*`) — components never use raw hex or palette classes.

---

## Repository layout

```
src/
  app/
    (auth)/login                     Supabase email/password login
    (dashboard)/…                    pages above
    api/v1/…                         session-authenticated JSON API (patients, episodes, summaries, appointments, alerts, analytics)
    api/cron/…                       reminders/generate, reminders/dispatch, appointments/escalate  (CRON_SECRET bearer)
    api/webhooks/whatsapp            Twilio inbound webhook
  proxy.ts                           auth gate (Next 16 "proxy", formerly middleware) — see publicPaths
  lib/
    ai/        extraction.ts  translation.ts  chat.ts (Q&A + deriveEscalation)  intent.ts (pre-classifier)  triage.ts  guardrails.ts
    whatsapp/  client.ts (Twilio)  outbound.ts (sendAndLog)  fsm.ts  webhook-handler.ts  templates.ts
               recipient.ts (who is behind a number)  routing.ts (which patient a message is about)  shared-number.ts
               number-session.ts  inbound-log.ts (dedupe by SID)  sender-queue.ts (in-order per sender)  routing-templates.ts
    reminders/ generator.ts  dispatcher.ts
    supabase/  server.ts (user + service clients)  client.ts (browser)  middleware.ts (session refresh + public paths)
    auth/      session.ts  permissions.ts
  components/  alerts/  analytics/  appointments/  episodes/  patients/ (timeline, transcript, adherence)  ui/ (shadcn)
  types/       database.ts  enums.ts  api.ts
supabase/
  migrations/  00001 … 00011 (see Database)
  seed.sql     demo hospital, department, approved guidance
  demo_seed.sql evergreen demo dataset (5 patients; all dates relative to today)
scripts/
  check-intent.ts   table-driven checks for intent / escalation / FSM
```

---

## Local development

```bash
git clone https://github.com/FuadAhamed91/-DischargeIQ.git DischargeIQ
cd DischargeIQ
npm install
cp .env.example .env.local     # then fill it in — see below
npm run dev                    # http://localhost:3000
```

### Environment variables

Documented in [`.env.example`](./.env.example). Summary:

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public; inlined into the client bundle at build time |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only — cron routes, webhook, extraction |
| `NEXT_PUBLIC_APP_URL` | Public base URL. **Twilio's webhook URL must be exactly `<this>/api/webhooks/whatsapp`** — the signature check reconstructs it |
| `CRON_SECRET` | Bearer token for `/api/cron/*`. Must match the Vault value used by pg_cron (see [Deployment](#deployment)) |
| `GEMINI_API_KEY` | Extraction, translation, Q&A, triage |
| `OPENAI_API_KEY` | Optional. Whisper fallback if Gemini transcription fails; not set in production since 2026-09-19 |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` | Sandbox sender is `whatsapp:+14155238886` |
| `WHATSAPP_USE_TEXT_FALLBACK` | `true` on the sandbox: interactive buttons are rendered as numbered text options |

The dashboard works with only the Supabase variables; AI and Twilio keys are needed when you
upload a PDF, send messages, or transcribe voice notes.

### Pointing the local app at a database

Local dev usually points at the shared Supabase project (there is no local Supabase stack in use).
Be aware that cron routes hit from `localhost` operate on that database.

### Receiving WhatsApp locally

Twilio can only call a public URL. Either test inbound against the deployed app (the default), or
expose your dev server with a tunnel and temporarily set both `NEXT_PUBLIC_APP_URL` and the Twilio
sandbox webhook to the tunnel URL. In development the signature check logs a warning instead of
rejecting.

Cron routes can be triggered by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders/generate
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/reminders/dispatch
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/appointments/escalate
```

---

## Database

### Migrations (`supabase/migrations/`)

| # | Name | What it does |
|---|---|---|
| 00001 | `initial_schema` | Enums, 26 tables, indexes, `updated_at` triggers |
| 00002 | `rls_policies` | RLS on every table; helper functions `get_my_hospital_id()`, `is_clinical()` … |
| 00003 | `functions_triggers` | Conversation-on-activation, triage → risk level → alert → timeline, `compute_compliance_snapshot()` |
| 00004 | `storage_and_realtime` | Private `discharge-documents` bucket (PDF, 20 MB) with **hospital-scoped** object policies; realtime for `alerts`, `patient_timeline_events` |
| 00005 | `harden_functions` | Revoke `anon`/`authenticated` EXECUTE on SECURITY DEFINER functions (helpers stay callable by `authenticated`); fixed `search_path` |
| 00006 | `reminder_jobs_unique` | Unique `(schedule_id, fire_at)` — required by the generator's `ON CONFLICT` |
| 00007 | `pg_cron_dispatch` | `pg_cron` + `pg_net`; `configure_cron_dispatch(url, secret)` (service_role only) writes Vault; job `dispatch-reminders-every-5-min` |
| 00008 | `realtime_whatsapp_messages` | Realtime for the conversation transcript |
| 00009 | `nightly_checkin` | `alert_type += missed_medication`; retires per-dose `medication` schedules (+ cancels their pending jobs); one `symptom_check` / `nightly_checkin_v1` schedule at the hospital's check-in time per active episode |
| 00010 | `follow_up_appointments` | `appointments.time_tbc`; backfills provisional appointments for dated follow-ups on open episodes and links existing appointments to their follow-up |
| 00011 | `whatsapp_number_sessions` | Per (hospital, sender number): the patient a shared number is currently writing about and any pending "who is this about?" question with its held message; hospital-scoped SELECT |

Applying to a project:

```bash
supabase link --project-ref <ref>
supabase db push                     # applies any migration not yet in supabase_migrations.schema_migrations
```

The production project's history is recorded with these exact versions (`00001`–`00008`), so
`db push` is safe there. Migrations applied through other tools should be re-keyed to the file's
version in `supabase_migrations.schema_migrations` to keep this true.

### Seeds

- `seed.sql` — the demo hospital (`Dubai General Hospital`, id `00000000-…-0001`), a department, and
  two hospital-approved guidance entries. Idempotent.
- `demo_seed.sql` — five demo patients with summaries, medications, appointments, alerts, triage,
  reminders, timeline and 14 days of compliance data. **All dates are relative to `now()`**, so the
  demo is always current. Idempotent for keyed rows (`ON CONFLICT DO NOTHING`).

To refresh the demo dataset (e.g. before a demo):

```sql
delete from patients where id in (
  '10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004',
  '10000000-0000-0000-0000-000000000005');   -- cascades through every dependent table
-- then run the full contents of supabase/demo_seed.sql
```

Staff logins are not seeded: create the auth user in Supabase → Authentication, then insert a
`profiles` row with the same id, a `hospital_id` and a role. (There is no invite flow yet.)

### Key tables

`hospitals` · `profiles` (extends `auth.users`) · `patients` · `care_episodes` (one active per
patient) · `discharge_documents` · `discharge_summaries` (+ `_translations`, `medications`,
`follow_up_requirements`) · `appointments` · `reminder_schedules` → `reminder_jobs` ·
`whatsapp_conversations` (FSM state) → `whatsapp_messages` · `triage_assessments` · `alerts` ·
`ai_interactions` · `patient_timeline_events` · `compliance_snapshots` · `analytics_daily` ·
`hospital_approved_guidance` · `audit_logs`.

`hospitals.whatsapp_phone_number_id` must equal the Twilio sender number in E.164 **without** the
`whatsapp:` prefix (e.g. `+14155238886`); the webhook uses it to resolve the hospital from Twilio's `To`.

---

## Background jobs

| Job | Where | Schedule | Route |
|---|---|---|---|
| Generate next-day check-in jobs | Vercel Cron | `0 0 * * *` (00:00 UTC / 04:00 Dubai) | `/api/cron/reminders/generate` |
| Dispatch due check-ins | **pg_cron** (`dispatch-reminders-every-5-min`) | `*/5 * * * *` | `/api/cron/reminders/dispatch` |
| Escalate unconfirmed / mark missed appointments | Vercel Cron | `0 8 * * *` (08:00 UTC) | `/api/cron/appointments/escalate` |

Why the split: Vercel's Hobby plan only allows once-a-day crons, which delivered evening reminders
the next morning. `pg_cron` calls the dispatch route from inside the database every five minutes with
`pg_net`, reading the app URL and `CRON_SECRET` from **Supabase Vault** (`cron_base_url`,
`cron_secret`). The dispatcher does not atomically claim jobs, so exactly one scheduler must run it —
keep the Vercel dispatch cron removed.

All three routes accept `GET` (what Vercel and pg_net send) and `POST` (for manual triggering), are
listed as public in the auth proxy, and validate `Authorization: Bearer <CRON_SECRET>`.

---

## Deployment

**Vercel** deploys `main` automatically. Project env vars = the table above (Production + Preview).
`NEXT_PUBLIC_*` values are baked in at build time — after changing them, redeploy **without** the
build cache.

**Supabase** — one project per environment. New project checklist:

1. `supabase db push` (migrations 00001–00011), then `seed.sql` and, if wanted, `demo_seed.sql`.
2. Create staff auth users + `profiles` rows.
3. Set the hospital's `whatsapp_phone_number_id`.
4. Configure pg_cron dispatch (service role, via SQL editor or REST `rpc/configure_cron_dispatch`):
   ```sql
   select configure_cron_dispatch('https://<app-host>', '<CRON_SECRET>');
   ```
   Until both Vault entries exist the job runs but makes no HTTP call.

**Twilio** — Messaging → Try it out → Send a WhatsApp message → Sandbox settings →
"When a message comes in": `https://<app-host>/api/webhooks/whatsapp`, POST. Patients (and testers)
must join the sandbox from their phone (`join <keyword>` to +1 415 523 8886); sandbox opt-ins
**expire after 72 hours** of inactivity.

Any number of people can write to the one sandbox number at the same time — each is matched to
their own patient record by their phone number. On the sandbox the only per-person step is that
join; on a WhatsApp Business sender there is none. To try the shared-number flow with a single
phone, register two patients with your own number and message the sandbox: you are asked who the
message is about, then `Umar: …` / `Farzana: …` switch between them.

### Rotating `CRON_SECRET`

1. Generate: `python -c "import secrets; print(secrets.token_hex(32))"`
2. Vercel → Environment Variables → `CRON_SECRET` → edit (Production + Preview).
3. Supabase SQL editor: `select configure_cron_dispatch('https://<app-host>', '<new secret>');`
4. Redeploy on Vercel (the function reads env at deploy time).

---

## Operations runbook

**Is dispatch running?** (SQL editor)
```sql
select start_time, status, return_message from cron.job_run_details order by start_time desc limit 10;   -- '1 row' = HTTP call made
select created, status_code, left(content, 80) from net._http_response order by created desc limit 10;   -- expect 200 {"ok":true,...}
```
Vercel → Logs, filtered to `/api/cron/`, shows the route side (`sent=… failed=…`).

**A patient's reply wasn't handled** — check in order: Twilio Console → Monitor → Messaging (was the
webhook called, what did it return?), Vercel logs for `/api/webhooks/whatsapp` (`Invalid signature`
means the URL in Twilio ≠ `NEXT_PUBLIC_APP_URL`), then the episode's Conversation and Timeline tabs.

**Reminders failing to send** — `reminder_jobs.status = 'failed'` plus the Twilio error in the
transcript ("Not delivered"). Common causes: recipient not joined to the sandbox (63016), sandbox
session expired (63015), or missing Twilio env vars. Demo patients have fake numbers, so their daily
reminders are *expected* to fail while Twilio is configured.

**Supabase project paused** (free tier pauses after a week idle) — Dashboard → Resume. The 5-minute
pg_cron job normally keeps it active.

**Security advisor** — Supabase → Advisors → Security. Expected residual warnings: the six RLS helper
functions callable by `authenticated` (required — policies evaluate them as the caller) and the
"leaked password protection" toggle.

---

## Security model

- **RLS everywhere.** Policies are hospital-scoped via `get_my_hospital_id()`; nurses see only
  assigned patients, coordinators and above see the whole hospital. The service role (server-side
  only) bypasses RLS for cron, webhook and extraction work.
- **Functions.** SECURITY DEFINER functions are executable only by `service_role`, except the RLS
  helpers, which `authenticated` needs. `anon` can execute nothing. Fixed `search_path` on all.
- **Storage.** `discharge-documents` is private; object paths are `<hospital_id>/<episode_id>/<file>`
  and policies match the first path segment to the caller's hospital.
- **Auth proxy** (`src/proxy.ts`) redirects everything to `/login` except `/login`, `/invite`,
  `/api/webhooks` (Twilio signature), `/api/cron` (`CRON_SECRET`), `/api/v1/auth`.
- **Twilio** requests are HMAC-verified against the exact webhook URL.
- **Secrets** live in Vercel env vars and Supabase Vault; `.env*` is gitignored except `.env.example`.
- **AI guardrails.** The patient assistant answers only from the patient's own approved summary and
  hospital-approved guidance; it never diagnoses or changes medication. Emergency keywords bypass the
  model entirely.

---

## Testing

```bash
npm run lint           # eslint (a few pre-existing react/no-unescaped-entities warnings in JSX)
npx tsc --noEmit       # typecheck
npm run build          # production build (needs NEXT_PUBLIC_SUPABASE_* set; placeholders are fine)
npm run check          # all four below
npm run check:intent   # 85 table-driven checks: pre-intent classifier, escalation derivation, FSM (check-in, nurse chat), state parsing
npm run check:routing  # shared-number routing: name prefixes, answers to "who is this about?", the decision order, expiries
npm run check:webhook  # the inbound handler end to end against an in-memory Supabase and a captured Twilio (no keys, no network)
npm run check:gemini   # 11 checks on the Gemini wrapper: retry on 429/503/network, model fallback, 403 fails fast, budget respected
```

`scripts/lib/fake-supabase.ts` is the in-memory stand-in the webhook check runs on: enough of the
query builder (select / insert / upsert / update, embeds, UNIQUE → 23505) to exercise the real
handler. There is no browser end-to-end suite. The reference manual test is: create a patient with
a real sandbox-joined number → move their `reminder_schedules` row a few minutes ahead → trigger
`generate` → wait for the 5-minute tick → reply "1" then "OK" → confirm `reminder_response` on the
timeline and all four messages in the Conversation tab; then reply with a symptom in idle state and
check the alert. For the shared-number flow, register a second patient on the same number first.

---

## Known limitations

- **Twilio sandbox**, not a WhatsApp Business number: text only, per-number opt-in, 72-hour expiry.
- **Free tiers**: Supabase (auto-pause) and Vercel Hobby (daily crons; dispatch runs from pg_cron instead).
- **Scheduling adapter is `manual`** — reschedule slots are not pulled from a hospital system.
- **No staff invite/onboarding flow** (`/invite` is reserved in the proxy but not built).
- `compute_compliance_snapshot()` exists but is not yet scheduled; adherence figures come from
  `reminder_response` events directly.
- Voice-note triage is implemented but has not been exercised against a live Twilio media URL recently.
- Instant replies (acknowledgement/greeting/emergency) are localised for the five supported languages;
  other short templates are English-only under the sandbox text fallback.
