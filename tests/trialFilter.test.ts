import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { URL } from 'node:url'
import type { Study } from '../src/types/trial'
import { filterByTumorType, filterTrial, parseEligibilityCriteria } from '../src/utils/trialFilter'
import { getManualAuditOverride } from '../src/utils/manualAuditOverrides'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/eligibility-studies.json', import.meta.url), 'utf8')) as Array<{
  source: string
  retrievedOn: string
  study: Study
}>

// Synthetic records deliberately use an ID outside the audited override table.
function makeStudy({
  criteria = '', conditions = ['Solid Tumor'], title = 'Systemic therapy study', summary = '',
  minAge = '18 Years', maxAge = '75 Years',
} = {}): Study {
  return {
    protocolSection: {
      identificationModule: {
        nctId: 'NCT99999999', briefTitle: title,
        organization: { fullName: 'Test sponsor', class: 'OTHER' },
      },
      statusModule: { overallStatus: 'RECRUITING' },
      sponsorCollaboratorsModule: { responsibleParty: { type: 'SPONSOR' }, leadSponsor: { name: 'Test sponsor', class: 'OTHER' } },
      designModule: { studyType: 'INTERVENTIONAL' },
      conditionsModule: { conditions },
      descriptionModule: { briefSummary: summary },
      eligibilityModule: { eligibilityCriteria: criteria, minimumAge: minAge, maximumAge: maxAge },
    },
  }
}

function fixture(nctId: string): Study {
  const record = fixtures.find(({ study }) => study.protocolSection.identificationModule.nctId === nctId)
  assert.ok(record, `Missing frozen registry record ${nctId}`)
  assert.equal(record.source, `https://clinicaltrials.gov/study/${nctId}`)
  return structuredClone(record.study)
}

function assertExcluded(study: Study, reason: RegExp, age: number | null = null) {
  const result = filterTrial(study, age)
  assert.equal(result.include, false)
  if (!result.include) assert.match(result.reason, reason)
}

test('empty and unstructured eligibility text preserve the absence of a section boundary', () => {
  assert.deepEqual(parseEligibilityCriteria(''), { inclusion: '', exclusion: '', sectionFound: false })
  const text = 'Patients with leptomeningeal disease may enroll.'
  assert.deepEqual(parseEligibilityCriteria(text), { inclusion: text, exclusion: '', sectionFound: false })
})

for (const heading of [
  'Exclusion Criteria:', 'KEY EXCLUSION CRITERIA\n', 'Main exclusion criteria\r\n',
  'Subject exclusion criteria:', 'Patient exclusion criteria\n', 'Study exclusion criteria:',
  'Specific exclusion criteria:', 'General exclusion criteria\n', 'Exclusion criteria\t',
  'Exclusion criteria (all cohorts):', 'Key Exclusion Criteria PHASE 1 and PHASE 2',
  'Exclusion Criteria Cohort A', 'Main Exclusion Criteria Part 2', '\nExclusion:\n', '\r\nExclusion:',
]) {
  test(`parser keeps original text when splitting at ${JSON.stringify(heading)}`, () => {
    const inclusion = 'Inclusion Criteria:\nPatients with solid tumors.\n'
    const exclusion = `${heading}\nLeptomeningeal disease.`
    const parsed = parseEligibilityCriteria(inclusion + exclusion)
    assert.deepEqual(parsed, { inclusion, exclusion, sectionFound: true })
  })
}

test('narrative mentions of inclusion and exclusion criteria do not split the text', () => {
  const text = 'Patients must satisfy all inclusion and exclusion criteria for the trial.'
  assert.equal(parseEligibilityCriteria(text).sectionFound, false)
})

test('the first exclusion heading wins when a protocol contains multiple cohort sections', () => {
  const text = 'Inclusion Criteria:\nSolid tumors.\nExclusion criteria:\nLeptomeningeal disease.\nKey exclusion criteria:\nInfection.'
  const parsed = parseEligibilityCriteria(text)
  assert.equal(parsed.inclusion, 'Inclusion Criteria:\nSolid tumors.\n')
  assert.match(parsed.exclusion, /^exclusion criteria:/i)
  assert.ok(parsed.exclusion.includes('Key exclusion criteria:'))
})

test('generic brain metastases, missing text, and an embedded LMD substring are insufficient', () => {
  assert.equal(getManualAuditOverride('NCT99999999'), undefined)
  for (const study of [makeStudy(), makeStudy({ title: 'Brain metastases', summary: 'Patients with brain metastases may enroll.' }), makeStudy({ title: 'ALMD biomarker research' })]) {
    assertExcluded(study, /No explicit leptomeningeal reference/)
  }
})

test('LM can appear only in inclusion criteria of a broader solid-tumor study', () => {
  const study = makeStudy({ criteria: 'Inclusion Criteria:\nPatients with asymptomatic leptomeningeal disease may enroll.\nExclusion Criteria:\nUncontrolled infection.' })
  assert.deepEqual(filterTrial(study, 45), { include: true })
})

test('a summary cohort or official title can supply the only LM signal', () => {
  assert.deepEqual(filterTrial(makeStudy({ summary: 'Patients with confirmed leptomeningeal disease are eligible.' }), null), { include: true })
  const study = makeStudy()
  study.protocolSection.identificationModule.officialTitle = 'Treatment of leptomeningeal metastases'
  assert.deepEqual(filterTrial(study, null), { include: true })
})

