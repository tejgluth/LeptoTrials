import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildCondUrl, buildTermUrl, DEFAULT_SEARCH_PARAMS } from '../src/utils/apiClient'
import { CONTINENT_COUNTRIES } from '../src/constants/countries'
import { getManualAuditOverride } from '../src/utils/manualAuditOverrides'
import { filterByTumorType, filterTrial } from '../src/utils/trialFilter'
import type {
  ApiResponse,
  OverallStatus,
  PhaseFilter,
  SearchParams,
  Study,
  StudyTypeFilter,
  TumorTypeFilter,
} from '../src/types/trial'

const MAX_PAGES = 20
const CACHE_DIR = join(process.cwd(), '.cache', 'validate-trials')
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 6
const FETCH_RETRIES = 5
const DEFAULT_RESULTS_STATUSES: OverallStatus[] = [...DEFAULT_SEARCH_PARAMS.statuses]
const ALL_STATUSES: OverallStatus[] = [
  'RECRUITING',
  'NOT_YET_RECRUITING',
  'ACTIVE_NOT_RECRUITING',
  'COMPLETED',
  'TERMINATED',
  'WITHDRAWN',
  'SUSPENDED',
  'UNKNOWN',
  'AVAILABLE',
  'NO_LONGER_AVAILABLE',
  'TEMPORARILY_NOT_AVAILABLE',
  'APPROVED_FOR_MARKETING',
  'WITHHELD',
]

const TUMOR_TYPES: TumorTypeFilter[] = [
  'any',
  'LUNG',
  'BREAST',
  'MELANOMA',
  'GBM',
  'OTHER_SOLID',
]

const SPECIFIC_TUMOR_TYPES: Array<Exclude<TumorTypeFilter, 'any' | 'OTHER_SOLID'>> = [
  'LUNG',
  'BREAST',
  'MELANOMA',
  'GBM',
]

const STUDY_TYPES: StudyTypeFilter[] = ['any', 'INTERVENTIONAL', 'OBSERVATIONAL']
const PHASE_SETS: PhaseFilter[][] = [
  [],
  ['PHASE1'],
  ['PHASE2'],
  ['PHASE3'],
  ['PHASE1', 'PHASE2'],
  ['PHASE1', 'PHASE3'],
  ['PHASE2', 'PHASE3'],
  ['PHASE1', 'PHASE2', 'PHASE3'],
]
const AGE_VALUES: Array<number | null> = [null, 18, 70]
const LOCATION_VALUES: Array<{ label: string; country: string | null; continent: string | null }> = [
  { label: 'anywhere', country: null, continent: null },
  { label: 'us', country: 'United States', continent: null },
  { label: 'europe', country: null, continent: 'Europe' },
]
const STATUS_VALUES: Array<{ label: string; statuses: OverallStatus[] }> = [
  { label: 'default', statuses: DEFAULT_RESULTS_STATUSES },
  { label: 'recruiting', statuses: ['RECRUITING'] },
  { label: 'not_yet_recruiting', statuses: ['NOT_YET_RECRUITING'] },
  { label: 'active_not_recruiting', statuses: ['ACTIVE_NOT_RECRUITING'] },
  { label: 'recruiting_active', statuses: ['RECRUITING', 'ACTIVE_NOT_RECRUITING'] },
  { label: 'recruiting_not_yet', statuses: ['RECRUITING', 'NOT_YET_RECRUITING'] },
  { label: 'not_yet_active', statuses: ['NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING'] },
  { label: 'all', statuses: ALL_STATUSES },
]

const ORACLE_LM_TERMS = [
  'leptomeningeal',
  'leptomeninges',
  'leptomeningeal disease',
  'leptomeningeal metastasis',
  'leptomeningeal metastases',
  'leptomeningeal carcinomatosis',
  'meningeal disease',
  'meningeal metastasis',
  'meningeal metastases',
  'meningeal carcinomatosis',
  'lmd',
]

const ORACLE_LM_EXCLUSION_TERMS = [
  'leptomeningeal',
  'leptomeninges',
]

