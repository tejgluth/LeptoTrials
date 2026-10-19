import assert from 'node:assert/strict'
import test from 'node:test'
import { isContactAction, isNctId, tokensMatch } from './contactAnalytics'

test('validates the public event schema', () => {
  assert.equal(isContactAction('email_click'), true)
  assert.equal(isContactAction('email_copy'), true)
  assert.equal(isContactAction('view'), false)
  assert.equal(isNctId('NCT12345678'), true)
  assert.equal(isNctId('NCT123'), false)
})

test('compares dashboard tokens without an early equality return', () => {
  assert.equal(tokensMatch('same-token', 'same-token'), true)
  assert.equal(tokensMatch('wrong-token', 'same-token'), false)
  assert.equal(tokensMatch('short', 'much-longer-token'), false)
})
