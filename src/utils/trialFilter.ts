import type { Study, FilterResult, TumorTypeFilter } from '../types/trial'
import { isAgeEligible } from './ageParser'

/**
 * Terms that confirm a trial is specifically for LMD patients when found in
 * the conditionsModule.conditions array. If any match, we auto-include the
 * trial (bypassing eligibility text checks) — only age still applies.
 */
const LMD_CONDITION_TERMS = ['leptomeningeal', 'leptomeninges']

/**
 * Terms that CANNOT appear in the exclusion criteria section.
 * If any of these appear in the exclusion section, the trial explicitly
 * excludes leptomeningeal (or brain-metastasis) patients and must be removed.
 *
 * Note: "brain metastases" / "brain metastasis" added to catch screening trials
 * for patients who have NOT yet developed brain/LMD involvement (Fix B).
 * Fix A (LMD in conditions) bypasses this check, so legitimate LMD+brain-met
 * trials are never incorrectly removed.
 */
const EXCLUSION_BLOCKED_TERMS = [
  'leptomeningeal',
  'leptomeninges',
  'brain metastases',
  'brain metastasis',
]

/**
 * Phrases in the INCLUSION criteria section that indicate LMD patients are
 * excluded — e.g. "No radiographic evidence of leptomeningeal disease".
 * These are negative-inclusion criteria (Fix D).
 */
const INCLUSION_NEGATIVE_PHRASES = [
  'no radiographic evidence of leptomeningeal',
  'no evidence of leptomeningeal',
  'no leptomeningeal disease',
  'no leptomeningeal metastasis',
  'no leptomeningeal metastases',
  'no leptomeningeal involvement',
  'absence of leptomeningeal',
]

/**
 * Plain-English phrases in the brief summary that signal LMD patients cannot
 * participate (Fix C). These appear in consumer-language summaries rather than
 * the structured eligibility criteria field.
 */
const BRIEF_SUMMARY_EXCLUSION_PHRASES = [
  'cannot take part if the cancer cells have spread to the thin tissue covering the brain and spinal cord',
]

/**
 * OR terms — at least one must appear somewhere in the study's searchable fields
 * (conditions, title, description, inclusion criteria) to confirm relevance.
 */
const INCLUSION_OR_TERMS = [
  'leptomeningeal',
  'leptomeninges',
  'brain metastasis',
  'brain metastases',
  'leptomeningeal carcinomatosis',
  'leptomeningeal cancer',
  'leptomeningeal metastasis',
  'leptomeningeal metastases',
  'metastatic malignant neoplasm in the leptomeninges',
]

/**
 * Markers that indicate the start of the exclusion criteria section.
 * All are checked; the one with the earliest position in the text wins.
 */
const EXCLUSION_SECTION_MARKERS = [
  'key exclusion criteria:',
  'key exclusion criteria\n',
  'key exclusion criteria\r',
  'main exclusion criteria:',
  'main exclusion criteria\n',
  'main exclusion criteria\r',
  'subject exclusion criteria:',
  'subject exclusion criteria\n',
  'patient exclusion criteria:',
  'patient exclusion criteria\n',
  'study exclusion criteria:',
  'study exclusion criteria\n',
  'specific exclusion criteria:',
  'specific exclusion criteria\n',
  'general exclusion criteria:',
  'general exclusion criteria\n',
  'exclusion criteria:',
  'exclusion criteria\n',
  'exclusion criteria\r',
  'exclusion criteria\t',
  'exclusion criteria (',
  '\nexclusion:\n',
  '\nexclusion:\r',
  '\nexclusion:\t',
  '\r\nexclusion:\n',
  '\r\nexclusion:\r',
  '\r\nexclusion:',
  '\nexclusion:',
]

export interface ParsedCriteria {
  inclusion: string
  exclusion: string
  sectionFound: boolean
}

/**
 * Splits an eligibility criteria string into inclusion and exclusion sections.
 */
