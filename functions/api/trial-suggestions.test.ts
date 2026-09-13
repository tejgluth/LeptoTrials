import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from './trial-suggestions'

const payload = { trialUrl: 'https://clinicaltrials.gov/study/NCT12345678', categories: ['BREAST'], relevance: 'Includes a leptomeningeal breast cancer cohort.' }
function request(body: unknown = payload, headers: Record<string, string> = {}) {
  return new Request('https://leptotrials.com/api/trial-suggestions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  })
}
async function call(request: Request, env: object = {}) {
  return onRequest({ request, env } as Parameters<typeof onRequest>[0])
}

test('the review queue is private, including when the secret is missing', async () => {
  const get = new Request('https://leptotrials.com/api/trial-suggestions')
  assert.equal((await call(get)).status, 401)
  assert.equal((await call(get, { ANALYTICS_ADMIN_TOKEN: 'private-test-token' })).status, 401)
  assert.equal((await call(new Request(get, { headers: { Authorization: 'Bearer wrong' } }), { ANALYTICS_ADMIN_TOKEN: 'private-test-token' })).status, 401)
})

test('rejects cross-site requests, oversized bodies, malformed JSON and invalid suggestions', async () => {
  assert.equal((await call(request(payload, { Origin: 'https://attacker.test' }))).status, 403)
  assert.equal((await call(request({ ...payload, relevance: 'a'.repeat(17000) }))).status, 413)
  assert.equal((await call(request({}, { 'Content-Type': 'text/plain' }))).status, 415)
  assert.equal((await call(request({ ...payload, trialUrl: 'https://attacker.test' }))).status, 400)
  assert.equal((await call(new Request('https://leptotrials.com/api/trial-suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' }))).status, 400)
})

test('verifies registry identity and saves bound values before confirming receipt', async (context) => {
  let values: unknown[] = []
  let saved = false
  const env = { ANALYTICS_DB: { prepare(sql: string) {
    assert.match(sql, /ON CONFLICT\(nct_id\) DO NOTHING/)
    return { bind(...args: unknown[]) { values = args; return { async run() { saved = true } } } }
  } } }
  context.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, 'https://clinicaltrials.gov/api/v2/studies/NCT12345678')
    return Response.json({ protocolSection: { identificationModule: { nctId: 'NCT12345678', briefTitle: 'Official study title' } } })
  })
  const response = await call(request(), env)
  assert.equal(response.status, 202)
  assert.equal(saved, true)
  assert.equal(values[0], 'NCT12345678')
  assert.equal(values[3], 'Official study title')
  assert.deepEqual(await response.json(), { received: true })
})

test('does not claim success when the registry or database fails', async (context) => {
  const mock = context.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  assert.equal((await call(request())).status, 400)
  mock.mock.mockImplementation(async () => new Response('', { status: 503 }))
  assert.equal((await call(request())).status, 503)
  mock.mock.mockImplementation(async () => Response.json({ protocolSection: { identificationModule: { nctId: 'NCT12345678', briefTitle: 'Study' } } }))
  assert.equal((await call(request(), { ANALYTICS_DB: { prepare() { throw new Error('database unavailable') } } })).status, 503)
})

test('rate-limits submissions before requesting the registry', async (context) => {
  const fetchMock = context.mock.method(globalThis, 'fetch', async () => { throw new Error('Registry should not be called') })
  const response = await call(request(payload, { 'cf-connecting-ip': '192.0.2.1' }), {
    ANALYTICS_ADMIN_TOKEN: 'private-test-token',
    ANALYTICS_DB: { prepare() { return { bind(key: string) {
      assert.match(key, /^[a-f0-9]{64}$/)
      assert.doesNotMatch(key, /192\.0\.2\.1/)
      return { async first() { return null } }
    } } } },
  })
  assert.equal(response.status, 429)
  assert.equal(fetchMock.mock.callCount(), 0)
})
