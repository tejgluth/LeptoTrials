import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { URL } from 'node:url'
import type { Study, TumorTypeFilter } from '../src/types/trial'
import { filterByTumorType, filterTrial } from '../src/utils/trialFilter'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/weekly-audit-2026-10-10.json', import.meta.url), 'utf8')) as Array<{
  source: string
  rationale: string
  expected: { include: boolean; buckets: string[]; status: string }
  study: Study
}>
const buckets: TumorTypeFilter[] = ['LUNG', 'BREAST', 'MELANOMA', 'GBM', 'OTHER_SOLID']

for (const fixture of fixtures) {
  const id = fixture.study.protocolSection.identificationModule.nctId
  test(`${id}: independently reviewed LM eligibility and tumor-cohort relationship`, () => {
    assert.equal(fixture.source, `https://clinicaltrials.gov/study/${id}`)
    assert.ok(fixture.rationale)
    assert.equal(fixture.study.protocolSection.statusModule.overallStatus, fixture.expected.status)
    assert.equal(filterTrial(fixture.study, null).include, fixture.expected.include, fixture.rationale)
    if (fixture.expected.include) {
      assert.deepEqual(buckets.filter((bucket) => filterByTumorType(fixture.study, bucket)), fixture.expected.buckets, fixture.rationale)
    }
  })
}
