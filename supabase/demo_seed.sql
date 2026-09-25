-- ============================================================
-- CareLoop — Demo Seed Data
-- Run this in Supabase SQL Editor to populate the demo.
-- Assumes hospital ID 00000000-0000-0000-0000-000000000001 exists.
--
-- All dates are relative to now() so the demo stays evergreen: discharges
-- and activity sit in the recent past, follow-ups and appointments in the
-- near future. Appointment times are Dubai local (Asia/Dubai).
-- ============================================================

-- ── PATIENTS ──────────────────────────────────────────────────────────

INSERT INTO patients (id, hospital_id, mrn, full_name, phone_e164, preferred_language, date_of_birth)
VALUES
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'DGH-2024-001', 'Mohammed Al Rashidi',   '+971501234001', 'ar', '1968-03-14'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'DGH-2024-002', 'Priya Krishnamurthy',  '+971502234002', 'hi', '1975-07-22'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'DGH-2024-003', 'David Thompson',       '+971503234003', 'en', '1952-11-05'),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'DGH-2024-004', 'Maria Santos',         '+971504234004', 'tl', '1983-01-30'),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'DGH-2024-005', 'Fatima Al Mansoori',   '+971505234005', 'ar', '1991-09-18')
ON CONFLICT (id) DO NOTHING;

-- ── CARE EPISODES ─────────────────────────────────────────────────────

INSERT INTO care_episodes (id, hospital_id, patient_id, status, discharge_date, current_risk_level, compliance_score, started_at)
VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'active',    current_date - 8,  'yellow', 72.0,  now() - interval '8 days'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'active',    current_date - 5,  'green',  88.5,  now() - interval '5 days'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'active',    current_date - 10, 'red',    51.0,  now() - interval '10 days'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'active',    current_date - 3,  'green',  94.0,  now() - interval '3 days'),
  ('20000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'completed', current_date - 20, 'green',  91.0,  now() - interval '20 days')
ON CONFLICT (id) DO NOTHING;

-- ── DISCHARGE SUMMARIES ───────────────────────────────────────────────

INSERT INTO discharge_summaries (id, episode_id, hospital_id, status, source_language, approved_at,
  emergency_symptoms, lifestyle_instructions, restrictions, activities)
VALUES
  -- Mohammed — Cardiac (YELLOW risk)
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'sent', 'en', now() - interval '7 days',
   '["Chest pain or tightness", "Shortness of breath at rest", "Swelling in legs or feet", "Irregular heartbeat", "Dizziness or fainting"]',
   '["Rest for the first 48 hours", "Take all medications as prescribed", "Weigh yourself daily — alert us if you gain 2kg in 2 days", "Follow low-sodium diet", "No heavy lifting for 6 weeks"]',
   '["No strenuous exercise for 6 weeks", "No driving for 4 weeks", "Limit salt intake to less than 2g per day", "No alcohol"]',
   '["Short walks of 5-10 minutes, 3 times a day", "Gradually increase walking distance each week"]'),

  -- Priya — Diabetes management (GREEN risk)
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'sent', 'en', now() - interval '4 days',
   '["Blood sugar below 4.0 mmol/L (hypoglycaemia)", "Blood sugar above 15 mmol/L", "Severe headache", "Confusion or disorientation", "Blurred vision that does not clear"]',
   '["Check blood sugar before each meal and at bedtime", "Take insulin as instructed", "Eat at regular meal times", "Carry glucose tablets at all times", "Keep feet clean and dry — check daily for cuts or sores"]',
   '["No skipping meals", "Avoid sugary drinks", "No barefoot walking"]',
   '["30 minutes of light walking daily", "Gentle yoga or stretching"]'),

  -- David — Hip replacement (RED risk)
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'sent', 'en', now() - interval '9 days',
   '["Severe pain not controlled by medication", "Redness, warmth, or swelling at surgical site", "Wound discharge or opening", "Fever above 38.5°C", "Sudden chest pain or difficulty breathing (sign of blood clot)"]',
   '["Keep the wound dry for 2 weeks", "Use crutches as instructed", "Take blood thinner as prescribed — do not skip", "Attend physiotherapy appointments", "Sleep with pillow between knees"]',
   '["No crossing legs", "Do not bend hip beyond 90 degrees", "No driving for 6 weeks", "No baths until wound heals"]',
   '["Physiotherapy exercises as directed", "Gentle knee lifts and ankle circles in bed"]'),

  -- Maria — C-section recovery (GREEN risk)
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001',
   'sent', 'en', now() - interval '2 days',
   '["Heavy bleeding (soaking more than one pad per hour)", "Signs of wound infection: redness, swelling, pus", "Fever above 38°C", "Severe abdominal pain", "Difficulty breathing"]',
   '["Rest as much as possible — let others help", "Breastfeed every 2-3 hours", "Keep wound clean and dry", "Take iron supplements and vitamins as prescribed", "Stay well hydrated"]',
   '["No heavy lifting for 6 weeks", "No driving for 6 weeks", "No strenuous exercise"]',
   '["Short walks around the house", "Pelvic floor exercises when comfortable"]')
