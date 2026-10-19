import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from './contact-events'

function request(body: string, headers: Record<string, string> = {}): Request {
  return new Request('https://leptotrials.example/api/contact-events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  })
}

async function call(requestValue: Request): Promise<Response> {
  return onRequest({ request: requestValue } as Parameters<typeof onRequest>[0])
}

test('rejects methods other than POST', async () => {
  assert.equal((await call(new Request('https://leptotrials.example/api/contact-events'))).status, 405)
})

test('rejects cross-site and malformed origins', async () => {
  const body = JSON.stringify({
    action: 'email_click',
    nctId: 'NCT12345678',
  })
  assert.equal((await call(request(body, { Origin: 'https://attacker.example' }))).status, 403)
  assert.equal((await call(request(body, { Origin: 'not a URL' }))).status, 403)
})

test('rejects oversized and invalid event bodies', async () => {
  assert.equal((await call(request(JSON.stringify({ padding: 'x'.repeat(2_100) })))).status, 413)
  assert.equal((await call(request('{invalid'))).status, 400)
  assert.equal((await call(request(JSON.stringify({
    action: 'unknown',
    nctId: 'NCT12345678',
  })))).status, 400)
})

test('cancels an oversized streaming body without waiting for the stream to end', async () => {
  let cancelled = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(2_049)) },
    cancel() { cancelled = true },
  })
  const streamRequest = new Request('https://leptotrials.example/api/contact-events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    duplex: 'half',
  } as RequestInit)
  assert.equal((await call(streamRequest)).status, 413)
  assert.equal(cancelled, true)
})

test('rejects media types that merely start with application/json', async () => {
  assert.equal((await call(request('{}', { 'Content-Type': 'application/json-invalid' }))).status, 415)
})

test('accepts only trial/action, ignores privacy-signal requests, and stores aggregate counters', async () => {
  const body = { action: 'email_click', nctId: 'NCT12345678' }
  assert.equal((await call(request(JSON.stringify({ ...body, email: 'patient@example.com' })))).status, 400)
  assert.equal((await call(request(JSON.stringify({ ...body, eventId: '11111111-1111-4111-8111-111111111111' })))).status, 400)
  for (const headers of [{ 'sec-gpc': '1' }, { dnt: '1' }] as Record<string, string>[]) {
    const response = await call(request(JSON.stringify(body), headers))
    assert.equal(response.status, 202)
    assert.deepEqual(await response.json(), { recorded: false })
  }
  let bound: unknown[] = []
  const env = { ANALYTICS_DB: { prepare(sql: string) {
    assert.match(sql, /INSERT INTO trial_contact_counts/)
    assert.doesNotMatch(sql, /recorded_at|event_id|client_key/)
    return { bind(...values: unknown[]) { bound = values; return { async run() {} } } }
  } } }
  const response = await onRequest({ request: request(JSON.stringify(body), { 'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': '192.0.2.1' }), env } as unknown as Parameters<typeof onRequest>[0])
  assert.equal(response.status, 202)
  assert.deepEqual(bound, ['NCT12345678', 1, 0])
})
