import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTrialOutreachMailto, normalizeContactEmail } from '../src/utils/trialOutreachEmail'

test('normalizes ordinary trial contact addresses and rejects unsafe values', () => {
  assert.equal(normalizeContactEmail(' trial.team+lm@example.org '), 'trial.team+lm@example.org')
  assert.equal(normalizeContactEmail('trial@example.org?subject=Injected'), undefined)
  assert.equal(normalizeContactEmail('not-an-email'), undefined)
})

test('builds a Gmail-compatible mailto link with an editable outreach draft', () => {
  const href = buildTrialOutreachMailto({
    recipient: 'trial.team@example.org',
    nctId: 'NCT05112549',
    trialTitle: 'A Study for Leptomeningeal Metastases',
    contactName: 'Research Coordinator',
  })

  assert.match(href, /^mailto:trial\.team@example\.org\?/)
  assert.equal(href.includes('trial.team%40example.org'), false)

  const query = new URLSearchParams(href.slice(href.indexOf('?') + 1))
  assert.equal(query.get('subject'), 'Question about clinical trial NCT05112549')
  assert.match(query.get('body') ?? '', /^Hello Research Coordinator,/)
  assert.match(query.get('body') ?? '', /A Study for Leptomeningeal Metastases/)
  assert.match(query.get('body') ?? '', /I am interested in participating in this trial/)
  assert.doesNotMatch(query.get('body') ?? '', /eligibility can only be determined/)
  assert.match(query.get('body') ?? '', /\[Your name\]/)
})
