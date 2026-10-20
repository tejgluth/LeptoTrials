import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { URL } from 'node:url'
import type { Study, TumorTypeFilter } from '../src/types/trial'
import { filterByTumorType, filterTrial } from '../src/utils/trialFilter'

type ReviewedStudy = {
  source: string
  rationale: string
  expected: { include: boolean; buckets: string[]; status: string }
  ageCases?: Array<{ age: number; include: boolean }>
  study: Study
}

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/reviewed-studies.json', import.meta.url), 'utf8'),
) as ReviewedStudy[]
const buckets: TumorTypeFilter[] = ['LUNG', 'BREAST', 'MELANOMA', 'GBM', 'OTHER_SOLID']

for (const fixture of fixtures) {
  const id = fixture.study.protocolSection.identificationModule.nctId
  test(`${id} matches the reviewed LM eligibility and tumor buckets`, () => {
    assert.equal(fixture.source, `https://clinicaltrials.gov/study/${id}`)
    assert.ok(fixture.rationale)
    assert.equal(fixture.study.protocolSection.statusModule.overallStatus, fixture.expected.status)
    assert.equal(filterTrial(fixture.study, null).include, fixture.expected.include, fixture.rationale)
    if (fixture.expected.include) {
      assert.deepEqual(buckets.filter((bucket) => filterByTumorType(fixture.study, bucket)), fixture.expected.buckets, fixture.rationale)
    }
    for (const ageCase of fixture.ageCases ?? []) {
      assert.equal(filterTrial(fixture.study, ageCase.age).include, ageCase.include,
        `${id}: age ${ageCase.age}`)
    }
  })
}