ON CONFLICT (id) DO NOTHING;

-- ── MEDICATIONS ──────────────────────────────────────────────────────

INSERT INTO medications (id, summary_id, hospital_id, name, dosage, frequency, instructions, reminder_times, sort_order)
VALUES
  -- Mohammed (cardiac)
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Bisoprolol', '5mg', 'Once daily', 'Take in the morning with water', '{08:00}', 1),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Furosemide', '40mg', 'Once daily', 'Take in the morning — may cause frequent urination', '{08:00}', 2),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Aspirin', '100mg', 'Once daily', 'Take with food', '{13:00}', 3),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Atorvastatin', '40mg', 'Once at night', 'Take at bedtime', '{22:00}', 4),

  -- Priya (diabetes)
  ('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Metformin', '500mg', 'Twice daily', 'Take with meals to reduce stomach upset', '{08:00, 20:00}', 1),
  ('40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Insulin Glargine', '20 units', 'Once at bedtime', 'Inject subcutaneously — rotate injection sites', '{22:00}', 2),

  -- David (hip replacement)
  ('40000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'Rivaroxaban', '10mg', 'Once daily', 'Take with evening meal — blood thinner, do not skip', '{20:00}', 1),
  ('40000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'Paracetamol', '1g', 'Four times daily', 'Take regularly for pain control — do not exceed 4g per day', '{08:00, 12:00, 18:00, 22:00}', 2),
  ('40000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'Omeprazole', '20mg', 'Once daily', 'Take 30 minutes before breakfast — protects stomach', '{07:30}', 3),

  -- Maria (C-section)
  ('40000000-0000-0000-0000-000000000010', '30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001',
   'Ibuprofen', '400mg', 'Three times daily', 'Take with food — for pain relief', '{08:00, 14:00, 20:00}', 1),
  ('40000000-0000-0000-0000-000000000011', '30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001',
   'Ferrous Sulphate', '200mg', 'Once daily', 'Take on an empty stomach — iron supplement', '{10:00}', 2)
ON CONFLICT (id) DO NOTHING;

-- ── FOLLOW-UP REQUIREMENTS ────────────────────────────────────────────

INSERT INTO follow_up_requirements (id, summary_id, hospital_id, specialty, deadline, instructions)
VALUES
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Cardiology', current_date + 20, 'ECG and echo review — bring all current medications'),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Endocrinology', current_date + 30, 'HbA1c blood test and insulin dosage review'),
  ('50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'Orthopaedics', current_date + 10, 'Wound check and X-ray — bring walking aid'),
  ('50000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'Physiotherapy', current_date + 5, 'First physiotherapy session — wear comfortable clothing'),
  ('50000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001',
   'Obstetrics', current_date + 15, '6-week postpartum check — bring baby for newborn review')
ON CONFLICT (id) DO NOTHING;

-- ── APPOINTMENTS ──────────────────────────────────────────────────────
-- scheduled_at = (day offset from today) + clinic time, interpreted as Asia/Dubai.
-- The missed physiotherapy slot sits 3 days back to line up with David's missed-appointment alert.

INSERT INTO appointments (id, episode_id, hospital_id, specialty, scheduled_at, location, status, confirmed_at)
VALUES
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'Cardiology', ((current_date + 20) + time '10:00') AT TIME ZONE 'Asia/Dubai', 'Cardiology Clinic, Floor 3', 'confirmed', now() - interval '5 days'),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'Endocrinology', ((current_date + 30) + time '09:00') AT TIME ZONE 'Asia/Dubai', 'Diabetes Centre, Ground Floor', 'confirmation_pending', null),
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'Orthopaedics', ((current_date + 10) + time '11:30') AT TIME ZONE 'Asia/Dubai', 'Orthopaedic Clinic, Floor 2', 'confirmation_pending', null),
  ('60000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'Physiotherapy', ((current_date - 3) + time '08:00') AT TIME ZONE 'Asia/Dubai', 'Physiotherapy Department, Floor 1', 'missed', null),
  ('60000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001',
   'Obstetrics', ((current_date + 15) + time '10:00') AT TIME ZONE 'Asia/Dubai', 'Women''s Health Clinic, Floor 4', 'confirmed', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ── ALERTS ────────────────────────────────────────────────────────────

INSERT INTO alerts (id, episode_id, hospital_id, type, severity, status, created_at)
VALUES
  -- David RED triage alert (critical)
  ('70000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'risk_red', 'critical', 'open', now() - interval '2 hours'),
  -- Mohammed YELLOW (medium)
  ('70000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'risk_yellow', 'medium', 'open', now() - interval '1 day'),
  -- David missed appointment
  ('70000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'missed_appointment', 'high', 'acknowledged', now() - interval '3 days'),
  -- Priya escalation (already resolved)
  ('70000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'escalation', 'low', 'resolved', now() - interval '4 days')
ON CONFLICT (id) DO NOTHING;

-- ── TRIAGE ASSESSMENTS ───────────────────────────────────────────────

INSERT INTO triage_assessments (id, episode_id, hospital_id, inbound_text, risk_level, matched_symptoms, reasoning, model_version, created_at)
VALUES
  -- David RED
  ('80000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'I have been having severe pain in my chest and I am finding it very hard to breathe. My leg is very swollen.',
   'red',
   '["Sudden chest pain", "Difficulty breathing", "Swelling in leg"]',
   'Patient reports severe chest pain, difficulty breathing, and leg swelling — all matching emergency warning signs for post-surgical blood clot (DVT/PE). Immediate medical attention required.',
   'gemini-2.5-flash', now() - interval '2 hours'),

  -- Mohammed YELLOW
  ('80000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'I feel a little bit of palpitations and my feet are slightly more swollen than yesterday.',
   'yellow',
   '["Irregular heartbeat", "Swelling in feet"]',
   'Patient reports mild palpitations and increased foot swelling — concerning but not immediately critical. Monitoring required.',
   'gemini-2.5-flash', now() - interval '1 day'),

  -- Mohammed GREEN (earlier)
  ('80000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'I feel okay today, just a little tired after the walk.',
   'green',
   '[]',
   'Patient reports mild fatigue after exercise — expected post-cardiac recovery. No emergency symptoms identified.',
   'gemini-2.5-flash', now() - interval '5 days'),

  -- Priya GREEN
  ('80000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'My blood sugar was 6.2 before dinner, feeling fine.',
   'green',
   '[]',
   'Patient reports normal blood sugar level and no symptoms. Stable condition.',
   'gemini-2.5-flash', now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

-- ── AI INTERACTIONS ───────────────────────────────────────────────────

INSERT INTO ai_interactions (id, episode_id, hospital_id, input_type, input_text, output_text, confidence, escalated, model, created_at)
VALUES
  ('90000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001',
   'text',
   'Can I take my Metformin after dinner instead of with dinner?',
   'It is best to take Metformin with your meals as prescribed to reduce the chance of stomach upset. If you prefer to take it slightly after starting your meal rather than at the very beginning, that is generally fine. However, please try to keep it close to meal times. 😊',
   0.9, false, 'gemini-2.5-flash', now() - interval '3 days'),

  ('90000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'text',
   'I forgot to take my Aspirin this morning, what should I do?',
   'According to your discharge instructions: if you missed a dose, take it as soon as you remember. However, if it is almost time for your next dose, skip the missed one — do not take a double dose. If you are unsure, please contact your care team. 💙',
   0.85, false, 'gemini-2.5-flash', now() - interval '6 days'),

  ('90000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'text',
   'Can I start driving again? I need to go to the pharmacy.',
   'Based on your discharge summary, driving is not permitted for 4 weeks after your procedure. Your care team will need to clear you before you can drive again. Please ask a family member or friend to help, or consider a taxi or delivery service for now. 🙏',
   0.92, false, 'gemini-2.5-flash', now() - interval '4 days'),

  ('90000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001',
   'text',
   'The wound is looking a bit red around the edges, is that normal?',
   'I''m sorry to hear that. Redness around the surgical wound is listed as one of your emergency warning signs. This could be a sign of infection. Please contact your care team immediately or go to the nearest emergency department. Do not wait. 🚨',
   0.88, true, 'gemini-2.5-flash', now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

-- ── REMINDER SCHEDULES ─────────────────────────────────────────────────

-- One nightly check-in (21:00 hospital-local) per active episode. Per-dose
-- medication reminders were retired in 00009; dose times live on medications
-- as instructions only.
INSERT INTO reminder_schedules (id, episode_id, hospital_id, type, scheduled_time, medication_id, message_template_key, is_active)
VALUES
  ('A0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'symptom_check', '21:00', null, 'nightly_checkin_v1', true),
  ('A0000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'symptom_check', '21:00', null, 'nightly_checkin_v1', true),
  ('A0000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'symptom_check', '21:00', null, 'nightly_checkin_v1', true),
  ('A0000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'symptom_check', '21:00', null, 'nightly_checkin_v1', true)
ON CONFLICT (id) DO NOTHING;

-- ── REMINDER JOBS (last 7 days of nightly check-ins — mix of sent and failed) ──

INSERT INTO reminder_jobs (id, schedule_id, episode_id, hospital_id, fire_at, status)
VALUES
  -- Mohammed check-ins (mostly sent/responded)
  ('B0000000-0000-0000-0000-000000000001', 'A0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', now() - interval '7 days 16 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000002', 'A0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', now() - interval '6 days 16 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000003', 'A0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', now() - interval '5 days 16 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000004', 'A0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', now() - interval '4 days 16 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000005', 'A0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', now() - interval '3 days 16 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000006', 'A0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', now() - interval '2 days 16 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000007', 'A0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', now() - interval '1 day 16 hours', 'sent'),
  -- Priya check-ins (high adherence)
  ('B0000000-0000-0000-0000-000000000008', 'A0000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', now() - interval '5 days 16 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000009', 'A0000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', now() - interval '4 days 16 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000010', 'A0000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', now() - interval '3 days 16 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000011', 'A0000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', now() - interval '2 days 16 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000012', 'A0000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', now() - interval '1 day 16 hours', 'sent'),
  -- David check-ins (some failed — lower compliance)
  ('B0000000-0000-0000-0000-000000000013', 'A0000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', now() - interval '10 days 4 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000014', 'A0000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', now() - interval '9 days 4 hours', 'failed'),
  ('B0000000-0000-0000-0000-000000000015', 'A0000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', now() - interval '8 days 4 hours', 'sent'),
  ('B0000000-0000-0000-0000-000000000016', 'A0000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', now() - interval '7 days 4 hours', 'failed')
ON CONFLICT (id) DO NOTHING;

-- ── PATIENT TIMELINE EVENTS ────────────────────────────────────────────

INSERT INTO patient_timeline_events (episode_id, hospital_id, event_type, payload, risk_level, created_at)
VALUES
  -- Mohammed
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'discharge_uploaded', '{"filename": "discharge_summary_cardiac.pdf"}', null, now() - interval '8 days'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'extraction_completed', '{"medications_found": 4, "symptoms_found": 5}', null, now() - interval '8 days' + interval '5 minutes'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'summary_approved', '{}', null, now() - interval '7 days'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'summary_sent', '{}', null, now() - interval '7 days' + interval '10 minutes'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'reminder_response', '{"response": "yes", "medication": "Bisoprolol"}', null, now() - interval '6 days'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'reminder_response', '{"response": "yes", "medication": "Bisoprolol"}', null, now() - interval '5 days'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'triage_completed', '{"risk_level": "green", "transcript": "I feel okay today, just a little tired after the walk."}', 'green', now() - interval '5 days'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'ai_response', '{"question": "I forgot to take my Aspirin this morning, what should I do?"}', null, now() - interval '4 days'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'reminder_response', '{"response": "yes", "medication": "Bisoprolol"}', null, now() - interval '4 days'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'reminder_response', '{"response": "yes", "medication": "Bisoprolol"}', null, now() - interval '3 days'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'triage_completed', '{"risk_level": "yellow", "transcript": "I feel a little bit of palpitations and my feet are slightly more swollen than yesterday."}', 'yellow', now() - interval '1 day'),

  -- Priya
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'discharge_uploaded', '{"filename": "diabetes_discharge.pdf"}', null, now() - interval '5 days'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'extraction_completed', '{"medications_found": 2, "symptoms_found": 5}', null, now() - interval '5 days' + interval '3 minutes'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'summary_approved', '{}', null, now() - interval '4 days'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'summary_sent', '{}', null, now() - interval '4 days' + interval '8 minutes'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'reminder_response', '{"response": "yes", "medication": "Metformin"}', null, now() - interval '4 days'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'ai_response', '{"question": "Can I take my Metformin after dinner instead of with dinner?"}', null, now() - interval '3 days'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'reminder_response', '{"response": "yes", "medication": "Metformin"}', null, now() - interval '3 days'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'reminder_response', '{"response": "yes", "medication": "Metformin"}', null, now() - interval '2 days'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'triage_completed', '{"risk_level": "green", "transcript": "My blood sugar was 6.2 before dinner, feeling fine."}', 'green', now() - interval '2 days'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'reminder_response', '{"response": "yes", "medication": "Metformin"}', null, now() - interval '1 day'),

  -- David
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'discharge_uploaded', '{"filename": "hip_replacement_discharge.pdf"}', null, now() - interval '10 days'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'extraction_completed', '{"medications_found": 3, "symptoms_found": 5}', null, now() - interval '10 days' + interval '4 minutes'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'summary_approved', '{}', null, now() - interval '9 days'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'summary_sent', '{}', null, now() - interval '9 days' + interval '6 minutes'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'reminder_response', '{"response": "yes", "medication": "Rivaroxaban"}', null, now() - interval '8 days'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'ai_response', '{"question": "The wound is looking a bit red around the edges, is that normal?"}', null, now() - interval '1 day'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'triage_completed', '{"risk_level": "red", "transcript": "I have been having severe pain in my chest and I am finding it very hard to breathe. My leg is very swollen."}', 'red', now() - interval '2 hours'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'escalation_created', '{"reason": "RED triage — blood clot symptoms"}', 'red', now() - interval '2 hours'),

  -- Maria
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'discharge_uploaded', '{"filename": "csection_discharge.pdf"}', null, now() - interval '3 days'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'extraction_completed', '{"medications_found": 2, "symptoms_found": 5}', null, now() - interval '3 days' + interval '2 minutes'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'summary_approved', '{}', null, now() - interval '2 days'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'summary_sent', '{}', null, now() - interval '2 days' + interval '5 minutes'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'appointment_confirmed', jsonb_build_object('specialty', 'Obstetrics', 'scheduled_at', ((current_date + 15) + time '10:00') AT TIME ZONE 'Asia/Dubai'), null, now() - interval '1 day'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'reminder_response', '{"response": "yes", "medication": "Ibuprofen"}', null, now() - interval '1 day');

-- ── COMPLIANCE SNAPSHOTS (14 days of trending data) ────────────────────

INSERT INTO compliance_snapshots (episode_id, hospital_id, snapshot_date, medication_adherence, reminder_response_rate, symptom_checks_completed)
VALUES
  -- Mohammed (declining slightly then stable)
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', current_date - 13, 85, 80, 1),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', current_date - 12, 80, 75, 1),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', current_date - 11, 78, 72, 2),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', current_date - 10, 75, 70, 1),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', current_date - 9,  72, 68, 2),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', current_date - 8,  74, 70, 1),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', current_date - 7,  72, 72, 2),

  -- Priya (high and improving)
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', current_date - 4,  88, 85, 1),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', current_date - 3,  90, 88, 2),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', current_date - 2,  92, 90, 1),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', current_date - 1,  94, 92, 2),

  -- David (low compliance)
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', current_date - 9,  62, 58, 1),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', current_date - 8,  55, 50, 0),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', current_date - 7,  50, 48, 1),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', current_date - 6,  52, 50, 0),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', current_date - 5,  48, 45, 2),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', current_date - 4,  50, 48, 1),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', current_date - 3,  51, 50, 1),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', current_date - 2,  49, 46, 0),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', current_date - 1,  51, 50, 2)
ON CONFLICT (episode_id, snapshot_date) DO NOTHING;

