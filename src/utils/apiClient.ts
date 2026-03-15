import type { ApiResponse, SearchParams, OverallStatus } from '../types/trial'

const BASE_URL = 'https://clinicaltrials.gov/api/v2/studies'

/**
 * Builds the ClinicalTrials.gov API v2 URL from search parameters.
 *
 * Core query always uses:
 *   query.cond=leptomeningeal metastasis (179 results as of Mar 2026)
 *
 * Optional filters applied at API level to reduce data transfer:
 *   - filter.overallStatus (status list)
 *   - filter.advanced with AREA[] syntax for studyType, phase, country
 *
 * Age filtering is handled entirely client-side since the API stores ages
 * as strings ("18 Years") which cannot be reliably range-queried.
 */
export function buildApiUrl(params: SearchParams, pageToken?: string): string {
  const url = new URLSearchParams()

  // Core condition search — always applied
  url.set('query.cond', 'leptomeningeal metastasis')
  url.set('format', 'json')
  url.set('pageSize', '20')
  url.set('countTotal', 'true')

  if (pageToken) {
    url.set('pageToken', pageToken)
  }

  // Status filter
  if (params.statuses.length > 0) {
    url.set('filter.overallStatus', params.statuses.join(','))
  }

  // Build filter.advanced parts
  const advancedParts: string[] = []

  // Study type filter
  if (params.studyType !== 'any') {
    advancedParts.push(`AREA[StudyType]${params.studyType}`)
  }

  // Phase filter — one or more phases combined with OR
  if (params.phases.length > 0) {
    if (params.phases.length === 1) {
      advancedParts.push(`AREA[Phase]${params.phases[0]}`)
    } else {
      const phaseOr = params.phases.map((p) => `AREA[Phase]${p}`).join(' OR ')
      advancedParts.push(`(${phaseOr})`)
    }
  }

  // Country filter
  if (params.country) {
    // Escape the country name for the AREA filter
    const safeCountry = params.country.replace(/[()]/g, '')
    advancedParts.push(`AREA[LocationCountry]${safeCountry}`)
  }

  if (advancedParts.length > 0) {
    url.set('filter.advanced', advancedParts.join(' AND '))
  }

  return `${BASE_URL}?${url.toString()}`
}

/**
 * Fetches a page of studies from ClinicalTrials.gov API v2.
 * Throws on network errors or non-OK HTTP responses.
 */
export async function fetchStudies(
  params: SearchParams,
  pageToken?: string
): Promise<ApiResponse> {
  const apiUrl = buildApiUrl(params, pageToken)

  const response = await fetch(apiUrl, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(
      `ClinicalTrials.gov API error ${response.status}: ${errorText}`
    )
  }

  const data = await response.json()
  return data as ApiResponse
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
  statuses: DEFAULT_STATUSES,
}
