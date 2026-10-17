import assert from 'node:assert/strict'
import test from 'node:test'
import type { ApiResponse } from '../src/types/trial'
import { fetchAllStudies } from '../src/utils/fetchAllStudies'
import { isAgeEligible, parseAgeToYears } from '../src/utils/ageParser'
import { buildCondUrl, buildTermUrl, DEFAULT_SEARCH_PARAMS, fetchCondStudies } from '../src/utils/apiClient'

test('pagination follows tokens until the final page', async () => {
  const tokens: Array<string | undefined> = []
  const results = await fetchAllStudies(async (token) => {
    tokens.push(token)
    return { studies: [], nextPageToken: token ? undefined : 'page-two' }
  })
  assert.deepEqual(tokens, [undefined, 'page-two'])
  assert.deepEqual(results, [])
})

test('a failed later page rejects the search instead of returning partial results', async () => {
  await assert.rejects(fetchAllStudies(async (token) => {
    if (token) throw new Error('Registry unavailable')
    return { studies: [], nextPageToken: 'page-two' }
  }), /Registry unavailable/)
})

test('repeated page tokens and page-limit overflow reject the search', async () => {
  await assert.rejects(fetchAllStudies(async () => ({
    studies: [], nextPageToken: 'repeated',
  })), /repeated page/)
  let page = 0
  await assert.rejects(fetchAllStudies(async () => ({
    studies: [], nextPageToken: String(++page),
  })), /page limit/)
  assert.equal(page, 20)
})

test('age filtering includes boundaries and handles pediatric units and open bounds', () => {
  assert.equal(parseAgeToYears('6 Months'), 0.5)
  assert.equal(parseAgeToYears('365.25 Days'), 1)
  assert.equal(parseAgeToYears('N/A'), null)
  assert.equal(isAgeEligible(18, '18 Years', '70 Years'), true)
  assert.equal(isAgeEligible(70, '18 Years', '70 Years'), true)
  assert.equal(isAgeEligible(17, '18 Years', undefined), false)
  assert.equal(isAgeEligible(71, undefined, '70 Years'), false)
  assert.equal(isAgeEligible(0.25, '6 Months', undefined), false)
  assert.equal(isAgeEligible(90, undefined, undefined), true)
})

test('both registry queries preserve selected server filters and page tokens', () => {
  for (const buildUrl of [buildCondUrl, buildTermUrl]) {
    const url = new URL(buildUrl({
      ...DEFAULT_SEARCH_PARAMS,
      studyType: 'INTERVENTIONAL',
      phases: ['PHASE1', 'PHASE2'],
      country: 'United States',
      statuses: ['RECRUITING'],
    }, 'a+b/c='))
    assert.equal(url.searchParams.get('pageToken'), 'a+b/c=')
    assert.equal(url.searchParams.get('pageSize'), '100')
    assert.equal(url.searchParams.get('filter.overallStatus'), 'RECRUITING')
    assert.equal(url.searchParams.get('filter.advanced'),
      'AREA[StudyType]INTERVENTIONAL AND (AREA[Phase]PHASE1 OR AREA[Phase]PHASE2) AND AREA[LocationCountry]United States')
  }
})

test('registry errors do not expose upstream response bodies', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('internal diagnostic', { status: 503 }))
  await assert.rejects(fetchCondStudies(DEFAULT_SEARCH_PARAMS), (error: Error) => {
    assert.match(error.message, /HTTP 503/)
    assert.doesNotMatch(error.message, /internal diagnostic/)
    return true
  })
})

test('registry requests propagate cancellation', async (context) => {
  const controller = new AbortController()
  controller.abort()
  context.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    init.signal?.throwIfAborted()
    return new Response('{}')
  })
  await assert.rejects(fetchCondStudies(DEFAULT_SEARCH_PARAMS, undefined, controller.signal), { name: 'AbortError' })
})

test('malformed pages are rejected instead of being interpreted as empty results', async (context) => {
  for (const payload of [{}, { studies: null }, { studies: [], nextPageToken: 123 }, { studies: [{}] }]) {
    context.mock.method(globalThis, 'fetch', async () => Response.json(payload))
    await assert.rejects(fetchCondStudies(DEFAULT_SEARCH_PARAMS), /incomplete or invalid/)
    context.mock.restoreAll()
  }
  await assert.rejects(fetchAllStudies(async () => ({} as ApiResponse)), /incomplete or invalid/)
})

test('supplemental retrieval follows all pages, deduplicates and checks required IDs', async (context) => {
  const { fetchSupplementalAuditedStudies, SUPPLEMENTAL_AUDITED_STUDY_IDS } = await import('../src/utils/apiClient')
  const studies = SUPPLEMENTAL_AUDITED_STUDY_IDS.map((nctId) => ({ protocolSection: {
    identificationModule: { nctId, briefTitle: 'Registry fixture' },
    statusModule: { overallStatus: 'RECRUITING' }, designModule: { studyType: 'INTERVENTIONAL' },
  } }))
  const urls: string[] = []
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url)
    return Response.json(new URL(url).searchParams.has('pageToken')
      ? { studies: [studies[0], ...studies.slice(40)] }
      : { studies: studies.slice(0, 40), nextPageToken: 'second' })
  })
  assert.equal((await fetchSupplementalAuditedStudies()).length, studies.length)
  assert.equal(new URL(urls[1]).searchParams.get('pageToken'), 'second')
  context.mock.restoreAll()
  context.mock.method(globalThis, 'fetch', async () => Response.json({ studies: studies.slice(1) }))
  await assert.rejects(fetchSupplementalAuditedStudies(), /omitted 1 audited studies/)
})

test('transient network errors retry but cancellation interrupts retry backoff', async (context) => {
  let attempts = 0
  context.mock.method(globalThis, 'fetch', async () => {
    if (++attempts === 1) throw new TypeError('network unavailable')
    return Response.json({ studies: [] })
  })
  assert.deepEqual(await fetchCondStudies(DEFAULT_SEARCH_PARAMS), { studies: [] })
  assert.equal(attempts, 2)
  context.mock.restoreAll()
  const controller = new AbortController()
  context.mock.method(globalThis, 'fetch', async () => {
    setTimeout(() => controller.abort(), 10)
    return new Response('', { status: 429 })
  })
  await assert.rejects(fetchCondStudies(DEFAULT_SEARCH_PARAMS, undefined, controller.signal), { name: 'AbortError' })
})
