import type { ApiResponse, SearchParams, OverallStatus } from '../types/trial'
import { COUNTRIES } from '../constants/countries'

const BASE_URL = 'https://clinicaltrials.gov/api/v2/studies'

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

/**
 * Shared filter/pagination params appended to every query URL.
 * Applies status, study type, phase, and country filters at the API level.
 * Age filtering is client-side only (API stores ages as strings like "18 Years").
 */
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

/**
 * QUERY A — condition field search.
 * query.cond uses MeSH synonym expansion, so "leptomeningeal metastasis" also
 * matches trials listed under "Meningeal Metastasis", "Leptomeningeal
 * Carcinomatosis", etc.
 */
export function buildCondUrl(params: SearchParams, pageToken?: string): string {
  validateParams(params)
  const url = new URLSearchParams()
  url.set('query.cond', 'leptomeningeal metastasis')
  appendCommonParams(url, params, pageToken)
  return `${BASE_URL}?${url.toString()}`
}

/**
 * QUERY B — full-text search across ALL fields.
 * query.term finds trials where "leptomeningeal" appears in eligibility
 * criteria, descriptions, or titles — catching brain-metastasis trials that
 * include LM patients without listing it as the primary condition.
 */
export function buildTermUrl(params: SearchParams, pageToken?: string): string {
  validateParams(params)
  const url = new URLSearchParams()
  url.set('query.term', 'leptomeningeal')
  appendCommonParams(url, params, pageToken)
  return `${BASE_URL}?${url.toString()}`
}

async function doFetch(apiUrl: string): Promise<ApiResponse> {
  const response = await fetch(apiUrl, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`ClinicalTrials.gov API error ${response.status}: ${errorText}`)
  }
  return response.json() as Promise<ApiResponse>
}

export function fetchCondStudies(params: SearchParams, pageToken?: string): Promise<ApiResponse> {
  return doFetch(buildCondUrl(params, pageToken))
}

export function fetchTermStudies(params: SearchParams, pageToken?: string): Promise<ApiResponse> {
  return doFetch(buildTermUrl(params, pageToken))
}

/**
 * Returns the direct ClinicalTrials.gov study URL for an NCT ID.
 */
export function getTrialUrl(nctId: string): string {
  return `https://clinicaltrials.gov/study/${nctId}`
}

/**
 * Default search parameters — recruiting trials of any type/phase worldwide.
 */
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
