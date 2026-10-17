import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { URL } from 'node:url'
import type { Study, TumorTypeFilter } from '../src/types/trial'
import { filterByTumorType, filterTrial } from '../src/utils/trialFilter'

type AuditFixture = {
  source: string
  rationale: string
  expected: { include: boolean; buckets: string[]; status: string }
  ageCases?: Array<{ age: number; include: boolean }>
  study: Study
}
// Keep historical source fixtures; later independently reviewed evidence supersedes
// their classification when policy/cohort review changes a current override.
const fixturesById = new Map<string, AuditFixture>()
for (const date of ['2026-10-10', '2026-10-17']) {
  const rows = JSON.parse(readFileSync(new URL(`./fixtures/weekly-audit-${date}.json`, import.meta.url), 'utf8')) as AuditFixture[]
  for (const row of rows) fixturesById.set(row.study.protocolSection.identificationModule.nctId, row)
}
const fixtures = [...fixturesById.values()]
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
    for (const ageCase of fixture.ageCases ?? []) {
      assert.equal(filterTrial(fixture.study, ageCase.age).include, ageCase.include,
        `${id}: age ${ageCase.age} must follow the explicit current-source age criterion`)
    }
  })
}