-- ── WHATSAPP CONVERSATIONS ─────────────────────────────────────────────

INSERT INTO whatsapp_conversations (episode_id, hospital_id, patient_id, wa_phone, last_message_at, conversation_state)
VALUES
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '+971501234001', now() - interval '1 day', '{"state": "idle"}'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '+971502234002', now() - interval '1 day', '{"state": "idle"}'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '+971503234003', now() - interval '2 hours',  '{"state": "idle"}'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', '+971504234004', now() - interval '1 day', '{"state": "idle"}')
ON CONFLICT (episode_id) DO NOTHING;

-- ── SHARED NUMBER (a family phone) ─────────────────────────────────────
-- Aisha Rahman and her son Bilal were discharged a few days apart and both
-- use the household phone. Two patients, two episodes, two conversations,
-- one number: the transcript shows the assistant asking who a message is
-- about, the reply, and how each later message was matched
-- (whatsapp_messages.metadata.routing). See README → "One number, several patients".

INSERT INTO patients (id, hospital_id, mrn, full_name, phone_e164, preferred_language, date_of_birth)
VALUES
  ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'DGH-2024-006', 'Aisha Rahman', '+971506234006', 'en', '1961-05-02'),
  ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'DGH-2024-007', 'Bilal Rahman', '+971506234006', 'en', '1994-12-19')
