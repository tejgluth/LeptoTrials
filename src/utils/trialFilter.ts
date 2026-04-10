import type { Study, FilterResult, TumorTypeFilter } from '../types/trial'
import { isAgeEligible } from './ageParser'
import { getManualAuditOverride } from './manualAuditOverrides'

// Presence of any of these in conditionsModule.conditions is authoritative — the trial
// is specifically for LMD patients, so we skip eligibility text checks (age still applies).
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

const EXCLUSION_BLOCKED_TERMS = [
  'leptomeningeal',
  'leptomeninges',
]

// Negative-inclusion phrases: LMD patients are effectively excluded even though
// the phrasing appears in the inclusion section rather than the exclusion section.
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

// Consumer-language exclusion phrases in brief summaries — these don't appear in the
// structured eligibility criteria field so they need a separate check.
const BRIEF_SUMMARY_EXCLUSION_PHRASES = [
  'cannot take part if the cancer cells have spread to the thin tissue covering the brain and spinal cord',
]

// Generic brain-metastasis terms intentionally excluded — too broad for an LM-specific finder.
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

// All markers are checked; the one at the earliest position wins.
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

export function filterTrial(
  study: Study,
  patientAge: number | null
): FilterResult {
  const proto = study.protocolSection
  const nctId = proto.identificationModule.nctId
  const eligibility = proto.eligibilityModule
  const criteriaText = eligibility?.eligibilityCriteria ?? ''

  const { inclusion, exclusion, sectionFound } = parseEligibilityCriteria(criteriaText)
  const lowerInclusion = inclusion.toLowerCase()
  const lowerExclusion = exclusion.toLowerCase()

  const { conditionsText, titleText, summaryText } = getStudyTextParts(study)
  const lmdInConditions = includesAnyTerm(conditionsText, LMD_CONDITION_TERMS)
  const hasTitleLmSignal = includesAnyTerm(titleText, LM_POSITIVE_TERMS)
  const hasSummaryLmSignal = matchesAnyPattern(summaryText, LM_CONTEXT_PATTERNS)
  const hasInclusionLmSignal = matchesAnyPattern(lowerInclusion, LM_CONTEXT_PATTERNS)
  const hasDefinitiveLmSignal = lmdInConditions || hasTitleLmSignal

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

  for (const phrase of INCLUSION_NEGATIVE_PHRASES) {
    if (lowerInclusion.includes(phrase)) {
      return {
        include: false,
        reason: `Inclusion criteria excludes LMD patients: "${phrase}"`,
      }
    }
  }

  // lmdInConditions is authoritative — don't let a mixed-cohort exclusion section
  // veto a trial that explicitly lists LM as the condition.
  if (lmdInConditions) {
    return { include: true }
  }

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

  const briefSummary = (proto.descriptionModule?.briefSummary ?? '').toLowerCase()
  for (const phrase of BRIEF_SUMMARY_EXCLUSION_PHRASES) {
    if (briefSummary.includes(phrase)) {
      return {
        include: false,
        reason: 'Brief summary indicates LMD patients excluded',
      }
    }
  }

  const hasRequiredTerms = hasDefinitiveLmSignal || hasSummaryLmSignal || hasInclusionLmSignal

  if (!hasRequiredTerms) {
    return {
      include: false,
      reason: 'No explicit leptomeningeal reference found in searchable fields',
    }
  }

  return { include: true }
}

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

// OTHER_SOLID requires explicit non-hematologic, non-CNS solid-tumor evidence.
// Specific types require positive keyword evidence; 'any' always passes.
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
