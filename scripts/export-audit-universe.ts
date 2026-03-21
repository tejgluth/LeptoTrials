import { mkdir, writeFile } from 'node:fs/promises'
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
} from '../src/types/trial'

const OUTPUT_DIR = join(process.cwd(), 'audit', 'manual-review')
const MAX_PAGES = 20
const FETCH_RETRIES = 5
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

type AuditRecord = {
  nctId: string
  url: string
  status: string
  studyType: string
  phases: string[]
  briefTitle: string
  officialTitle: string
  conditions: string[]
  countries: string[]
  briefSummary: string
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
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Leptomeningeal-audit-export/1.0',
      },
    })

    if (response.ok) {
      return response.json() as Promise<ApiResponse>
    }

    if (response.status === 429 && attempt < FETCH_RETRIES - 1) {
      await sleep(1500 * 2 ** attempt)
      continue
    }

    const text = await response.text().catch(() => 'Unknown error')
    throw new Error(`ClinicalTrials.gov API error ${response.status}: ${text}`)
  }

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
    throw new Error('Universe export truncated before all pages were fetched')
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

  const allowed = CONTINENT_COUNTRIES[params.continent] ?? []
  const locations = study.protocolSection.contactsLocationsModule?.locations ?? []
  return locations.some((loc) => loc.country && allowed.includes(loc.country))
}

function passesAppFilters(study: Study, params: SearchParams): boolean {
  if (!passesServerFilters(study, params)) return false
  if (!passesContinentFilter(study, params)) return false
  if (!filterTrial(study, params.age).include) return false
  if (!filterByTumorType(study, params.tumorType)) return false
  return true
}

function toAuditRecord(study: Study): AuditRecord {
  const proto = study.protocolSection
  const identification = proto.identificationModule
  const locations = proto.contactsLocationsModule?.locations ?? []

  return {
    nctId: identification.nctId,
    url: `https://clinicaltrials.gov/study/${identification.nctId}`,
    status: proto.statusModule.overallStatus,
    studyType: proto.designModule.studyType,
    phases: proto.designModule.phases ?? [],
    briefTitle: identification.briefTitle ?? '',
    officialTitle: identification.officialTitle ?? '',
    conditions: proto.conditionsModule?.conditions ?? [],
    countries: Array.from(new Set(locations.map((loc) => loc.country).filter(Boolean))) as string[],
    briefSummary: proto.descriptionModule?.briefSummary ?? '',
  }
}

async function main() {
  const rawUniverse = await fetchRawSearchResults(buildParams({ statuses: ALL_STATUSES }))
  const appUniverse = rawUniverse.filter((study) =>
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

  const records = appUniverse
    .map(toAuditRecord)
    .sort((a, b) => a.nctId.localeCompare(b.nctId))

  await mkdir(OUTPUT_DIR, { recursive: true })
  await writeFile(
    join(OUTPUT_DIR, 'universe.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rawUniverseCount: rawUniverse.length,
        appUniverseCount: records.length,
        records,
      },
      null,
      2
    )
  )

  const batchSize = Math.ceil(records.length / 4)
  for (let index = 0; index < 4; index += 1) {
    const batchRecords = records.slice(index * batchSize, (index + 1) * batchSize)
    await writeFile(
      join(OUTPUT_DIR, `batch-${index + 1}.json`),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          batch: index + 1,
          batchSize: batchRecords.length,
          records: batchRecords,
        },
        null,
        2
      )
    )
    await writeFile(
      join(OUTPUT_DIR, `review-batch-${index + 1}.json`),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          batch: index + 1,
          instructions: {
            siteEligible: 'true if the study should appear anywhere on the website for LM patients; false otherwise',
            tumorLabels: ['LUNG', 'BREAST', 'MELANOMA', 'GBM', 'OTHER_SOLID'],
            confidence: 'high | medium | low',
            rationale: 'Short evidence-based note from the ClinicalTrials.gov record',
          },
          reviews: batchRecords.map((record) => ({
            nctId: record.nctId,
            briefTitle: record.briefTitle,
            siteEligible: null,
            tumorLabels: [],
            confidence: '',
            rationale: '',
          })),
        },
        null,
        2
      )
    )
  }

  console.log(`Raw universe: ${rawUniverse.length}`)
  console.log(`App display universe: ${records.length}`)
  console.log(`Wrote audit files to ${OUTPUT_DIR}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