ON CONFLICT (id) DO NOTHING;

INSERT INTO care_episodes (id, hospital_id, patient_id, status, discharge_date, current_risk_level, compliance_score, started_at)
VALUES
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', 'active', current_date - 6, 'green', 90.0, now() - interval '6 days'),
  ('20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 'active', current_date - 2, 'green', 100.0, now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO discharge_summaries (id, episode_id, hospital_id, status, source_language, approved_at,
  emergency_symptoms, lifestyle_instructions, restrictions, activities)
VALUES
  -- Aisha — knee replacement
  ('30000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001',
   'sent', 'en', now() - interval '5 days',
   '["Calf pain or swelling", "Sudden shortness of breath", "Wound redness, warmth or discharge", "Fever above 38.5°C"]',
   '["Keep the dressing dry", "Ice the knee 20 minutes, 3 times a day", "Take the blood thinner every evening"]',
   '["No kneeling", "No driving for 6 weeks"]',
   '["Physiotherapy exercises twice a day", "Walk with the frame indoors"]'),
  -- Bilal — appendicectomy
  ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001',
   'sent', 'en', now() - interval '1 day',
   '["Fever above 38°C", "Increasing abdominal pain", "Vomiting", "Wound redness or discharge"]',
   '["Small, light meals for a week", "Keep the wound clean and dry", "Complete the antibiotic course"]',
   '["No heavy lifting for 4 weeks", "No swimming until the wound has healed"]',
   '["Short walks from day one", "Back to desk work when comfortable"]')
