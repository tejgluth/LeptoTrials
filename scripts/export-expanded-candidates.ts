import { fetchRegistryPage } from '../src/utils/apiClient'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApiResponse, OverallStatus, Study } from '../src/types/trial'

const OUTPUT_DIR = join(process.cwd(), 'audit', 'manual-review')
const MAX_PAGES = 20
const BASE_URL = 'https://clinicaltrials.gov/api/v2/studies'
const ALL_STATUSES: OverallStatus[] = [
  'RECRUITING',
  'NOT_YET_RECRUITING',
  'ACTIVE_NOT_RECRUITING',
  'ENROLLING_BY_INVITATION',
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

const SEARCHES = [
  { kind: 'cond', value: 'leptomeningeal metastasis' },
  { kind: 'cond', value: 'meningeal metastasis' },
  { kind: 'cond', value: 'leptomeningeal disease' },
  { kind: 'term', value: 'leptomeningeal' },
  { kind: 'term', value: 'leptomeningeal disease' },
  { kind: 'term', value: 'meningeal metastasis' },
  { kind: 'term', value: 'leptomeningeal carcinomatosis' },
  { kind: 'term', value: 'neoplastic meningitis' },
  { kind: 'term', value: 'carcinomatous meningitis' },
  { kind: 'term', value: 'LMD' },
]

type CandidateRecord = {
  nctId: string
  url: string
  briefTitle: string
  officialTitle: string
  status: string
  studyType: string
  phases: string[]
  conditions: string[]
  briefSummary: string
  matchedSearches: string[]
}

async function fetchJson(url: string): Promise<ApiResponse> {
  return fetchRegistryPage(url)
}

async function fetchSearch(search: typeof SEARCHES[number]): Promise<Study[]> {
  const seen = new Set<string>()
  const results: Study[] = []
  let pageToken: string | undefined

  const addStudies = (studies: Study[]) => {
    for (const study of studies) {
      const id = study.protocolSection.identificationModule.nctId
      if (seen.has(id)) continue
      seen.add(id)
      results.push(study)
    }
  }

  const first = await fetchJson(buildUrl(search))
  pageToken = first.nextPageToken
  addStudies(first.studies ?? [])

  for (let page = 1; page < MAX_PAGES; page += 1) {
    if (!pageToken) break
    const next = await fetchJson(buildUrl(search, pageToken))
    pageToken = next.nextPageToken
    addStudies(next.studies ?? [])
  }

  if (pageToken) {
    throw new Error(`Expanded candidate search truncated for ${search.kind}:${search.value}`)
  }

  return results
}

function buildUrl(search: typeof SEARCHES[number], pageToken?: string): string {
  const url = new URLSearchParams()
  url.set('format', 'json')
  url.set('pageSize', '20')
  url.set('filter.overallStatus', ALL_STATUSES.join(','))
  if (pageToken) url.set('pageToken', pageToken)
  url.set(search.kind === 'cond' ? 'query.cond' : 'query.term', search.value)
  return `${BASE_URL}?${url.toString()}`
}

async function main() {
  const byId = new Map<string, CandidateRecord>()

  for (const search of SEARCHES) {
    const studies = await fetchSearch(search)
    const tag = `${search.kind}:${search.value}`
    for (const study of studies) {
      const proto = study.protocolSection
      const id = proto.identificationModule.nctId
      const existing = byId.get(id)
      if (existing) {
        existing.matchedSearches.push(tag)
        continue
      }

      byId.set(id, {
        nctId: id,
        url: `https://clinicaltrials.gov/study/${id}`,
        briefTitle: proto.identificationModule?.briefTitle ?? '',
        officialTitle: proto.identificationModule?.officialTitle ?? '',
        status: proto.statusModule.overallStatus,
        studyType: proto.designModule.studyType,
        phases: proto.designModule.phases ?? [],
        conditions: proto.conditionsModule?.conditions ?? [],
        briefSummary: proto.descriptionModule?.briefSummary ?? '',
        matchedSearches: [tag],
      })
    }
  }

  const records = Array.from(byId.values()).sort((a, b) => a.nctId.localeCompare(b.nctId))
  await mkdir(OUTPUT_DIR, { recursive: true })
  await writeFile(
    join(OUTPUT_DIR, 'expanded-candidates.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        searches: SEARCHES,
        count: records.length,
        records,
      },
      null,
      2
    )
  )

  console.log(`Expanded candidate universe: ${records.length}`)
  console.log(`Wrote ${join(OUTPUT_DIR, 'expanded-candidates.json')}`)
}


main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