const ORACLE_INCLUSION_NEGATIVE_PHRASES = [
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

const ORACLE_BRIEF_SUMMARY_EXCLUSION_PHRASES = [
  'cannot take part if the cancer cells have spread to the thin tissue covering the brain and spinal cord',
]

const ORACLE_EXCLUSION_MARKERS = [
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
  '\r\nexclusion:',
  '\nexclusion:',
]

const ORACLE_LM_PATTERN =
  /\b(?:lmd|leptomeningeal(?: disease| metastasis| metastases| carcinomatosis)?|leptomeninges|meningeal disease|meningeal metastasis|meningeal metastases|meningeal carcinomatosis)\b/i

const ORACLE_LM_CONTEXT_PATTERNS = [
  new RegExp(`patients? with[^.\\n;]{0,80}${ORACLE_LM_PATTERN.source}`, 'i'),
  new RegExp(`with[^.\\n;]{0,60}${ORACLE_LM_PATTERN.source}`, 'i'),
  new RegExp(`evidence of[^.\\n;]{0,60}${ORACLE_LM_PATTERN.source}`, 'i'),
  new RegExp(`diagnos(?:ed|is of)[^.\\n;]{0,60}${ORACLE_LM_PATTERN.source}`, 'i'),
  new RegExp(`newly diagnosed[^.\\n;]{0,60}${ORACLE_LM_PATTERN.source}`, 'i'),
  new RegExp(`${ORACLE_LM_PATTERN.source}[^.\\n;]{0,60}(patients?|cohort|confirmed|diagnosed|from)`, 'i'),
]

const TUMOR_KEYWORDS: Record<Exclude<TumorTypeFilter, 'any' | 'OTHER_SOLID'>, string[]> = {
  LUNG: [
    'non-small cell lung',
    'small cell lung',
    'nsclc',
    'sclc',
    'lung cancer',
    'lung carcinoma',
    'lung adenocarcinoma',
    'lung neoplasm',
    'pulmonary carcinoma',
  ],
  BREAST: [
    'breast cancer',
    'breast carcinoma',
    'breast neoplasm',
    'breast tumor',
    'breast tumour',
    'mammary carcinoma',
    'triple negative breast',
    'triple-negative breast',
    'her2-positive breast',
  ],
  MELANOMA: ['melanoma'],
  GBM: [
    'glioblastoma',
    'high-grade glioma',
    'high grade glioma',
    'grade iv glioma',
    'grade 4 glioma',
    'malignant glioma',
    'anaplastic astrocytoma',
  ],
}

const ORACLE_NON_SOLID_TERMS = [
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

const ORACLE_BROAD_SOLID_TERMS = [
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

const ORACLE_NON_OTHER_SOLID_TERMS = [
  ...ORACLE_NON_SOLID_TERMS,
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

const ORACLE_OTHER_SOLID_SITE_TERMS = [
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

type Scenario = {
  name: string
  params: SearchParams
}

type RegressionCase = {
  scenario: string
  mustInclude?: string[]
  mustExclude?: string[]
}

type Finding = {
  scenario: string
  nctId: string
  reason: string
}

type SearchRun = {
  results: Study[]
  truncated: boolean
}

type CriteriaSections = {
  inclusion: string
  exclusion: string
  sectionFound: boolean
}

type OracleResult = {
  include: boolean
  reason?: string
}

const REGRESSIONS: RegressionCase[] = [
  {
    scenario: 'default',
    mustInclude: ['NCT06016387', 'NCT05865990', 'NCT06026735', 'NCT06462222'],
    mustExclude: ['NCT05782374'],
  },
  {
    scenario: 'lung-default',
    mustInclude: ['NCT06663306', 'NCT06643000', 'NCT06861218'],
    mustExclude: ['NCT06016387', 'NCT04588545', 'NCT05782374', 'NCT03684980'],
  },
  {
    scenario: 'breast-default',
    mustInclude: ['NCT06810804', 'NCT04588545', 'NCT06016387'],
    mustExclude: ['NCT06663306', 'NCT06643000', 'NCT05782374', 'NCT03684980'],
  },
  {
    scenario: 'melanoma-default',
    mustInclude: ['NCT07414979'],
    mustExclude: ['NCT05782374', 'NCT03684980'],
  },
  {
    scenario: 'gbm-default',
    mustInclude: ['NCT04661384', 'NCT07193654'],
    mustExclude: ['NCT06663306', 'NCT06810804', 'NCT05782374', 'NCT03684980'],
  },
  {
    scenario: 'other-solid-default',
    mustInclude: ['NCT06462222', 'NCT07476781'],
    mustExclude: ['NCT05782374', 'NCT03684980', 'NCT07414979', 'NCT04988009', 'NCT04185038'],
  },
]

function buildParams(overrides: Partial<SearchParams> = {}): SearchParams {
  return {
    ...DEFAULT_SEARCH_PARAMS,
    ...overrides,
    statuses: overrides.statuses ? [...overrides.statuses] : [...DEFAULT_RESULTS_STATUSES],
    phases: overrides.phases ? [...overrides.phases] : [],
  }
}

function hasAnyTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    if (term === 'lmd') return /\blmd\b/i.test(text)
    return text.includes(term)
  })
}

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

function sortIds(studies: Study[]): string[] {
  return studies
    .map((study) => study.protocolSection.identificationModule.nctId)
    .sort()
}

function getStudyIdentityMap(studies: Study[]): Map<string, Study> {
  return new Map(
    studies.map((study) => [study.protocolSection.identificationModule.nctId, study])
  )
}

function getLmTextParts(study: Study) {
  const proto = study.protocolSection
  const briefTitle = proto.identificationModule?.briefTitle ?? ''
  const officialTitle = proto.identificationModule?.officialTitle ?? ''

  return {
    conditionsText: (proto.conditionsModule?.conditions ?? []).join(' ').toLowerCase(),
    titleText: [briefTitle, officialTitle].join(' ').toLowerCase(),
    summaryText: (proto.descriptionModule?.briefSummary ?? '').toLowerCase(),
    eligibilityText: (proto.eligibilityModule?.eligibilityCriteria ?? '').toLowerCase(),
  }
}

function getTumorText(study: Study): string {
  const proto = study.protocolSection
  const meshes = study.derivedSection?.conditionBrowseModule?.meshes?.map((mesh) => mesh.term) ?? []

  return [
    proto.conditionsModule?.conditions ?? [],
    proto.conditionsModule?.keywords ?? [],
    proto.identificationModule?.briefTitle ?? '',
    proto.identificationModule?.officialTitle ?? '',
    proto.descriptionModule?.briefSummary ?? '',
    meshes,
  ]
    .flat()
    .join(' ')
    .toLowerCase()
}

function splitEligibilityForOracle(text: string): CriteriaSections {
  if (!text) {
    return { inclusion: '', exclusion: '', sectionFound: false }
  }

  let splitIndex = -1
  for (const marker of ORACLE_EXCLUSION_MARKERS) {
    const idx = text.indexOf(marker)
    if (idx !== -1 && (splitIndex === -1 || idx < splitIndex)) {
      splitIndex = idx
    }
  }

  if (splitIndex === -1) {
    return { inclusion: text, exclusion: '', sectionFound: false }
  }

  return {
    inclusion: text.slice(0, splitIndex),
    exclusion: text.slice(splitIndex),
    sectionFound: true,
  }
}

function parseAgeToYears(ageStr: string | undefined | null): number | null {
  if (!ageStr || ageStr.trim() === '' || ageStr.trim().toLowerCase() === 'n/a') {
    return null
  }

  const match = ageStr.trim().match(/^(\d+(?:\.\d+)?)\s*(year|month|week|day)/i)
  if (!match) return null

  const value = Number.parseFloat(match[1])
  const unit = match[2].toLowerCase()

  if (unit.startsWith('year')) return value
  if (unit.startsWith('month')) return value / 12
  if (unit.startsWith('week')) return value / 52.1775
  if (unit.startsWith('day')) return value / 365.25

  return null
}

function isOracleAgeEligible(
  patientAge: number,
  minimumAgeStr: string | undefined | null,
  maximumAgeStr: string | undefined | null
): boolean {
  const minAge = parseAgeToYears(minimumAgeStr)
  const maxAge = parseAgeToYears(maximumAgeStr)

  if (minAge !== null && patientAge < minAge) return false
  if (maxAge !== null && patientAge > maxAge) return false
  return true
}

function oracleFilterTrial(study: Study, patientAge: number | null): OracleResult {
  const proto = study.protocolSection
  const { conditionsText, titleText, summaryText, eligibilityText } = getLmTextParts(study)
  const { inclusion, exclusion, sectionFound } = splitEligibilityForOracle(eligibilityText)

  if (patientAge !== null) {
    const minAgeStr = proto.eligibilityModule?.minimumAge
    const maxAgeStr = proto.eligibilityModule?.maximumAge
    if (!isOracleAgeEligible(patientAge, minAgeStr, maxAgeStr)) {
      return { include: false, reason: 'oracle age rule rejected study' }
    }
  }

  const hasConditionLmSignal = hasAnyTerm(conditionsText, ORACLE_LM_TERMS)
  const hasTitleLmSignal = hasAnyTerm(titleText, ORACLE_LM_TERMS)
  const hasSummaryLmSignal = matchesAnyPattern(summaryText, ORACLE_LM_CONTEXT_PATTERNS)
  const hasInclusionLmSignal = matchesAnyPattern(inclusion, ORACLE_LM_CONTEXT_PATTERNS)
  const hasDefinitiveLmSignal = hasConditionLmSignal || hasTitleLmSignal

  for (const phrase of ORACLE_INCLUSION_NEGATIVE_PHRASES) {
    if (inclusion.includes(phrase)) {
      return { include: false, reason: `oracle inclusion rule matched "${phrase}"` }
    }
  }

  for (const phrase of ORACLE_BRIEF_SUMMARY_EXCLUSION_PHRASES) {
    if (summaryText.includes(phrase)) {
      return { include: false, reason: 'oracle summary exclusion rule matched' }
    }
  }

  if (sectionFound && !hasDefinitiveLmSignal && hasAnyTerm(exclusion, ORACLE_LM_EXCLUSION_TERMS)) {
    return { include: false, reason: 'oracle exclusion-section rule rejected study' }
  }

  if (!(hasDefinitiveLmSignal || hasSummaryLmSignal || hasInclusionLmSignal)) {
    return { include: false, reason: 'oracle found no explicit leptomeningeal signal' }
  }

  return { include: true }
}

function oracleHasTumorEvidence(
  study: Study,
  tumorType: Exclude<TumorTypeFilter, 'any' | 'OTHER_SOLID'>
): boolean {
  return hasAnyTerm(getTumorText(study), TUMOR_KEYWORDS[tumorType])
}

function oracleFilterByTumorType(study: Study, tumorType: TumorTypeFilter): OracleResult {
  if (tumorType === 'any') return { include: true }

  const tumorText = getTumorText(study)
  const matchedSpecificTumors = SPECIFIC_TUMOR_TYPES.filter((type) =>
    hasAnyTerm(tumorText, TUMOR_KEYWORDS[type])
  )

  if (tumorType === 'OTHER_SOLID') {
    if (matchedSpecificTumors.length > 0) {
      return { include: false, reason: 'oracle other-solid rule rejected tumor-specific study' }
    }
    if (hasAnyTerm(tumorText, ORACLE_NON_OTHER_SOLID_TERMS)) {
      return { include: false, reason: 'oracle other-solid rule rejected non-solid or primary-CNS study' }
    }
    if (
      hasAnyTerm(tumorText, ORACLE_BROAD_SOLID_TERMS) ||
      hasAnyTerm(tumorText, ORACLE_OTHER_SOLID_SITE_TERMS)
    ) {
      return { include: true }
    }
    return { include: false, reason: 'oracle other-solid rule found no solid-tumor evidence' }
  }

  if (!oracleHasTumorEvidence(study, tumorType)) {
    return {
      include: false,
      reason: `oracle tumor rule found no ${tumorType.toLowerCase()} evidence`,
    }
  }

  return { include: true }
}

function passesServerSideFilters(study: Study, params: SearchParams): boolean {
  const proto = study.protocolSection

  if (params.statuses.length > 0) {
    const status = proto.statusModule.overallStatus
    if (!params.statuses.includes(status)) return false
  }

  if (params.studyType !== 'any' && proto.designModule.studyType !== params.studyType) {
    return false
  }

  if (params.phases.length > 0) {
    const studyPhases = proto.designModule.phases ?? []
    const hasPhaseMatch = studyPhases.some((phase) => params.phases.includes(phase as PhaseFilter))
    if (!hasPhaseMatch) return false
  }

  if (params.country) {
    const locations = proto.contactsLocationsModule?.locations ?? []
    const hasCountryMatch = locations.some((loc) => loc.country === params.country)
    if (!hasCountryMatch) return false
  }

  return true
}

function passesContinentFilter(study: Study, params: SearchParams): boolean {
  if (!params.continent) return true

  const allowedCountries = CONTINENT_COUNTRIES[params.continent] ?? []
  const locations = study.protocolSection.contactsLocationsModule?.locations ?? []
  return locations.some((loc) => loc.country && allowedCountries.includes(loc.country))
}

function passesAppFilters(study: Study, params: SearchParams): boolean {
  if (!passesServerSideFilters(study, params)) return false
  if (!passesContinentFilter(study, params)) return false

  const ageResult = filterTrial(study, params.age)
  if (!ageResult.include) return false
  if (!filterByTumorType(study, params.tumorType)) return false
  return true
}

function passesOracleFilters(study: Study, params: SearchParams): OracleResult {
  if (!passesServerSideFilters(study, params)) {
    return { include: false, reason: 'oracle server-side filters rejected study' }
  }

  if (!passesContinentFilter(study, params)) {
    return { include: false, reason: 'oracle continent filter rejected study' }
  }

  const manualAuditOverride = getManualAuditOverride(
    study.protocolSection.identificationModule.nctId
  )
  if (manualAuditOverride) {
    if (params.age !== null) {
      const minAgeStr = study.protocolSection.eligibilityModule?.minimumAge
      const maxAgeStr = study.protocolSection.eligibilityModule?.maximumAge
      if (!isOracleAgeEligible(params.age, minAgeStr, maxAgeStr)) {
        return { include: false, reason: 'oracle age rule rejected study' }
      }
    }

    if (!manualAuditOverride.siteEligible) {
      return { include: false, reason: 'manual audit override rejected study' }
    }

    if (
      params.tumorType !== 'any' &&
      !manualAuditOverride.tumorLabels.includes(params.tumorType as Exclude<TumorTypeFilter, 'any'>)
    ) {
      return { include: false, reason: 'manual audit override rejected tumor label' }
    }

    return { include: true }
  }

  const lmResult = oracleFilterTrial(study, params.age)
  if (!lmResult.include) return lmResult

  const tumorResult = oracleFilterByTumorType(study, params.tumorType)
  if (!tumorResult.include) return tumorResult

  return { include: true }
}

function projectAppResults(universe: Study[], params: SearchParams): Study[] {
  return universe.filter((study) => passesAppFilters(study, params))
}

function projectOracleResults(universe: Study[], params: SearchParams): Study[] {
  return universe.filter((study) => passesOracleFilters(study, params).include)
}

function projectServerFilteredUniverse(universe: Study[], params: SearchParams): Study[] {
  return universe.filter((study) => passesServerSideFilters(study, params))
}

function makeScenarioName(params: SearchParams): string {
  const parts = [
    `tumor=${params.tumorType}`,
    `study=${params.studyType}`,
    `phases=${params.phases.length ? params.phases.join('+') : 'any'}`,
    `age=${params.age ?? 'any'}`,
    params.continent ? `continent=${params.continent}` : `country=${params.country ?? 'any'}`,
    `statuses=${params.statuses.join('+')}`,
  ]
  return parts.join(' | ')
}

function buildExhaustiveScenarios(): Scenario[] {
  const scenarios: Scenario[] = []

  for (const tumorType of TUMOR_TYPES) {
    for (const studyType of STUDY_TYPES) {
      for (const phases of PHASE_SETS) {
        for (const age of AGE_VALUES) {
          for (const location of LOCATION_VALUES) {
            for (const statusSet of STATUS_VALUES) {
              const params = buildParams({
                tumorType,
                studyType,
                phases,
                age,
                country: location.country,
                continent: location.continent,
                statuses: statusSet.statuses,
              })

              scenarios.push({
                name: makeScenarioName(params),
                params,
              })
            }
          }
        }
      }
    }
  }

  return scenarios
}

function buildSmokeScenarios(): Scenario[] {
  return [
    { name: 'default', params: buildParams({}) },
    { name: 'lung-default', params: buildParams({ tumorType: 'LUNG' }) },
    { name: 'breast-default', params: buildParams({ tumorType: 'BREAST' }) },
    { name: 'melanoma-default', params: buildParams({ tumorType: 'MELANOMA' }) },
    { name: 'gbm-default', params: buildParams({ tumorType: 'GBM' }) },
    { name: 'other-solid-default', params: buildParams({ tumorType: 'OTHER_SOLID' }) },
    {
      name: 'lung-interventional-phase1-us',
      params: buildParams({
        tumorType: 'LUNG',
        studyType: 'INTERVENTIONAL',
        phases: ['PHASE1'],
        country: 'United States',
      }),
    },
    {
      name: 'breast-observational-europe-age18',
      params: buildParams({
        tumorType: 'BREAST',
        studyType: 'OBSERVATIONAL',
        age: 18,
        continent: 'Europe',
      }),
    },
    {
      name: 'melanoma-phase2-age70',
      params: buildParams({
        tumorType: 'MELANOMA',
        phases: ['PHASE2'],
        age: 70,
      }),
    },
    {
      name: 'gbm-phase3-all-statuses',
      params: buildParams({
        tumorType: 'GBM',
        phases: ['PHASE3'],
        statuses: ALL_STATUSES,
      }),
    },
  ]
}

async function fetchJson(apiUrl: string): Promise<ApiResponse> {
  const cached = await readCachedResponse(apiUrl, false)
  if (cached) return cached

  for (let attempt = 0; attempt < FETCH_RETRIES; attempt += 1) {
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Leptomeningeal-validator/1.0',
      },
    })

    if (response.ok) {
      const payload = (await response.json()) as ApiResponse
      await writeCachedResponse(apiUrl, payload)
      return payload
    }

    if (response.status === 429 && attempt < FETCH_RETRIES - 1) {
      await sleep(1500 * 2 ** attempt)
      continue
    }

    const staleCached = await readCachedResponse(apiUrl, true)
    if (staleCached) {
      return staleCached
    }

    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`ClinicalTrials.gov API error ${response.status}: ${errorText}`)
  }

  const staleCached = await readCachedResponse(apiUrl, true)
  if (staleCached) {
    return staleCached
  }

  throw new Error(`ClinicalTrials.gov API error: exhausted retries for ${apiUrl}`)
}

