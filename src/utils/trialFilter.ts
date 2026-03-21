import type { Study, FilterResult, TumorTypeFilter } from '../types/trial'
import { isAgeEligible } from './ageParser'
import { getManualAuditOverride } from './manualAuditOverrides'

/**
 * Terms that confirm a trial is specifically for LMD patients when found in
 * the conditionsModule.conditions array. If any match, we auto-include the
 * trial (bypassing eligibility text checks) — only age still applies.
 */
const LMD_CONDITION_TERMS = [
  'leptomeningeal',
  'leptomeninges',
  'leptomeningeal disease',
  'leptomeningeal carcinomatosis',
  'meningeal disease',
  'meningeal metastasis',
  'meningeal metastases',
  'lmd',
]

/**
 * Terms that CANNOT appear in the exclusion criteria section.
 * If any of these appear in the exclusion section, the trial explicitly
 * excludes leptomeningeal patients and must be removed.
 */
const EXCLUSION_BLOCKED_TERMS = [
  'leptomeningeal',
  'leptomeninges',
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
  'no meningeal metastasis',
  'no meningeal metastases',
  'without leptomeningeal',
  'without meningeal metastasis',
  'without meningeal metastases',
  'absence of leptomeningeal',
  'absence of meningeal metastasis',
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
 * Positive LM evidence. We intentionally do NOT use generic brain-metastasis
 * terms because they are too broad for an LM-specific finder.
 */
const LM_POSITIVE_TERMS = [
  'leptomeningeal',
  'leptomeninges',
  'lmd',
  'leptomeningeal carcinomatosis',
  'meningeal carcinomatosis',
  'leptomeningeal cancer',
  'leptomeningeal disease',
  'meningeal disease',
  'leptomeningeal metastasis',
  'leptomeningeal metastases',
  'meningeal metastasis',
  'meningeal metastases',
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

const LM_TERM_PATTERN =
  /\b(?:lmd|leptomeningeal(?: disease| metastasis| metastases| carcinomatosis)?|leptomeninges|meningeal disease|meningeal metastasis|meningeal metastases|meningeal carcinomatosis)\b/i

const LM_CONTEXT_PATTERNS = [
  new RegExp(`patients? with[^.\\n;]{0,80}${LM_TERM_PATTERN.source}`, 'i'),
  new RegExp(`with[^.\\n;]{0,60}${LM_TERM_PATTERN.source}`, 'i'),
  new RegExp(`evidence of[^.\\n;]{0,60}${LM_TERM_PATTERN.source}`, 'i'),
  new RegExp(`diagnos(?:ed|is of)[^.\\n;]{0,60}${LM_TERM_PATTERN.source}`, 'i'),
  new RegExp(`newly diagnosed[^.\\n;]{0,60}${LM_TERM_PATTERN.source}`, 'i'),
  new RegExp(`${LM_TERM_PATTERN.source}[^.\\n;]{0,60}(patients?|cohort|confirmed|diagnosed|from)`, 'i'),
]

function includesAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    if (term === 'lmd') return /\blmd\b/i.test(text)
    return text.includes(term)
  })
}

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function getStudyTextParts(study: Study) {
  const proto = study.protocolSection
  const conditions = (proto.conditionsModule?.conditions ?? []).join(' ')
  const briefTitle = proto.identificationModule?.briefTitle ?? ''
  const officialTitle = proto.identificationModule?.officialTitle ?? ''
  const briefSummary = proto.descriptionModule?.briefSummary ?? ''

  return {
    conditionsText: conditions.toLowerCase(),
    titleText: [briefTitle, officialTitle].join(' ').toLowerCase(),
    summaryText: briefSummary.toLowerCase(),
  }
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
  const nctId = proto.identificationModule.nctId
  const eligibility = proto.eligibilityModule
  const criteriaText = eligibility?.eligibilityCriteria ?? ''

  // --- Step 1: Parse sections ---
  const { inclusion, exclusion, sectionFound } = parseEligibilityCriteria(criteriaText)
  const lowerInclusion = inclusion.toLowerCase()
  const lowerExclusion = exclusion.toLowerCase()

  // --- Step 2: Check LMD in conditions list ---
  const {
    conditionsText,
    titleText,
    summaryText,
  } = getStudyTextParts(study)
  const lmdInConditions = includesAnyTerm(conditionsText, LMD_CONDITION_TERMS)
  const hasTitleLmSignal = includesAnyTerm(titleText, LM_POSITIVE_TERMS)
  const hasSummaryLmSignal = matchesAnyPattern(summaryText, LM_CONTEXT_PATTERNS)
  const hasInclusionLmSignal = matchesAnyPattern(lowerInclusion, LM_CONTEXT_PATTERNS)
  const hasDefinitiveLmSignal = lmdInConditions || hasTitleLmSignal

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

  const manualAuditOverride = getManualAuditOverride(nctId)
  if (manualAuditOverride) {
    if (!manualAuditOverride.siteEligible) {
      return {
        include: false,
        reason: 'Excluded by manual audit override',
      }
    }
    return { include: true }
  }

  // --- Step 4: Inclusion negative phrase check ---
  for (const phrase of INCLUSION_NEGATIVE_PHRASES) {
    if (lowerInclusion.includes(phrase)) {
      return {
        include: false,
        reason: `Inclusion criteria excludes LMD patients: "${phrase}"`,
      }
    }
  }

  // --- Step 5: Fast path — conditions-level LM evidence is a strong positive signal ---
  // Still respect explicit negative language above, but avoid treating a mixed-cohort
  // exclusion section as a universal LM exclusion when the study lists LM directly.
  if (lmdInConditions) {
    return { include: true }
  }

  // --- Step 6: Exclusion criteria block check ---
  if (sectionFound && !hasDefinitiveLmSignal) {
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

  // --- Step 8: Explicit LM evidence verification ---
  const hasRequiredTerms = hasDefinitiveLmSignal || hasSummaryLmSignal || hasInclusionLmSignal

  if (!hasRequiredTerms) {
    return {
      include: false,
      reason: 'No explicit leptomeningeal reference found in searchable fields',
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

const NON_SOLID_KEYWORDS = [
  'lymphoma',
  'pcnsl',
  'leukemia',
  'leukaemia',
  'myeloma',
  'myelodysplastic',
  'myelodysplastic syndrome',
  'mds',
  'aml',
  'cml',
  'myeloid leukemia',
  'lymphoid',
  'hematologic',
  'haematologic',
]

const BROAD_SOLID_KEYWORDS = [
  'solid tumor',
  'solid tumors',
  'solid tumour',
  'solid tumours',
  'solid tumor malignancies',
  'malignant solid tumors',
  'advanced solid tumors',
  'locally advanced or metastatic malignant solid tumors',
  'all solid tumors',
  'any solid tumor',
]

const NON_OTHER_SOLID_KEYWORDS = [
  ...NON_SOLID_KEYWORDS,
  'brain tumor',
  'brain tumour',
  'brain neoplasm',
  'primary brain neoplasm',
  'central nervous system tumor',
  'central nervous system tumour',
  'cns tumor',
  'cns tumour',
  'glioma',
  'astrocytoma',
  'ependymoma',
  'medulloblastoma',
  'oligodendroglioma',
  'meningioma',
  'diffuse intrinsic pontine glioma',
  'diffuse midline glioma',
]

const OTHER_SOLID_SITE_KEYWORDS = [
  'colorectal',
  'colon cancer',
  'colorectal cancer',
  'rectal cancer',
  'pancreatic cancer',
  'pancreatic adenocarcinoma',
  'gastric cancer',
  'gastroesophageal',
  'esophageal cancer',
  'ovarian cancer',
  'endometrial cancer',
  'uterine cancer',
  'cervical cancer',
  'prostate cancer',
  'urothelial cancer',
  'bladder cancer',
  'renal cell',
  'kidney cancer',
  'hepatocellular',
  'liver cancer',
  'cholangiocarcinoma',
  'biliary tract cancer',
  'head and neck cancer',
  'thyroid cancer',
  'salivary gland',
  'sarcoma',
  'mesothelioma',
  'appendiceal cancer',
  'small bowel cancer',
  'anal cancer',
]

function getTumorTypeText(study: Study): string {
  const proto = study.protocolSection
  const meshes = (
    study.derivedSection?.conditionBrowseModule?.meshes?.map((mesh) => mesh.term) ?? []
  ).join(' ')

  return [
    (proto.conditionsModule?.conditions ?? []).join(' '),
    (proto.conditionsModule?.keywords ?? []).join(' '),
    proto.identificationModule?.briefTitle ?? '',
    proto.identificationModule?.officialTitle ?? '',
    proto.descriptionModule?.briefSummary ?? '',
    meshes,
  ]
    .join(' ')
    .toLowerCase()
}

/**
 * Returns true if the study should be included for the given tumor type.
 *
 * Inclusion logic:
 * - 'any'         → always include
 * - 'OTHER_SOLID' → include only with explicit non-hematologic, non-CNS solid-tumor evidence
 * - Specific type → include only on positive evidence for that type
 */
export function filterByTumorType(study: Study, tumorType: TumorTypeFilter): boolean {
  if (tumorType === 'any') return true

  const manualAuditOverride = getManualAuditOverride(
    study.protocolSection.identificationModule.nctId
  )
  if (manualAuditOverride) {
    return manualAuditOverride.tumorLabels.includes(tumorType as Exclude<TumorTypeFilter, 'any'>)
  }

  const combinedText = getTumorTypeText(study)

  const matchedTypes = SPECIFIC_TYPES.filter((type) =>
    TUMOR_KEYWORDS[type].some((kw) => combinedText.includes(kw))
  ) as SpecificType[]

  const hasAnySpecific = matchedTypes.length > 0
  const hasNonOtherSolidSignal = NON_OTHER_SOLID_KEYWORDS.some((kw) => combinedText.includes(kw))
  const hasBroadSolidSignal = BROAD_SOLID_KEYWORDS.some((kw) => combinedText.includes(kw))
  const hasOtherSolidSiteSignal = OTHER_SOLID_SITE_KEYWORDS.some((kw) => combinedText.includes(kw))

  if (tumorType === 'OTHER_SOLID') {
    if (hasNonOtherSolidSignal || hasAnySpecific) return false
    return hasBroadSolidSignal || hasOtherSolidSiteSignal
  }

  return matchedTypes.includes(tumorType as SpecificType)
}
