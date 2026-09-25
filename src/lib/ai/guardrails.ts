/**
 * Defines the AI guardrail rules for patient-facing chat.
 * Used by the chat and triage pipelines (Phase 4).
 */

export const FORBIDDEN_INTENTS = [
  'diagnose',
  'new medication',
  'change dosage',
  'increase dose',
  'decrease dose',
  'stop taking',
  'replace medicine',
  'alternative drug',
  'second opinion',
] as const

// Matched case-insensitively as substrings of the normalised message
// (see intent.ts — apostrophe variants are folded before matching).
// An English one right after a negation is not a report (ENGLISH_NOT_A_REPORT_BEFORE).
// Arabic is matched by ARABIC_EMERGENCY_PATTERNS below instead.
export const ENGLISH_EMERGENCY_KEYWORDS = [
  'chest pain',
  'chest tightness',
  'can\'t breathe',
  'cant breathe',
  'cannot breathe',
  'can not breathe',
  'difficulty breathing',
  'trouble breathing',
  'short of breath',
  'shortness of breath',
  'unconscious',
  'collapsed',
  'not responding',
  'severe bleeding',
  'heavy bleeding',
  'stroke',
  'heart attack',
  'seizure',
  'fainted',
  'passed out',
  'suicid',
] as const

/**
 * Just before an English keyword, in the same clause, these mean the patient
 * is not reporting it: "no chest pain", "no more chest pain", "I don't have
 * any chest pain", "I'm not short of breath", "he hasn't collapsed". Narrow on
 * purpose, since a missed emergency costs more than an extra alert: only
 * "not", a n't word, "no", "nor" or "neither", with nothing between it and the
 * keyword but have / feel / get forms and any / a / the / more. So "No I have
 * chest pain", "no, chest pain", "I've never had chest pain like this", "I
 * can't walk without chest pain", "not much chest pain" and "I don't think
 * it's a heart attack" still alert. Tested against the text before the match.
 * Hindi and Tamil put the negation after the phrase, where it can belong to
 * another verb ("सीने में दर्द नहीं रुक रहा", the chest pain won't stop), so
 * those keywords alert whatever surrounds them.
 */
