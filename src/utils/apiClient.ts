import type { ApiResponse, SearchParams, OverallStatus, Study } from '../types/trial'
import { COUNTRIES } from '../constants/countries'
import { assertRegistryPage, assertRegistryStudy } from './registryResponse'
import { fetchAllStudies } from './fetchAllStudies'

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

// Age filtering is client-side. The API stores ages as strings like "18 Years"
function appendCommonParams(
  url: URLSearchParams,
  params: SearchParams,
  pageToken?: string
) {
  url.set('format', 'json')
  // bigger pages = fewer requests that can fail halfway through a search
  url.set('pageSize', '100')

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

// query.cond uses MeSH synonym expansion for "leptomeningeal metastasis", matching
// "Meningeal Metastasis", "Leptomeningeal Carcinomatosis", etc.
export function buildCondUrl(params: SearchParams, pageToken?: string): string {
  validateParams(params)
  const url = new URLSearchParams()
  url.set('query.cond', 'leptomeningeal metastasis')
  appendCommonParams(url, params, pageToken)
  return `${BASE_URL}?${url.toString()}`
}

// query.term searches all fields. It catches brain-metastasis trials that include LM
// patients in eligibility criteria without listing LM as the primary condition.
export function buildTermUrl(params: SearchParams, pageToken?: string): string {
  validateParams(params)
  const url = new URLSearchParams()
  url.set('query.term', 'leptomeningeal')
  appendCommonParams(url, params, pageToken)
  return `${BASE_URL}?${url.toString()}`
}

export const SUPPLEMENTAL_AUDITED_STUDY_IDS = [
  'NCT00003406',
  'NCT00667615',
  'NCT01527149',
  'NCT01977209',
  'NCT03215095',
  'NCT03283137',
  'NCT03401853',
  'NCT05807893',
  'NCT05984108',
  'NCT06492915',

  'NCT02446457',
  'NCT02535247',
  'NCT03360929',
  'NCT07362940',
  'NCT07502027',

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
  'NCT00276783',
  'NCT01269853',
  'NCT01625234',
  'NCT02929862',
  'NCT03093116',
  'NCT03202940',
  'NCT03911388',
  'NCT04025541',
  'NCT04094688',
  'NCT04301076',
  'NCT04458922',
  'NCT04500548',
  'NCT04527549',
  'NCT04903678',
  'NCT05259540',
  'NCT05617885',
  'NCT05800249',
  'NCT05904080',
  'NCT06161558',
  'NCT07050186',
  'NCT07361562',
  'NCT07365410',
  'NCT07506239',
  'NCT07594002',
  'NCT07603856',
  'NCT07647432',
  'NCT07649304',
  'NCT07681297',
  'NCT07695311',
  'NCT07714395',
  'NCT07724457',
  'NCT07827001',
  'NCT00002578',
  'NCT02693535',
  'NCT03816345',
  'NCT04181060',
  'NCT04757779',
  'NCT04978727',
  'NCT05359211',
  'NCT05422794',
  'NCT06102902',
  'NCT06211114',
  'NCT06422806',
  'NCT06465316',
  'NCT06589804',
  'NCT06610682',
  'NCT06896188',
  'NCT07415005',
  'NCT07426484',
  'NCT07431073',
  'NCT07444710',
  'NCT07447076',
  'NCT07624201',
  'NCT05843253',
  'NCT05372614',
  'NCT04739358',
  'NCT05388877',
  'NCT02971501',
  'NCT02838420',
  'NCT07612488',
  'NCT00570908',
  'NCT03053297',
  'NCT05991518',
] as const

// retries network errors, 429s and 5xxs with exponential backoff
export async function fetchRegistryJson(apiUrl: string, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(30_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt += 1) {
    requestSignal.throwIfAborted()
    let response: Response
    try {
      response = await fetch(apiUrl, {
        headers: { Accept: 'application/json' },
        signal: requestSignal,
      })
    } catch (error) {
      requestSignal.throwIfAborted()
      if (attempt === FETCH_RETRIES - 1) throw error
      await waitForRetry(1000 * 2 ** attempt, requestSignal)
      continue
    }
    if (response.ok) return response.json()
    if ((response.status === 429 || response.status >= 500) && attempt < FETCH_RETRIES - 1) {
      await waitForRetry(1000 * 2 ** attempt, requestSignal)
      continue
    }
    throw new Error(`ClinicalTrials.gov is unavailable (HTTP ${response.status}). Please try again.`)
  }
  throw new Error('ClinicalTrials.gov API error: exhausted retries')
}

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function fetchRegistryPage(apiUrl: string, signal?: AbortSignal): Promise<ApiResponse> {
  const response = await fetchRegistryJson(apiUrl, signal)
  assertRegistryPage(response)
  return response
}

export function fetchCondStudies(params: SearchParams, pageToken?: string, signal?: AbortSignal): Promise<ApiResponse> {
  return fetchRegistryPage(buildCondUrl(params, pageToken), signal)
}

export function fetchTermStudies(params: SearchParams, pageToken?: string, signal?: AbortSignal): Promise<ApiResponse> {
  return fetchRegistryPage(buildTermUrl(params, pageToken), signal)
}

export async function fetchStudyById(nctId: string, signal?: AbortSignal): Promise<Study> {
  if (!/^NCT\d{8}$/.test(nctId)) throw new Error('Invalid study ID')
  const study = await fetchRegistryJson(`${BASE_URL}/${nctId}`, signal)
  assertRegistryStudy(study)
  if (study.protocolSection.identificationModule.nctId !== nctId) throw new Error('ClinicalTrials.gov returned the wrong study ID')
  return study
}

export async function fetchSupplementalAuditedStudies(signal?: AbortSignal): Promise<Study[]> {
  const url = new URL(`${BASE_URL}`)
  url.searchParams.set('format', 'json')
  url.searchParams.set('pageSize', '100')
  url.searchParams.set('query.id', SUPPLEMENTAL_AUDITED_STUDY_IDS.join(' OR '))
  const studies = await fetchAllStudies((pageToken) => {
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    return fetchRegistryPage(url.toString(), signal)
  })
  const byId = new Map(studies.map((study) => [study.protocolSection.identificationModule.nctId, study]))
  const missing = SUPPLEMENTAL_AUDITED_STUDY_IDS.filter((id) => !byId.has(id))
  if (missing.length) throw new Error(`ClinicalTrials.gov omitted ${missing.length} audited studies. Please try again.`)
  return [...byId.values()]
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
