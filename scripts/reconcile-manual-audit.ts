import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildCondUrl, buildTermUrl, DEFAULT_SEARCH_PARAMS } from '../src/utils/apiClient'
import { CONTINENT_COUNTRIES } from '../src/constants/countries'
import { filterByTumorType, filterTrial } from '../src/utils/trialFilter'
import type {
  ApiResponse,
  OverallStatus,
  PhaseFilter,
  SearchParams,
  Study,
  TumorTypeFilter,
} from '../src/types/trial'

const REVIEW_DIR = join(process.cwd(), 'audit', 'manual-review')
const CACHE_DIR = join(process.cwd(), '.cache', 'manual-audit-reconcile')
const CACHE_MAX_AGE_MS = 1000 * 60 * 60 * 6
const FETCH_RETRIES = 5
const MAX_PAGES = 20
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

const TUMOR_TYPES: Array<Exclude<TumorTypeFilter, 'any'>> = [
  'LUNG',
  'BREAST',
  'MELANOMA',
  'GBM',
  'OTHER_SOLID',
]

type ReviewEntry = {
  nctId: string
  briefTitle: string
  siteEligible: boolean | null
  tumorLabels: string[]
  confidence: string
  rationale: string
}

type ReviewFile = {
  batch: number
  reviews: ReviewEntry[]
}

type Finding = {
  nctId: string
  reason: string
}

function buildParams(overrides: Partial<SearchParams> = {}): SearchParams {
  return {
    ...DEFAULT_SEARCH_PARAMS,
    ...overrides,
    statuses: overrides.statuses ? [...overrides.statuses] : [...ALL_STATUSES],
    phases: overrides.phases ? [...overrides.phases] : [],
  }
}

async function fetchJson(url: string): Promise<ApiResponse> {
  const cached = await readCachedResponse(url, false)
  if (cached) return cached

  for (let attempt = 0; attempt < FETCH_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Leptomeningeal-manual-audit/1.0',
      },
    })

    if (response.ok) {
      const payload = (await response.json()) as ApiResponse
      await writeCachedResponse(url, payload)
      return payload
    }

    if (response.status === 429 && attempt < FETCH_RETRIES - 1) {
      await sleep(1500 * 2 ** attempt)
      continue
    }

    const stale = await readCachedResponse(url, true)
    if (stale) return stale

    const text = await response.text().catch(() => 'Unknown error')
    throw new Error(`ClinicalTrials.gov API error ${response.status}: ${text}`)
  }

  const stale = await readCachedResponse(url, true)
  if (stale) return stale
  throw new Error(`ClinicalTrials.gov API error: exhausted retries for ${url}`)
}

async function fetchRawSearchResults(params: SearchParams): Promise<Study[]> {
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

  if (condToken || termToken) {
    throw new Error('Manual-audit reconciliation universe truncated before all pages were fetched')
  }

  return results
}

function passesServerFilters(study: Study, params: SearchParams): boolean {
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
    if (!locations.some((loc) => loc.country === params.country)) return false
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
  if (!passesServerFilters(study, params)) return false
  if (!passesContinentFilter(study, params)) return false
  if (!filterTrial(study, params.age).include) return false
  if (!filterByTumorType(study, params.tumorType)) return false
  return true
}

function getBroadestAppUniverse(rawUniverse: Study[]): Study[] {
  return rawUniverse.filter((study) =>
    passesAppFilters(
      study,
      buildParams({
        statuses: ALL_STATUSES,
        age: null,
        studyType: 'any',
        phases: [],
        country: null,
        continent: null,
        tumorType: 'any',
      })
    )
  )
}

async function readReviewFile(batchNumber: number): Promise<ReviewFile> {
  const raw = await readFile(join(REVIEW_DIR, `review-batch-${batchNumber}.json`), 'utf8')
  return JSON.parse(raw) as ReviewFile
}

function validateReviewCompleteness(reviews: ReviewEntry[]): Finding[] {
  const findings: Finding[] = []

  for (const review of reviews) {
    if (review.siteEligible === null) {
      findings.push({ nctId: review.nctId, reason: 'manual review missing siteEligible' })
    }
    if (!review.confidence) {
      findings.push({ nctId: review.nctId, reason: 'manual review missing confidence' })
    }
    if (!review.rationale) {
      findings.push({ nctId: review.nctId, reason: 'manual review missing rationale' })
    }
  }

  return findings
}

async function main() {
  const reviewFiles = await Promise.all([1, 2, 3, 4].map(readReviewFile))
  const reviews = reviewFiles.flatMap((file) => file.reviews)

  const completenessFindings = validateReviewCompleteness(reviews)
  if (completenessFindings.length > 0) {
    summarize('Incomplete manual reviews', completenessFindings)
    process.exitCode = 1
    return
  }

  const rawUniverse = await fetchRawSearchResults(buildParams({ statuses: ALL_STATUSES }))
  const broadestAppUniverse = getBroadestAppUniverse(rawUniverse)
  const broadestAppIds = new Set(
    broadestAppUniverse.map((study) => study.protocolSection.identificationModule.nctId)
  )
  const studyMap = new Map(
    broadestAppUniverse.map((study) => [study.protocolSection.identificationModule.nctId, study])
  )

  const eligibilityFindings: Finding[] = []
  const tumorFindings: Finding[] = []

  for (const review of reviews) {
    const study = studyMap.get(review.nctId)
    if (!study) {
      if (review.siteEligible === false) {
        continue
      }
      eligibilityFindings.push({
        nctId: review.nctId,
        reason: 'study missing from current broadest app universe',
      })
      continue
    }

    if (review.siteEligible === false && broadestAppIds.has(review.nctId)) {
      eligibilityFindings.push({
        nctId: review.nctId,
        reason: `manual review marked not site-eligible: ${review.rationale}`,
      })
    }

    if (review.siteEligible === true) {
      for (const tumorType of TUMOR_TYPES) {
        const appMatches = filterByTumorType(study, tumorType)
        const manualMatches = review.tumorLabels.includes(tumorType)
        if (appMatches !== manualMatches) {
          tumorFindings.push({
            nctId: review.nctId,
            reason: `${tumorType} mismatch (manual=${manualMatches}, app=${appMatches})`,
          })
        }
      }
    }
  }

  console.log('Manual Audit Reconciliation')
  console.log(`- reviewed studies: ${reviews.length}`)
  console.log(`- current broadest app universe: ${broadestAppUniverse.length}`)
  console.log(`- eligibility mismatches: ${eligibilityFindings.length}`)
  console.log(`- tumor mismatches: ${tumorFindings.length}`)

  summarize('Eligibility mismatches', eligibilityFindings)
  summarize('Tumor mismatches', tumorFindings)

  if (eligibilityFindings.length || tumorFindings.length) {
    process.exitCode = 1
  }
}

function summarize(label: string, findings: Finding[]): void {
  if (findings.length === 0) return

  console.log('')
  console.log(`${label}:`)
  for (const finding of findings.slice(0, 30)) {
    console.log(`- ${finding.nctId}: ${finding.reason}`)
  }
  if (findings.length > 30) {
    console.log(`- ... ${findings.length - 30} more`)
  }
}

async function readCachedResponse(url: string, allowStale: boolean): Promise<ApiResponse | null> {
  const cachePath = getCachePath(url)
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

async function writeCachedResponse(url: string, payload: ApiResponse): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true })
  await writeFile(getCachePath(url), JSON.stringify(payload))
}

function getCachePath(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex')
  return join(CACHE_DIR, `${hash}.json`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