export function parseEligibilityCriteria(text: string): ParsedCriteria {
  if (!text) {
    return { inclusion: '', exclusion: '', sectionFound: false }
  }

  const lower = text.toLowerCase()
  let splitIndex = -1

  for (const marker of EXCLUSION_SECTION_MARKERS) {
    const idx = lower.indexOf(marker)
    if (idx !== -1 && (splitIndex === -1 || idx < splitIndex)) {
      splitIndex = idx
    }
  }

  if (splitIndex === -1) {
    return { inclusion: text, exclusion: '', sectionFound: false }
  }

  return {
    inclusion: text.substring(0, splitIndex),
    exclusion: text.substring(splitIndex),
    sectionFound: true,
  }
}

/**
 * Main filter function. Returns a FilterResult indicating whether a trial
 * should be shown to the patient.
 *
 * Execution order:
 * 1. Parse eligibility criteria into inclusion/exclusion sections
 * 2. Compute whether LMD appears in the conditionsModule.conditions list
 * 3. Age eligibility check (applies to all trials)
 * 4. Fast path: if LMD in conditions list → return include: true
 *    (bypasses eligibility text checks — the conditions list is authoritative)
 * 5. Check inclusion section for INCLUSION_NEGATIVE_PHRASES → reject if found
 * 6. Check exclusion section for EXCLUSION_BLOCKED_TERMS → reject if found
 * 7. Check brief summary for BRIEF_SUMMARY_EXCLUSION_PHRASES → reject if found
 * 8. Inclusion OR term verification → reject if no LMD term found
 */
export function filterTrial(
  study: Study,
  patientAge: number | null
): FilterResult {
  const proto = study.protocolSection
  const eligibility = proto.eligibilityModule
  const criteriaText = eligibility?.eligibilityCriteria ?? ''

  // --- Step 1: Parse sections ---
  const { inclusion, exclusion, sectionFound } = parseEligibilityCriteria(criteriaText)

  // --- Step 2: Check LMD in conditions list ---
  const conditionsList = proto.conditionsModule?.conditions ?? []
  const lmdInConditions = LMD_CONDITION_TERMS.some((term) =>
    conditionsList.some((c) => c.toLowerCase().includes(term))
  )

  // --- Step 3: Age eligibility check (always applies) ---
  if (patientAge !== null) {
    const minAgeStr = eligibility?.minimumAge
    const maxAgeStr = eligibility?.maximumAge
    if (!isAgeEligible(patientAge, minAgeStr, maxAgeStr)) {
      return {
        include: false,
        reason: `Patient age ${patientAge} outside trial range (${minAgeStr ?? 'no min'} – ${maxAgeStr ?? 'no max'})`,
      }
    }
  }

  // --- Step 4: Fast path — LMD in conditions list is authoritative ---
  // Trials that list a leptomeningeal term as a primary condition are
  // definitively for LMD patients. Skip all eligibility text checks.
  if (lmdInConditions) {
    return { include: true }
  }

  // --- Step 5: Inclusion negative phrase check ---
  const lowerInclusion = inclusion.toLowerCase()
  for (const phrase of INCLUSION_NEGATIVE_PHRASES) {
    if (lowerInclusion.includes(phrase)) {
      return {
        include: false,
        reason: `Inclusion criteria excludes LMD patients: "${phrase}"`,
      }
    }
  }

  // --- Step 6: Exclusion criteria block check ---
  if (sectionFound) {
    const lowerExclusion = exclusion.toLowerCase()
    for (const term of EXCLUSION_BLOCKED_TERMS) {
      if (lowerExclusion.includes(term)) {
        return {
          include: false,
          reason: `Exclusion criteria contains "${term}" — trial explicitly excludes leptomeningeal patients`,
        }
      }
    }
  }

  // --- Step 7: Brief summary exclusion phrase check ---
  const briefSummary = (proto.descriptionModule?.briefSummary ?? '').toLowerCase()
  for (const phrase of BRIEF_SUMMARY_EXCLUSION_PHRASES) {
    if (briefSummary.includes(phrase)) {
      return {
        include: false,
        reason: 'Brief summary indicates LMD patients excluded',
      }
    }
  }

  // --- Step 8: Inclusion OR term verification ---
  const conditions = conditionsList.join(' ')
  const keywords = (proto.conditionsModule?.keywords ?? []).join(' ')
  const briefTitle = proto.identificationModule?.briefTitle ?? ''
  const officialTitle = proto.identificationModule?.officialTitle ?? ''
  const briefSummaryRaw = proto.descriptionModule?.briefSummary ?? ''

  const allSearchableText = [
    conditions,
    keywords,
    briefTitle,
    officialTitle,
    briefSummaryRaw,
    inclusion,
  ]
    .join(' ')
    .toLowerCase()

  const hasRequiredTerms = INCLUSION_OR_TERMS.some((term) =>
    allSearchableText.includes(term)
  )

  if (!hasRequiredTerms) {
    return {
      include: false,
      reason: 'No leptomeningeal or brain metastasis reference found in searchable fields',
    }
  }

  return { include: true }
}

