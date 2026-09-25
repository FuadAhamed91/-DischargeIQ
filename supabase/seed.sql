-- ============================================================
-- CareLoop — Development Seed Data
-- Run only against local / staging environments.
-- ============================================================

-- Demo hospital
INSERT INTO hospitals (id, name, slug, timezone, whatsapp_phone_number_id, settings, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Dubai General Hospital',
  'dubai-general',
  'Asia/Dubai',
  'DEMO_PHONE_NUMBER_ID',
  '{"languages": ["en", "ar", "hi"], "escalation_threshold_hours": 48}',
  true
) ON CONFLICT (id) DO NOTHING;

-- Demo department
INSERT INTO departments (id, hospital_id, name)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'General Ward'
) ON CONFLICT (id) DO NOTHING;

-- Note: Staff user profiles are created via the invite flow.
-- Seed users must be created via Supabase Auth dashboard or CLI,
-- then their profile rows inserted here with matching UUIDs.

-- Demo approved guidance entries
INSERT INTO hospital_approved_guidance (hospital_id, category, question_patterns, answer, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'general',
  '["can I eat", "food", "diet", "avoid eating"]',
  '{"en": "Follow the dietary guidelines provided in your discharge summary. Avoid processed foods and excess salt unless advised otherwise.", "ar": "اتبع إرشادات النظام الغذائي المقدمة في ملخص خروجك من المستشفى.", "hi": "कृपया अपने डिस्चार्ज सारांश में दिए गए आहार दिशानिर्देशों का पालन करें।"}',
  true
),
(
  '00000000-0000-0000-0000-000000000001',
  'medication',
  '["missed dose", "forgot medicine", "skip pill"]',
  '{"en": "If you missed a dose, take it as soon as you remember. If it is almost time for your next dose, skip the missed one. Do not double up. Contact your care team if unsure.", "ar": "إذا نسيت جرعة، تناولها حالما تتذكر. إذا اقترب موعد الجرعة التالية، تخطَّ الجرعة الفائتة.", "hi": "यदि आप एक खुराक भूल गए हैं, तो याद आते ही लें। यदि अगली खुराक का समय हो गया है, तो छूटी हुई खुराक को छोड़ दें।"}',
  true
);
