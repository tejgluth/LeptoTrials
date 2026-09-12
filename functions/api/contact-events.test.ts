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
    eventId: '11111111-1111-4111-8111-111111111111',
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
    eventId: '11111111-1111-4111-8111-111111111111',
  })))).status, 400)
})
