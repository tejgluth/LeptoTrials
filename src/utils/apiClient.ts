import type { ApiResponse, SearchParams, OverallStatus, Study } from '../types/trial'
import { COUNTRIES } from '../constants/countries'

const BASE_URL = 'https://clinicaltrials.gov/api/v2/studies'
const FETCH_RETRIES = 4

const ALLOWED_STUDY_TYPES = new Set(['any', 'INTERVENTIONAL', 'OBSERVATIONAL'])
const ALLOWED_PHASES = new Set(['PHASE1', 'PHASE2', 'PHASE3', 'PHASE4', 'EARLY_PHASE1', 'NA'])
const ALLOWED_COUNTRIES = new Set<string>(COUNTRIES)

function validateParams(params: SearchParams): void {
  if (!ALLOWED_STUDY_TYPES.has(params.studyType)) {
    throw new Error('Invalid study type')
  }
  for (const phase of params.phases) {
    if (!ALLOWED_PHASES.has(phase)) throw new Error('Invalid phase value')
  }
  if (params.country !== null && !ALLOWED_COUNTRIES.has(params.country)) {
    throw new Error('Invalid country')
  }
}

// Age filtering is client-side — the API stores ages as strings like "18 Years"
function appendCommonParams(
  url: URLSearchParams,
  params: SearchParams,
  pageToken?: string
) {
  url.set('format', 'json')
  url.set('pageSize', '20')

  if (pageToken) url.set('pageToken', pageToken)

  if (params.statuses.length > 0) {
    url.set('filter.overallStatus', params.statuses.join(','))
  }

  const advancedParts: string[] = []

  if (params.studyType !== 'any') {
    advancedParts.push(`AREA[StudyType]${params.studyType}`)
  }

  if (params.phases.length > 0) {
    if (params.phases.length === 1) {
      advancedParts.push(`AREA[Phase]${params.phases[0]}`)
    } else {
      const phaseOr = params.phases.map((p) => `AREA[Phase]${p}`).join(' OR ')
      advancedParts.push(`(${phaseOr})`)
    }
  }

  if (params.country) {
    advancedParts.push(`AREA[LocationCountry]${params.country.replace(/[()]/g, '')}`)
  }

  if (advancedParts.length > 0) {
    url.set('filter.advanced', advancedParts.join(' AND '))
  }
}

// query.cond uses MeSH synonym expansion — "leptomeningeal metastasis" also matches
// "Meningeal Metastasis", "Leptomeningeal Carcinomatosis", etc.
export function buildCondUrl(params: SearchParams, pageToken?: string): string {
  validateParams(params)
  const url = new URLSearchParams()
  url.set('query.cond', 'leptomeningeal metastasis')
  appendCommonParams(url, params, pageToken)
  return `${BASE_URL}?${url.toString()}`
}

// query.term searches all fields — catches brain-metastasis trials that include LM
// patients in eligibility criteria without listing LM as the primary condition.
export function buildTermUrl(params: SearchParams, pageToken?: string): string {
  validateParams(params)
  const url = new URLSearchParams()
  url.set('query.term', 'leptomeningeal')
  appendCommonParams(url, params, pageToken)
  return `${BASE_URL}?${url.toString()}`
}

export const SUPPLEMENTAL_AUDITED_STUDY_IDS = [
  'NCT00221325',
  'NCT00310128',
  'NCT00749723',
  'NCT01970865',
  'NCT02329080',
  'NCT02542514',
  'NCT02590510',
  'NCT02886585',
  'NCT02896335',
  'NCT03434262',
  'NCT03574402',
  'NCT04509596',
  'NCT04511013',
  'NCT04543188',
  'NCT04856475',
  'NCT04965090',
  'NCT05497076',
  'NCT05967689',
  'NCT06361589',
  'NCT06705049',
  'NCT07178938',
] as const

async function doFetch<T>(apiUrl: string): Promise<T> {
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt += 1) {
    const response = await fetch(apiUrl, { headers: { Accept: 'application/json' } })
    if (response.ok) return response.json() as Promise<T>

    const shouldRetry = response.status === 429 || response.status >= 500
    if (shouldRetry && attempt < FETCH_RETRIES - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
      continue
    }

    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`ClinicalTrials.gov API error ${response.status}: ${errorText}`)
  }

  throw new Error('ClinicalTrials.gov API error: exhausted retries')
}

export function fetchCondStudies(params: SearchParams, pageToken?: string): Promise<ApiResponse> {
  return doFetch(buildCondUrl(params, pageToken))
}

export function fetchTermStudies(params: SearchParams, pageToken?: string): Promise<ApiResponse> {
  return doFetch(buildTermUrl(params, pageToken))
}

export function fetchStudyById(nctId: string): Promise<Study> {
  return doFetch(`${BASE_URL}/${nctId}`)
}

export function fetchSupplementalAuditedStudies(): Promise<Study[]> {
  const url = new URLSearchParams()
  url.set('format', 'json')
  url.set('pageSize', '100')
  url.set('query.id', SUPPLEMENTAL_AUDITED_STUDY_IDS.join(' OR '))
  return doFetch<ApiResponse>(`${BASE_URL}?${url.toString()}`).then((response) => response.studies ?? [])
}

export function getTrialUrl(nctId: string): string {
  return `https://clinicaltrials.gov/study/${nctId}`
}

export const DEFAULT_STATUSES: OverallStatus[] = [
  'RECRUITING',
  'NOT_YET_RECRUITING',
  'ACTIVE_NOT_RECRUITING',
]

export const DEFAULT_SEARCH_PARAMS: SearchParams = {
  age: null,
  studyType: 'any',
  phases: [],
  country: null,
  continent: null,
  statuses: DEFAULT_STATUSES,
  tumorType: 'any',
}
