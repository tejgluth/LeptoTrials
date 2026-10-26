import { mkdir, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { buildCondUrl, buildTermUrl, DEFAULT_SEARCH_PARAMS, fetchRegistryPage, fetchSupplementalAuditedStudies } from '../src/utils/apiClient'
import { fetchAllStudies } from '../src/utils/fetchAllStudies'
import { filterByTumorType, filterTrial } from '../src/utils/trialFilter'
import type { Study, TumorTypeFilter } from '../src/types/trial'

// Read-only evidence exports. They never generate or overwrite clinical decisions.
const mode = process.argv[2]
if (!['universe', 'expanded', 'independent'].includes(mode)) throw new Error('Expected universe, expanded or independent')
const out = resolve(process.argv[3] ?? 'audit/manual-review')
const buckets: TumorTypeFilter[] = ['LUNG', 'BREAST', 'MELANOMA', 'GBM', 'OTHER_SOLID']
const concepts = ['leptomeningeal metastasis', 'leptomeningeal metastases', 'leptomeningeal disease', 'leptomeningeal carcinomatosis', 'neoplastic meningitis', 'carcinomatous meningitis', 'meningeal metastasis', 'meningeal metastases', 'leptomeningeal neoplasm', 'malignant neoplasm in the leptomeninges', 'lymphomatous meningitis', 'leukemic meningitis']
const expanded = [['cond', 'leptomeningeal metastasis'], ['cond', 'meningeal metastasis'], ['cond', 'leptomeningeal disease'], ['term', 'leptomeningeal'], ['term', 'leptomeningeal disease'], ['term', 'meningeal metastasis'], ['term', 'leptomeningeal carcinomatosis'], ['term', 'neoplastic meningitis'], ['term', 'carcinomatous meningitis'], ['term', 'LMD']]
const studies = new Map<string, Study>()
const retrievalTimes = new Map<string, string>()
const queries: Array<Record<string, unknown>> = []
await mkdir(out, { recursive: true })
const target = resolve(out, `${mode}.json`)
const result = { startedAt: new Date().toISOString(), complete: false, queries, records: [] as unknown[] }
try {
  const params = { ...DEFAULT_SEARCH_PARAMS, statuses: [] }
  const urls = mode === 'universe' ? [buildCondUrl(params), buildTermUrl(params)]
    : (mode === 'expanded' ? expanded : concepts.flatMap(term => [['term', term], ['cond', term]]))
      .map(([kind, value]) => {
        const url = new URL('https://clinicaltrials.gov/api/v2/studies')
        url.searchParams.set(`query.${kind}`, value)
        url.searchParams.set('format', 'json')
        url.searchParams.set('pageSize', '100')
        return url.toString()
      })
  for (const base of urls) {
    const pages: Array<Record<string, unknown>> = []
    const query: Record<string, unknown> = { url: base, pages, complete: false }
    queries.push(query)
    const rows = await fetchAllStudies(async token => {
      const url = new URL(base)
      url.searchParams.set('countTotal', 'true')
      if (token) url.searchParams.set('pageToken', token)
      const response = await fetchRegistryPage(url.toString())
      const retrievedAt = new Date().toISOString()
      pages.push({ url: url.toString(), retrievedAt, count: response.studies.length, totalCount: response.totalCount, hasNext: !!response.nextPageToken })
      for (const study of response.studies) retrievalTimes.set(study.protocolSection.identificationModule.nctId, retrievedAt)
      return response
    })
    const unique = new Set(rows.map(s => s.protocolSection.identificationModule.nctId))
    if (typeof pages[0]?.totalCount === 'number' && unique.size !== pages[0].totalCount) throw new Error(`Count mismatch for ${base}`)
    Object.assign(query, { uniqueCount: unique.size, ids: [...unique], complete: true })
    for (const study of rows) studies.set(study.protocolSection.identificationModule.nctId, study)
    console.log(`${mode}: ${base}: ${unique.size} studies / ${pages.length} pages`)
  }
  if (mode === 'universe') {
    const rows = await fetchSupplementalAuditedStudies()
    queries.push({ kind: 'supplemental', retrievedAt: new Date().toISOString(), count: rows.length, complete: true })
    for (const study of rows) {
      const id = study.protocolSection.identificationModule.nctId
      studies.set(id, study)
      retrievalTimes.set(id, new Date().toISOString())
    }
  }
  result.records = [...studies.values()].sort((a, b) => a.protocolSection.identificationModule.nctId.localeCompare(b.protocolSection.identificationModule.nctId)).map(study => ({
    nctId: study.protocolSection.identificationModule.nctId,
    source: `https://clinicaltrials.gov/study/${study.protocolSection.identificationModule.nctId}`,
    retrievedAt: retrievalTimes.get(study.protocolSection.identificationModule.nctId),
    protocolSha256: createHash('sha256').update(JSON.stringify(study.protocolSection)).digest('hex'),
    classification: { include: filterTrial(study, null).include, buckets: filterTrial(study, null).include ? buckets.filter(b => filterByTumorType(study, b)) : [] },
    study,
  }))
  result.complete = true
  await writeFile(`${target}.tmp`, JSON.stringify({ ...result, completedAt: new Date().toISOString(), count: studies.size }, null, 2) + '\n')
  await rename(`${target}.tmp`, target)
  console.log(`Complete: ${studies.size} unique records; ${result.records.filter((r) => (r as { classification: { include: boolean } }).classification.include).length} relevant`)
} catch (error) {
  await writeFile(`${target}.failed.json`, JSON.stringify({ ...result, failedAt: new Date().toISOString(), error: String(error) }, null, 2) + '\n')
  throw error
}