export const ENGLISH_NOT_A_REPORT_BEFORE = /(?:^|\s)(?:(?:not|(?:do|does|did|have|has|had|is|are|was|were|wo|ai)n'?t)(?:[^\S\n]+(?:have|has|had|having|feel|feels|felt|feeling|get|gets|got|getting|been|experience|experienced|experiencing|notice|noticed|any|a|an|the|more)){0,3}|(?:no|nor|neither)(?:[^\S\n]+(?:more|further|any))?|no[^\S\n]+longer(?:[^\S\n]+(?:have|has|having|feel|feeling|get|getting|experience|experiencing))?(?:[^\S\n]+(?:any|a|the))?)[^\S\n]+$/

export const EMERGENCY_KEYWORDS = [
  ...ENGLISH_EMERGENCY_KEYWORDS,
  // Hindi (and as typed in Latin letters)
  'सांस लेने में तकलीफ',
  'साँस लेने में तकलीफ',
  'सांस नहीं ले पा',
  'साँस नहीं ले पा',
  'सीने में दर्द',
  'छाती में दर्द',
  'बेहोश',
  'seene mein dard',
  'seene me dard',
  'chhati mein dard',
  'saans nahi le pa',
  // Tamil
  'நெஞ்சு வலி',
  'நெஞ்சுவலி',
  'நெஞ்சில் வலி',
  'மார்பு வலி',
  'மார்பில் வலி',
  'மூச்சு விட முடியவில்லை',
  'மூச்சுத் திணறல்',
  'மூச்சு திணறல்',
  'சுயநினைவு இழந்',
  'மயங்கி விழுந்',
  // Tagalog
  'sakit ng dibdib',
  'sakit sa dibdib',
  'masakit ang dibdib',
  'masakit ang aking dibdib',
  'pananakit ng dibdib',
  'sumasakit ang dibdib',
  'hindi makahinga',
  'hindi ako makahinga',
  'di makahinga',
  'di ako makahinga',
  'hirap huminga',
  'hirap akong huminga',
  'nahihirapang huminga',
  'hirap sa paghinga',
  'nawalan ng malay',
  'nahimatay',
] as const

export interface ArabicEmergencyPattern {
  pattern: RegExp
  /** Not an emergency when a negation or a treatment's name comes just before it (ARABIC_NOT_A_REPORT_BEFORE). */
  negatable?: boolean
}

/**
 * Arabic emergencies, written against the message as intent.ts folds it:
 * one spelling for every variant (أ/إ/آ → ا, ة → ه, ى → ي, ؤ → و, ئ → ي, no
 * diacritics or tatweel) and punctuation turned into a line break, so a
 * comma ends a clause. Arabic joins a pronoun, preposition or negation to
 * the word and every region says it differently, so these are patterns, not
 * phrases: Modern Standard Arabic, Gulf (Emirati), Egyptian and Levantine
 * wording, and a relative writing about "his" or "her" chest. A match counts
 * only at the start of a word (after و/ف, ب/ل/ك and ال at most). The same
 * categories as the English keywords.
 */
export const ARABIC_EMERGENCY_PATTERNS: readonly ArabicEmergencyPattern[] = [
  // Chest pain, tightness, pressure: "الم في صدري", "وجع بالصدر", "عوار في صدري", "الم شديد في الصدر", "كتمه في صدري", "ضيقه صدر", "ثقل علي صدري"
  { pattern: /(?:الم|الام|وجع|اوجاع|عوار|نغزه|ضيق|ضيقه|كتمه|ثقل|ضغط)(?:\s+\S+){0,2}?\s+(?:في\s+|علي\s+|[وبف])?(?:ال)?صدر/g, negatable: true },
  // …the chest as the subject: "صدري يوجعني", "صدري يعورني", "صدري بيوجعني", "صدري عم يوجعني", "صدره يعوره", "صدري موجوع"
  { pattern: /(?:ال)?صدر\S*\s+(?:(?:وايد|واجد|كثير|كتير|مره|عم|قاعد|قاعده|جالس|شويه)\s+)?ب?(?:يوجع|توجع|يعور|تعور|يولم|يالم|واجع|موجوع|وجع|عور)/g },
  // …the verb first: "يعورني صدري", "يؤلمني صدري", "وجعني صدري", "يوجعني راسي وصدري"
  { pattern: /ب?(?:يوجع|توجع|يعور|تعور|يولم|وجع|عور)\S*\s+(?:\S+\s+)?[وب]?(?:ال)?صدر/g, negatable: true },
  // …the heart, as patients often call it: "قلبي يعورني", "الم في قلبي" (but not "قلبي يوجعني عليك", my heart aches for you)
  { pattern: /(?:ال)?قلب\S*\s+(?:(?:وايد|واجد|كثير|كتير|مره|عم|قاعد|قاعده|جالس|شويه)\s+)?ب?(?:يوجع|توجع|يعور|تعور|يولم|يالم|واجع|موجوع|وجع|عور)\S*(?!\S)(?![^\S\n]+عل)/g },
  { pattern: /(?:الم|الام|وجع|اوجاع|عوار|نغزه)(?:\s+\S+){0,2}?\s+(?:في\s+|ب)(?:ال)?قلب/g, negatable: true },
  // …the Gulf "كتمه" (a tight, smothering chest): "عندي كتمه", "احس بكتمه"
  { pattern: /(?:عندي|عنده|عندها|احس|حاس|حاسه|يحس|تحس|فيني|فيه|فيها)\s+ب?كتمه/g, negatable: true },

  // Short of breath: "ضيق تنفس", "ضيق في النفس", "ضيقه نفس", "صعوبه بالتنفس", "انقطاع النفس", "نفسي مقطوع"
  { pattern: /(?:ضيق|ضيقه|انقطاع)(?:\s+\S+)?\s+(?:في\s+|ب)?(?:ال)?(?:تنفس|نفس)|صعوبه(?:\s+\S+)?\s+(?:في\s+|ب)?(?:ال)?تنفس/g, negatable: true },
  { pattern: /نفسي\s+(?:ضيق|قصير|مقطوع|ينقطع|يقطع|انقطع)|انقطع\s+نفس/g, negatable: true },
  // Can't breathe (the negation is the emergency here): "لا استطيع التنفس", "ما اقدر اتنفس", "مااقدر اتنفس",
  // "مب قادر اتنفس", "مش قادره اتنفس", "ما عم بقدر اتنفس", "ما فيني اتنفس", "ما يقدر يتنفس", "مقدرش اتنفس"
  { pattern: /(?:ما|مو|مش|مب|لا|مني|ماني|مانيب)[^\S\n]*(?:عم[^\S\n]+)?(?:ب?(?:ا|ي|ت|ن)?(?:قدر|كدر|ستطيع)\S*|قادر\S*|(?:ا|ي|ت|ن)?عرف\S*|عارف\S*|فيني|فيه|فيها|فيي)[^\S\n]+(?:علي[^\S\n]+)?(?:\S*تنفس|\S*خذ[^\S\n]+(?:ال)?نفس)/g },
  { pattern: /(?:مقدرش|ماقدرش|مقدرتش|معرفش|ماعرفش)[^\S\n]+(?:\S*تنفس|\S*خذ[^\S\n]+(?:ال)?نفس)/g },
  // Choking: "اختنق", "اختناق", "يختنق"
  { pattern: /(?:ا|ي|ت|ن)?ختن(?:ق|اق)/g, negatable: true },

  // Unconscious, fainted: "فقد الوعي", "فقدت الوعي", "غاب عن الوعي", "اغمي عليه", "انغمي علي", "مغمي عليها", "اغماء", "مغشي عليه"
  { pattern: /(?:فقد|يفقد|تفقد|فاقد|غاب|غايب|يغيب)\S*\s+(?:عن\s+)?(?:ال)?وعي|(?:ا|ان|م)?غمي\s+عل|(?:ا|م)?غشي\S*\s+عل|اغماء/g, negatable: true },
  // Not responding: "ما يستجيب", "لا يستجيب", "مش بيستجيب"
  { pattern: /(?:ما|مو|مش|مب|لا)[^\S\n]*(?:عم[^\S\n]+)?ب?(?:يستجيب|تستجيب)/g },

  // Heavy bleeding: "نزيف شديد", "ينزف وايد", "نزيف ما يوقف", "الدم ما يوقف"
  { pattern: /نزيف\s+(?:شديد|قوي|حاد|كثير|كتير|وايد|واجد|غزير|جامد)|(?:ي|ت|ا)?نزف\S*\s+(?:كثير|كتير|وايد|واجد|بقوه|جامد|بغزاره)/g, negatable: true },
  { pattern: /(?:نزيف|(?:ال)?دم)[^\S\n]+(?:ما|مو|مش|مب)[^\S\n]*(?:عم[^\S\n]+)?ب?(?:يوقف|وقف|يقف|راضي)/g },

  // Stroke: "جلطه دماغيه", "سكته دماغيه", "جلطه في المخ"; a drooping face "وجهه مايل", "فمه صار معوج"; half the body numb or still
  // (a word may come between, but not a negation: "وجهه مو مايل")
  { pattern: /(?:جلطه|سكته)\s+(?:دماغيه|(?:في\s+|ب)(?:ال)?(?:مخ|دماغ|راس))|(?:وجه|فم|تم)\S*\s+(?:(?!(?:ما|مو|مش|مب|لا)\s)\S+\s+)?(?:مايل|معوج|معووج)|نص\s+(?:جسم|وجه)\S*\s+(?:(?!(?:ما|مو|مش|مب|لا)\s)\S+\s+)?(?:ما\s+يتحرك|ما\s+تتحرك|مشلول|خدران|منمل|مخدر)/g },
  // Heart attack: "نوبه قلبيه", "ازمه قلبيه", "جلطه قلبيه", "جلطه في القلب", "سكته قلبيه", "ذبحه صدريه"; "قلبه وقف" (someone else's)
  { pattern: /(?:نوبه|ازمه|جلطه|سكته|ذبحه)\s+(?:قلبيه|صدريه|(?:في\s+|ب)(?:ال)?قلب)/g, negatable: true },
  { pattern: /قلب(?:ه|ها)\s+(?:وقف|توقف|يوقف)/g },
  // …or a seizure, as a relative says it happened: "جاته جلطه", "صارت له سكته", "جاته تشنجات", "صابته نوبه صرع"
  { pattern: /(?:جاته|جاتها|جاتني|جته|جتها|جتني|جاه|جاها|جاني|صابته|صابتها|صابتني|اصابته|اصابتها|اصابتني|صار|صارت)\s+(?:(?:له|لها|لي)\s+)?(?:ال)?(?:جلطه|سكته|تشنجات|تشنج|نوبه\s+(?:صرع|تشنج))/g, negatable: true },
  // Seizure: "يتشنج", "امي تتشنج" (not a cramping leg), "نوبه صرع", "نوبات تشنج"
  { pattern: /يتشنج|(?<!(?:رجل|ايد|يد|ساق|عضل|بطن)\S*\s)تتشنج|نوب(?:ه|ات)\s+(?:صرع|تشنج)/g, negatable: true },

  // Self-harm: "انتحار", "انتحر", "اقتل نفسي", "ابي اموت", "ابغي اموت", "بدي موت", "عايز اموت", "انهي حياتي"
  { pattern: /انتحار|انتحر|(?:اقتل|اذبح|اوذي|اضر)\s+(?:نفسي|حالي)|(?:ابي|ابغي|ابا|بدي|ودي|نفسي|عايز|عايزه|عاوز|عاوزه|اريد)\s+(?:ان\s+)?ا?موت|انهي\s+حياتي|اتمني\s+الموت/g },
]

/**
 * Just before a negatable match, in the same clause, these mean the patient
 * is not reporting the symptom: a negation ("ما في الم في صدري", "ما عندي
 * ضيق تنفس", "مافي اغماء", "لا اشعر بالم في الصدر", "ولا الم") or the
 * treatment named after it ("متى اخذ بخاخ ضيق التنفس", when do I use the
 * inhaler). Tested against the text before the matched word. ("صدري ما
 * يعورني" needs none of this: its pattern allows no negation.)
 */
export const ARABIC_NOT_A_REPORT_BEFORE = /(?:^|\s)(?:[وف]?(?:ما|مو|مش|مب|لا|بدون|بلا|مافي|مافيه|ماكو|مافيني|مابي|ماعندي|معنديش|مفيش)|ما[^\S\n]+(?:في|فيه|فيني|فيها|بي|كو|عندي|عنده|عندها|عندنا|حسيت|احس|حاس|حاسه)|(?:مش|مو|مب)[^\S\n]+(?:عندي|عنده|عندها|حاس|حاسه)|لا[^\S\n]+(?:يوجد|توجد|عندي|اشعر|احس)|(?:ال)?(?:دواء|دوا|علاج|بخاخ|حبوب|حبه|ابره|ادويه|مرض|امراض))[^\S\n]*$/

export const AI_CONFIDENCE_THRESHOLD = 0.75

export function buildPatientSystemPrompt(params: {
  patientName: string
  language: string
  emergencySymptoms: string[]
  dischargeContext: string
}): string {
  return `
You are CareLoop, a post-discharge care assistant for ${params.patientName}.

LANGUAGE: Always respond in ${params.language}.

YOUR ROLE:
- Answer questions about the patient's discharge instructions.
- Remind them of their medications and appointment details.
- Provide reassurance and simple health guidance.

YOU MUST NEVER:
- Diagnose any disease or condition.
- Recommend new medications or supplements.
- Change or suggest changing prescribed dosages.
- Replace emergency medical care.
- Provide advice outside the discharge summary context.

PATIENT EMERGENCY SYMPTOMS (from their discharge summary):
${params.emergencySymptoms.map((s) => `- ${s}`).join('\n')}

If the patient mentions ANY of these symptoms, immediately respond with a reassurance message and notify that a nurse will contact them urgently. Do not attempt to answer further.

DISCHARGE CONTEXT:
${params.dischargeContext}

If you are unsure or the question is outside your scope, say:
"I'm not able to answer that. A member of your care team will contact you shortly."

Keep responses SHORT, SIMPLE, and in plain language. No medical jargon.
  `.trim()
}