test('an exclusion-only LM mention does not make a broad trial relevant', () => {
  assertExcluded(makeStudy({ criteria: 'Inclusion Criteria:\nAdvanced solid tumors.\nExclusion Criteria:\nLeptomeningeal metastases.' }), /Exclusion criteria contains/)
})

for (const phrase of [
  'No evidence of leptomeningeal disease', 'No radiographic evidence of leptomeningeal metastases',
  'Without leptomeningeal involvement', 'Absence of meningeal metastasis', 'No meningeal metastases',
]) {
  test(`negative inclusion overrides an LM title and condition: ${phrase}`, () => {
    assertExcluded(makeStudy({ conditions: ['Leptomeningeal Disease'], title: 'Leptomeningeal study', criteria: `Inclusion Criteria:\n${phrase}.\nExclusion Criteria:\nInfection.` }), /Inclusion criteria excludes/)
  })
}

test('a dedicated LM condition preserves mixed-cohort studies with exclusion mentions', () => {
  assert.deepEqual(filterTrial(makeStudy({ conditions: ['Leptomeningeal Metastases'], criteria: 'Exclusion Criteria:\nNon-malignant disease interfering with assessment of leptomeningeal symptoms.' }), null), { include: true })
})

test('the patient-language exclusion in a summary still rejects an LM-titled study', () => {
  assertExcluded(makeStudy({ title: 'Leptomeningeal study', summary: 'You cannot take part if the cancer cells have spread to the thin tissue covering the brain and spinal cord.' }), /Brief summary indicates/)
})

test('age bounds are inclusive and checked before accepting a manual override', () => {
  const study = fixture('NCT03202940')
  assert.ok(getManualAuditOverride('NCT03202940')?.siteEligible)
  study.protocolSection.eligibilityModule.minimumAge = '18 Years'
  study.protocolSection.eligibilityModule.maximumAge = '75 Years'
  assert.deepEqual(filterTrial(study, 18), { include: true })
  assert.deepEqual(filterTrial(study, 75), { include: true })
  assertExcluded(study, /outside trial range/, 17)
  assertExcluded(study, /outside trial range/, 76)
  assert.deepEqual(filterTrial(study, null), { include: true })
})

test('NCT03093116 retains asymptomatic LM enrollment despite its symptomatic exclusion', () => {
  const study = fixture('NCT03093116')
  const parsed = parseEligibilityCriteria(study.protocolSection.eligibilityModule.eligibilityCriteria ?? '')
  assert.equal(parsed.sectionFound, true)
  assert.match(parsed.inclusion, /asymptomatic leptomeningeal carcinomatosis are eligible/i)
  assert.match(parsed.exclusion, /Symptomatic brain metastases or leptomeningeal involvement/i)
  assert.deepEqual(filterTrial(study, 45), { include: true })
})

test('NCT03202940 permits LM but mentions LM radiation washout in exclusions', () => {
  const study = fixture('NCT03202940')
  const parsed = parseEligibilityCriteria(study.protocolSection.eligibilityModule.eligibilityCriteria ?? '')
  assert.match(parsed.inclusion, /asymptomatic leptomeningeal disease are eligible/i)
  assert.match(parsed.exclusion, /radiation for leptomeningeal metastasis/i)
  assert.deepEqual(filterTrial(study, 45), { include: true })
  assert.equal(filterByTumorType(study, 'LUNG'), true)
})

test('NCT02896335 permits LM in cohort 2 even though cohort 1 excludes it', () => {
  const study = fixture('NCT02896335')
  const parsed = parseEligibilityCriteria(study.protocolSection.eligibilityModule.eligibilityCriteria ?? '')
  assert.match(parsed.exclusion, /Leptomeningeal involvement is allowed for Cohort 2/i)
  assert.deepEqual(filterTrial(study, 45), { include: true })
  assert.equal(filterByTumorType(study, 'BREAST'), true)
})

test('NCT02616393 preserves a dedicated LM trial with a neurological confounder exclusion', () => {
  const study = fixture('NCT02616393')
  assert.match(parseEligibilityCriteria(study.protocolSection.eligibilityModule.eligibilityCriteria ?? '').exclusion, /Non-malignant neurological disease/i)
  assert.deepEqual(filterTrial(study, 45), { include: true })
  // Changing only the ID also exercises the heuristics without an audited override.
  study.protocolSection.identificationModule.nctId = 'NCT99999999'
  assert.deepEqual(filterTrial(study, 45), { include: true })
})

for (const nctId of ['NCT03083041', 'NCT03417895', 'NCT05984108']) {
  test(`${nctId} stays excluded by its audited classification`, () => {
    assertExcluded(fixture(nctId), /manual audit override/)
  })
}

test('tumor inference distinguishes lung, breast, melanoma, glioma, and other solid tumors', () => {
  for (const [condition, type] of [
    ['Non-small cell lung cancer', 'LUNG'], ['HER2-positive breast cancer', 'BREAST'],
    ['Melanoma', 'MELANOMA'], ['Glioblastoma', 'GBM'], ['Pancreatic adenocarcinoma', 'OTHER_SOLID'],
  ] as const) {
    const study = makeStudy({ conditions: [condition] })
    assert.equal(filterByTumorType(study, type), true)
    assert.equal(filterByTumorType(study, 'any'), true)
    if (type !== 'OTHER_SOLID') assert.equal(filterByTumorType(study, 'OTHER_SOLID'), false)
  }
  assert.equal(filterByTumorType(makeStudy({ conditions: ['Lymphoma'] }), 'OTHER_SOLID'), false)
  assert.equal(filterByTumorType(makeStudy({ conditions: [] }), 'LUNG'), false)
})