async function readCachedResponse(apiUrl: string, allowStale: boolean): Promise<ApiResponse | null> {
  const cachePath = getCachePath(apiUrl)

  try {
    const meta = await stat(cachePath)
    if (!allowStale && Date.now() - meta.mtimeMs > CACHE_MAX_AGE_MS) {
      return null
    }

    const raw = await readFile(cachePath, 'utf8')
    return JSON.parse(raw) as ApiResponse
  } catch {
    return null
  }
}

async function writeCachedResponse(apiUrl: string, payload: ApiResponse): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(getCachePath(apiUrl), JSON.stringify(payload))
}

function getCachePath(apiUrl: string): string {
  const hash = createHash('sha256').update(apiUrl).digest('hex')
  return join(CACHE_DIR, `${hash}.json`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchRawSearchResults(params: SearchParams): Promise<SearchRun> {
  const seen = new Set<string>()
  const results: Study[] = []
  let condToken: string | undefined
  let termToken: string | undefined

  const addStudies = (studies: Study[]) => {
    for (const study of studies) {
      const id = study.protocolSection.identificationModule.nctId
      if (seen.has(id)) continue
      seen.add(id)
      results.push(study)
    }
  }

  const [condData, termData] = await Promise.all([
    fetchJson(buildCondUrl(params)),
    fetchJson(buildTermUrl(params)),
  ])

  condToken = condData.nextPageToken
  termToken = termData.nextPageToken
  addStudies(condData.studies ?? [])
  addStudies(termData.studies ?? [])

  for (let page = 1; page < MAX_PAGES; page += 1) {
    if (!condToken && !termToken) break

    const pending: Array<'cond' | 'term'> = []
    const fetches: Promise<ApiResponse>[] = []

    if (condToken) {
      pending.push('cond')
      fetches.push(fetchJson(buildCondUrl(params, condToken)))
    }
    if (termToken) {
      pending.push('term')
      fetches.push(fetchJson(buildTermUrl(params, termToken)))
    }

    const responses = await Promise.all(fetches)

    for (const [index, value] of responses.entries()) {
      if (pending[index] === 'cond') {
        condToken = value.nextPageToken
        addStudies(value.studies ?? [])
      } else {
        termToken = value.nextPageToken
        addStudies(value.studies ?? [])
      }
    }
  }

  return {
    results,
    truncated: Boolean(condToken || termToken),
  }
}

function compareIdSets(
  scenario: string,
  expectedIds: string[],
  actualIds: string[],
  missingReason: string,
  extraReason: string
): Finding[] {
  const findings: Finding[] = []
  const expectedSet = new Set(expectedIds)
  const actualSet = new Set(actualIds)

  for (const id of expectedIds) {
    if (!actualSet.has(id)) {
      findings.push({ scenario, nctId: id, reason: missingReason })
    }
  }

  for (const id of actualIds) {
    if (!expectedSet.has(id)) {
      findings.push({ scenario, nctId: id, reason: extraReason })
    }
  }

  return findings
}

function validateRegressions(scenarioName: string, projected: Study[]): Finding[] {
  const regression = REGRESSIONS.find((entry) => entry.scenario === scenarioName)
  if (!regression) return []

  const ids = new Set(sortIds(projected))
  const findings: Finding[] = []

  for (const mustInclude of regression.mustInclude ?? []) {
    if (!ids.has(mustInclude)) {
      findings.push({
        scenario: scenarioName,
        nctId: mustInclude,
        reason: 'missing required regression study',
      })
    }
  }

  for (const mustExclude of regression.mustExclude ?? []) {
    if (ids.has(mustExclude)) {
      findings.push({
        scenario: scenarioName,
        nctId: mustExclude,
        reason: 'unexpectedly included regression study',
      })
    }
  }

  return findings
}

function validateLocalScenario(
  scenario: Scenario,
  universe: Study[]
): { oracleMismatches: Finding[]; regressionFailures: Finding[] } {
  const appProjected = projectAppResults(universe, scenario.params)
  const oracleProjected = projectOracleResults(universe, scenario.params)

  const oracleMismatches = compareIdSets(
    scenario.name,
    sortIds(oracleProjected),
    sortIds(appProjected),
    'oracle included study but app omitted it',
    'app included study but oracle rejected it'
  )

  const regressionFailures = validateRegressions(scenario.name, appProjected)
  return { oracleMismatches, regressionFailures }
}

async function validateLiveScenario(
  scenario: Scenario,
  universe: Study[]
): Promise<{ queryMismatches: Finding[] }> {
  const liveRun = await fetchRawSearchResults(scenario.params)
  if (liveRun.truncated) {
    return {
      queryMismatches: [
        {
          scenario: scenario.name,
          nctId: '*',
          reason: 'live query truncated before comparison',
        },
      ],
    }
  }

  const expectedQueryIds = sortIds(projectServerFilteredUniverse(universe, scenario.params))
  const liveIds = sortIds(liveRun.results)
  return {
    queryMismatches: compareIdSets(
      scenario.name,
      expectedQueryIds,
      liveIds,
      'present in local universe projection but missing from live raw query',
      'present in live raw query but missing from local universe projection'
    ),
  }
}

function summarizeFindings(findings: Finding[], label: string): void {
  if (findings.length === 0) return

  console.log('')
  console.log(`${label}:`)
  for (const finding of findings.slice(0, 20)) {
    console.log(`- ${finding.scenario}: ${finding.nctId} -> ${finding.reason}`)
  }
  if (findings.length > 20) {
    console.log(`- ... ${findings.length - 20} more`)
  }
}

function parseArgs(argv: string[]) {
  return {
    liveAll: argv.includes('--live-all'),
    json: argv.includes('--json'),
    help: argv.includes('--help') || argv.includes('-h'),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('Usage: npx tsx scripts/validate-trials.ts [--live-all] [--json]')
    console.log('  --live-all  Run every exhaustive matrix scenario against the live API.')
    console.log('  --json      Emit a machine-readable summary line at the end.')
    return
  }

  console.log('Fetching LM universe from ClinicalTrials.gov...')
  const universeRun = await fetchRawSearchResults(buildParams({ statuses: ALL_STATUSES }))
  console.log(`Universe size: ${universeRun.results.length} studies${universeRun.truncated ? ' (truncated)' : ''}`)

  if (universeRun.truncated) {
    throw new Error('LM universe fetch truncated before validation completed')
  }

  const exhaustiveScenarios = buildExhaustiveScenarios()
  const liveScenarios = args.liveAll ? exhaustiveScenarios : buildSmokeScenarios()

  console.log(`Validating ${exhaustiveScenarios.length} local matrix scenarios against an independent oracle`)
  console.log(`Running ${liveScenarios.length} live query comparisons`)

  const allOracleMismatches: Finding[] = []
  const allRegressionFailures: Finding[] = []

  for (const scenario of exhaustiveScenarios) {
    const { oracleMismatches, regressionFailures } = validateLocalScenario(
      scenario,
      universeRun.results
    )
    allOracleMismatches.push(...oracleMismatches)
    allRegressionFailures.push(...regressionFailures)
  }

  const allQueryMismatches: Finding[] = []
  for (const [index, scenario] of liveScenarios.entries()) {
    if (args.liveAll && index > 0 && index % 250 === 0) {
      console.log(`Live comparisons completed: ${index}/${liveScenarios.length}`)
    }

    const { queryMismatches } = await validateLiveScenario(scenario, universeRun.results)
    allQueryMismatches.push(...queryMismatches)
  }

  console.log('')
  console.log('Summary')
  console.log(`- universe studies: ${universeRun.results.length}`)
  console.log(`- exhaustive scenarios: ${exhaustiveScenarios.length}`)
  console.log(`- live scenarios: ${liveScenarios.length}`)
  console.log(`- oracle mismatches: ${allOracleMismatches.length}`)
  console.log(`- regression failures: ${allRegressionFailures.length}`)
  console.log(`- query mismatches: ${allQueryMismatches.length}`)

  summarizeFindings(allOracleMismatches, 'Oracle mismatches')
  summarizeFindings(allRegressionFailures, 'Regression failures')
  summarizeFindings(allQueryMismatches, 'Query mismatches')

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          universe: universeRun.results.length,
          exhaustiveScenarios: exhaustiveScenarios.length,
          liveScenarios: liveScenarios.length,
          oracleMismatches: allOracleMismatches.length,
          regressionFailures: allRegressionFailures.length,
          queryMismatches: allQueryMismatches.length,
        },
        null,
        2
      )
    )
  }

  if (allOracleMismatches.length || allRegressionFailures.length || allQueryMismatches.length) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
