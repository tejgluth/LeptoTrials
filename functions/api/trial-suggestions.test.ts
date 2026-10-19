import assert from 'node:assert/strict'
import test from 'node:test'
import { onRequest } from './trial-suggestions'

test('retired submissions never read bodies, call providers, or access a database', async (context) => {
  const fetch = context.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not forward data') })
  for (const method of ['GET', 'POST', 'PUT']) {
    const request = new Request('https://leptotrials.com/api/trial-suggestions', { method })
    context.mock.method(request, 'text', async () => { throw new Error('Must not read data') })
    const response = await onRequest({ request } as Parameters<typeof onRequest>[0])
    assert.equal(response.status, 410)
    assert.match((await response.json() as { error: string }).error, /no longer collected/)
  }
  assert.equal(fetch.mock.callCount(), 0)
})
