import assert from 'node:assert/strict'
import test from 'node:test'
import { parseTrialLink, validateSuggestion } from '../src/utils/trialSuggestion'

test('accepts official current and legacy registry links and normalizes the ID', () => {
  assert.equal(parseTrialLink('https://clinicaltrials.gov/study/nct12345678?tab=table'), 'NCT12345678')
  assert.equal(parseTrialLink('https://www.clinicaltrials.gov/ct2/show/NCT12345678/'), 'NCT12345678')
})

test('rejects lookalike hosts, credentials, non-HTTPS links, and invalid study paths', () => {
  for (const url of [
    'https://clinicaltrials.gov.attacker.test/study/NCT12345678',
    'https://clinicaltrials.gov@attacker.test/study/NCT12345678',
    'https://user@clinicaltrials.gov/study/NCT12345678',
    'http://clinicaltrials.gov/study/NCT12345678',
    'https://clinicaltrials.gov:8080/study/NCT12345678',
    'https://clinicaltrials.gov/study/NCT123',
    'https://clinicaltrials.gov/search',
    'javascript:alert(1)',
  ]) assert.equal(parseTrialLink(url), null, url)
})

test('requires valid categories and a useful explanation', () => {
  const body = { trialUrl: 'https://clinicaltrials.gov/study/NCT12345678', categories: ['BREAST'], relevance: 'Includes a leptomeningeal breast cancer cohort.' }
  assert.deepEqual(validateSuggestion(body).categories, ['BREAST'])
  for (const categories of [[], ['__proto__'], ['UNKNOWN'], ['UNSURE', 'BREAST']]) {
    assert.throws(() => validateSuggestion({ ...body, categories }))
  }
  assert.throws(() => validateSuggestion({ ...body, relevance: 'short' }))
  assert.throws(() => validateSuggestion({ ...body, relevance: 'a'.repeat(3001) }))
  assert.deepEqual(validateSuggestion({ ...body, categories: ['BREAST', 'BREAST'] }).categories, ['BREAST'])
})
