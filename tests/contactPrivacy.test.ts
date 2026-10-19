import assert from 'node:assert/strict'
import test from 'node:test'
const { trackContactAction } = await import('../src/utils/' + 'contactAnalytics.ts')

test('counts trial contacts by default with only trial/action and honors browser privacy signals', async (context) => {
  type BrowserRequest = { body: string; credentials: string; referrerPolicy: string }
  const requests: BrowserRequest[] = []
  const browserGlobal = globalThis as unknown as { navigator: { doNotTrack?: string | null; globalPrivacyControl?: boolean } }
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: unknown) => { requests.push(init as BrowserRequest); return new Response() })
  context.mock.getter(browserGlobal, 'navigator', () => ({ doNotTrack: null, globalPrivacyControl: false }))
  trackContactAction('NCT12345678', 'email_click')
  trackContactAction('NCT12345678', 'email_copy')
  assert.equal(requests.length, 2)
  assert.deepEqual(JSON.parse(requests[0].body), { nctId: 'NCT12345678', action: 'email_click' })
  assert.deepEqual(JSON.parse(requests[1].body), { nctId: 'NCT12345678', action: 'email_copy' })
  assert.equal(requests[0].credentials, 'omit')
  assert.equal(requests[0].referrerPolicy, 'no-referrer')
  context.mock.getter(browserGlobal, 'navigator', () => ({ globalPrivacyControl: true }))
  trackContactAction('NCT12345678', 'email_click')
  assert.equal(requests.length, 2)
  context.mock.getter(browserGlobal, 'navigator', () => ({ doNotTrack: '1' }))
  trackContactAction('NCT12345678', 'email_click')
  assert.equal(requests.length, 2)
})
