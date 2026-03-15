import type { Study, FilterResult } from '../types/trial'
import { isAgeEligible } from './ageParser'

/**
 * Terms that CANNOT appear in the exclusion criteria section.
 * If any of these appear in the exclusion section, the trial explicitly
 * excludes leptomeningeal patients and must be removed from results.
 */
const EXCLUSION_BLOCKED_TERMS = ['leptomeningeal', 'leptomeninges']

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
 * Tried in order — first match wins.
 */
const EXCLUSION_SECTION_MARKERS = [
  'exclusion criteria:',
  'exclusion criteria\n',
  'exclusion criteria\r',
  '\nexclusion:',
  '\r\nexclusion:',
]

export interface ParsedCriteria {
  inclusion: string
  exclusion: string
  sectionFound: boolean
}

/**
 * Splits an eligibility criteria string into inclusion and exclusion sections.
 * The split is case-insensitive and looks for standard markers.
 */
export function parseEligibilityCriteria(text: string): ParsedCriteria {
  if (!text) {
    return { inclusion: '', exclusion: '', sectionFound: false }
  }

  const lower = text.toLowerCase()
  let splitIndex = -1

  for (const marker of EXCLUSION_SECTION_MARKERS) {
    const idx = lower.indexOf(marker)
    if (idx !== -1) {
      splitIndex = idx
      break
    }
  }

  if (splitIndex === -1) {
    // Could not find exclusion section — treat entire text as inclusion
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
 * should be shown to the patient, and whether it needs a verification flag.
 *
 * Steps:
 * 1. Parse eligibility criteria into inclusion/exclusion sections
 * 2. Hard exclusion check: if exclusion section contains blocked terms → remove
 * 3. Age eligibility check (if patient age provided)
 * 4. Inclusion OR check: verify at least one required term appears in searchable fields
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

  // --- Step 2: Exclusion criteria block check (CRITICAL) ---
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

  // --- Step 3: Age eligibility check ---
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

  // --- Step 4: Inclusion OR term verification ---
  const conditions = (proto.conditionsModule?.conditions ?? []).join(' ')
  const keywords = (proto.conditionsModule?.keywords ?? []).join(' ')
  const briefTitle = proto.identificationModule?.briefTitle ?? ''
  const officialTitle = proto.identificationModule?.officialTitle ?? ''
  const briefSummary = proto.descriptionModule?.briefSummary ?? ''

  const allSearchableText = [
    conditions,
    keywords,
    briefTitle,
    officialTitle,
    briefSummary,
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

  // --- All checks passed ---
  // If we couldn't find the exclusion section, flag for manual verification
  if (!sectionFound && criteriaText.length > 0) {
    return { include: true, flag: 'VERIFY_ELIGIBILITY' }
  }

  return { include: true }
}