ON CONFLICT (id) DO NOTHING;

INSERT INTO medications (id, summary_id, hospital_id, name, dosage, frequency, instructions, reminder_times, sort_order)
VALUES
  ('40000000-0000-0000-0000-000000000060', '30000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Rivaroxaban', '10 mg', 'Once daily', 'Every evening with food, for 14 days', '["20:00"]', 1),
  ('40000000-0000-0000-0000-000000000061', '30000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Paracetamol', '1 g', 'Up to 4 times daily', 'For pain, at least 4 hours apart', '["08:00", "14:00", "20:00"]', 2),
  ('40000000-0000-0000-0000-000000000070', '30000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'Co-amoxiclav', '625 mg', 'Three times daily', 'With meals, finish the course', '["08:00", "14:00", "20:00"]', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO reminder_schedules (id, episode_id, hospital_id, type, scheduled_time, medication_id, message_template_key, is_active)
VALUES
  ('A0000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'symptom_check', '21:00', null, 'nightly_checkin_v1', true),
  ('A0000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'symptom_check', '21:00', null, 'nightly_checkin_v1', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO whatsapp_conversations (id, episode_id, hospital_id, patient_id, wa_phone, last_message_at, conversation_state)
VALUES
  ('C0000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006', '+971506234006', now() - interval '3 hours', '{"state": "idle"}'),
  ('C0000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', '+971506234006', now() - interval '1 hour', '{"state": "idle"}')
ON CONFLICT (episode_id) DO NOTHING;

-- The question went to the number once and is logged on both transcripts (the handler stores the
-- SID on one copy and null on the other; the seed gives the copy a suffix so re-running stays idempotent).
INSERT INTO whatsapp_messages (conversation_id, hospital_id, direction, message_type, wa_message_id, content, status, metadata, created_at)
VALUES
  ('C0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'outbound', 'text', 'SM-demo-family-01',
   E'This WhatsApp number is linked to more than one patient.\nWho is this message about?\n\n1. Bilal Rahman\n2. Aisha Rahman\n\nReply with 1 or 2.\nYou can also start any message with a name, e.g. “Aisha: …”\nI will pass your message on as soon as you reply.',
   'sent', '{"kind": "routing_prompt", "options": ["Bilal Rahman", "Aisha Rahman"], "holding": true}', now() - interval '3 hours 10 minutes'),
  ('C0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'outbound', 'text', 'SM-demo-family-01b',
   E'This WhatsApp number is linked to more than one patient.\nWho is this message about?\n\n1. Bilal Rahman\n2. Aisha Rahman\n\nReply with 1 or 2.\nYou can also start any message with a name, e.g. “Aisha: …”\nI will pass your message on as soon as you reply.',
   'sent', '{"kind": "routing_prompt", "options": ["Bilal Rahman", "Aisha Rahman"], "holding": true}', now() - interval '3 hours 10 minutes'),
  -- Aisha's daughter answers "2", the held question replays for Aisha
  ('C0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'inbound', 'text', 'SM-demo-family-02', '2', 'delivered',
   '{"routing": {"via": "choice", "linked_patients": 2}, "answer": true, "sender_name": "Noor"}', now() - interval '3 hours 8 minutes'),
  ('C0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'inbound', 'text', 'SM-demo-family-03', 'Can mum take the paracetamol with the blood thinner?', 'delivered',
   '{"routing": {"via": "choice", "linked_patients": 2}, "sender_name": "Noor"}', now() - interval '3 hours 8 minutes'),
  ('C0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'outbound', 'text', 'SM-demo-family-04',
   'Yes — paracetamol can be taken alongside rivaroxaban as prescribed. Keep doses at least 4 hours apart and no more than 4 g of paracetamol a day. Let us know if the knee pain is getting worse rather than better.',
   'sent', '{}', now() - interval '3 hours 7 minutes'),
  -- Later, a message that names Bilal goes straight to him
  ('C0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'inbound', 'text', 'SM-demo-family-05', 'is a bit of tummy pain normal after the operation?', 'delivered',
   '{"routing": {"via": "name", "linked_patients": 2}, "sender_name": "Noor"}', now() - interval '1 hour'),
  ('C0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'outbound', 'text', 'SM-demo-family-06',
   'Some soreness around the wound is expected for the first week, Bilal. Pain that is increasing, a fever above 38°C or vomiting are not — contact the hospital straight away if any of those happen.',
   'sent', '{}', now() - interval '59 minutes')
ON CONFLICT (wa_message_id) DO NOTHING;

INSERT INTO whatsapp_number_sessions (hospital_id, wa_phone, active_patient_id, active_until, pending_choice)
VALUES
  ('00000000-0000-0000-0000-000000000001', '+971506234006', '10000000-0000-0000-0000-000000000007', now() + interval '23 hours', null)
ON CONFLICT (hospital_id, wa_phone) DO NOTHING;

INSERT INTO patient_timeline_events (episode_id, hospital_id, event_type, payload, risk_level, created_at)
VALUES
  ('20000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'whatsapp_inbound',
   '{"wa_message_id": "SM-demo-family-03", "type": "text", "state_transition": {"from": "idle", "to": "idle", "action": "route_to_ai"}, "routing": {"via": "choice", "linked_patients": 2}, "sender_name": "Noor"}', null, now() - interval '3 hours 8 minutes'),
  ('20000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'whatsapp_inbound',
   '{"wa_message_id": "SM-demo-family-05", "type": "text", "state_transition": {"from": "idle", "to": "idle", "action": "route_to_ai"}, "routing": {"via": "name", "linked_patients": 2}, "sender_name": "Noor"}', null, now() - interval '1 hour');