// ---------------------------------------------------------------------------
// Tumor type keyword maps
// ---------------------------------------------------------------------------
const TUMOR_KEYWORDS: Record<Exclude<TumorTypeFilter, 'any' | 'OTHER_SOLID'>, string[]> = {
  LUNG: [
    'non-small cell lung', 'small cell lung', 'nsclc', 'sclc',
    'lung cancer', 'lung carcinoma', 'lung adenocarcinoma',
    'lung neoplasm', 'pulmonary carcinoma',
  ],
  BREAST: [
    'breast cancer', 'breast carcinoma', 'breast neoplasm',
    'breast tumor', 'breast tumour', 'mammary carcinoma',
    'triple negative breast', 'triple-negative breast', 'her2-positive breast',
  ],
  MELANOMA: ['melanoma'],
  GBM: [
    'glioblastoma', 'high-grade glioma', 'high grade glioma',
    'grade iv glioma', 'grade 4 glioma', 'malignant glioma',
    'anaplastic astrocytoma',
  ],
}

const SPECIFIC_TYPES = ['LUNG', 'BREAST', 'MELANOMA', 'GBM'] as const
type SpecificType = typeof SPECIFIC_TYPES[number]

/**
 * Returns true if the study should be included for the given tumor type.
 *
 * Inclusion logic:
 * - 'any'         → always include
 * - 'OTHER_SOLID' → include if the study has no match for any specific type
 * - Specific type → include if broadly-open (no specific type found) OR matches selected type
 */
export function filterByTumorType(study: Study, tumorType: TumorTypeFilter): boolean {
  if (tumorType === 'any') return true

  const proto = study.protocolSection
  const combinedText = [
    (proto.conditionsModule?.conditions ?? []).join(' '),
    (proto.conditionsModule?.keywords ?? []).join(' '),
    proto.identificationModule?.briefTitle ?? '',
    proto.identificationModule?.officialTitle ?? '',
    proto.descriptionModule?.briefSummary ?? '',
  ]
    .join(' ')
    .toLowerCase()

  const matchedTypes = SPECIFIC_TYPES.filter((type) =>
    TUMOR_KEYWORDS[type].some((kw) => combinedText.includes(kw))
  ) as SpecificType[]

  const hasAnySpecific = matchedTypes.length > 0

  if (tumorType === 'OTHER_SOLID') {
    // Include broadly-open trials + non-specific trials; exclude lung/breast/melanoma/GBM-specific ones
    return !hasAnySpecific
  }

  // For LUNG | BREAST | MELANOMA | GBM:
  if (!hasAnySpecific) return true // broadly-open — relevant to all
  return matchedTypes.includes(tumorType as SpecificType)
}
