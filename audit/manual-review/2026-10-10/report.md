# Weekly LM Trial Audit — 2026-10-10

**Blocked by operational access or failed verification.** The source-backed application changes pass clinical/data and automated checks. Cloudflare runtime testing found that releasing clean main would remove the existing privacy route and reactivate deliberately retired trial-suggestion collection. The requested checkout contains unrelated uncommitted work implementing that live behavior; none of it was copied, committed or deployed.

Clean-main audit universe: **299 → 311** (15 additions, 3 removals, 13 bucket reclassifications). Selectable-status browser universe: **297 → 309**. Current production: **237 → 237**, unchanged. The candidate differs from live production by 74 selectable additions, 2 removals and 12 bucket changes because main already contains earlier unreleased audit corrections. The two broader-universe-only records are NCT02755987 and NCT05064306, both NO_LONGER_AVAILABLE expanded-access records; their absence under selectable status filters is expected.

Coverage: 697 current official records, 568 expanded candidates, 527 independently queried API IDs plus 55 web-search IDs (566 unique combined; 50 outside the expanded export), 468 source/cohort reviews and 229 full-record signal screens. Ten displayed records updated since the last successful source audit on 2026-10-04 were re-reviewed. There are 386 excluded records, including 21 expressly documented conservative eligibility decisions. The 77 changed override entries include classification-preserving conversions of inferred results to reviewed overrides.

## Add

| Study | Resulting buckets | Source-grounded decision |
|---|---|---|
| [NCT00570908](https://clinicaltrials.gov/study/NCT00570908) | BREAST | HER2-positive breast cancer eligibility expressly permits concurrent leptomeningeal carcinomatosis with brain metastases. LM-only disease and planned intrathecal chemotherapy are excluded. |
| [NCT02838420](https://clinicaltrials.gov/study/NCT02838420) | LUNG | ALK-positive NSCLC eligibility expressly allows previous brain or leptomeningeal metastases when asymptomatic. |
| [NCT02971501](https://clinicaltrials.gov/study/NCT02971501) | LUNG | NSCLC inclusion expressly permits asymptomatic leptomeningeal disease; symptomatic LM is excluded. |
| [NCT03053297](https://clinicaltrials.gov/study/NCT03053297) | LUNG | Observational advanced/metastatic NSCLC cohorts explicitly collect leptomeningeal-metastasis patient outcomes and associated CNS treatment; eligibility does not exclude those patients. |
| [NCT04739358](https://clinicaltrials.gov/study/NCT04739358) | LUNG | MET-driven NSCLC eligibility expressly permits MRI/CSF-confirmed leptomeningeal disease when not the only disease site; isolated LM is excluded. |
| [NCT05372614](https://clinicaltrials.gov/study/NCT05372614) | OTHER_SOLID | Solid-tumor eligibility expressly permits leptomeningeal metastases without progressive clinical symptoms or impending CNS compromise. No named tumor-specific LM path. |
| [NCT05388877](https://clinicaltrials.gov/study/NCT05388877) | MELANOMA | Melanoma eligibility expressly allows leptomeningeal disease with measurable systemic disease; read with CNS restrictions. |
| [NCT05843253](https://clinicaltrials.gov/study/NCT05843253) | General only | Part 2 stratum D explicitly treats disseminated/metastatic high-grade glioma with craniospinal irradiation, and eligibility discusses prior spinal leptomeningeal radiation. GBM appears in a separate broad condition list, without explicit connection to this stratum; retain general relevance only. |
| [NCT05991518](https://clinicaltrials.gov/study/NCT05991518) | OTHER_SOLID | Advanced HER2-positive solid-tumor eligibility expressly allows previously treated meningeal metastases stable at least two months, with the specified steroid washout. This exception is repeated for the study parts. |
| [NCT07612488](https://clinicaltrials.gov/study/NCT07612488) | General only | Meningeal-metastasis exclusion expressly excepts glioma. No explicit glioblastoma diagnosis tied to that exception; include only in general results. |

| [NCT02446457](https://clinicaltrials.gov/study/NCT02446457) | General only | Follicular/DLBCL lymphoma exclusion explicitly permits previously treated lymphomatous meningitis stable at least four weeks, neurologic recovery and steroid washout. Hematologic LM: general only. |
| [NCT02535247](https://clinicaltrials.gov/study/NCT02535247) | General only | NK/T-cell lymphoma criteria exclude active lymphomatous meningitis but explicitly permit previously treated CNS lymphoma involvement when stable at least four weeks, neurologic recovery and steroid washout. General only. |
| [NCT03360929](https://clinicaltrials.gov/study/NCT03360929) | LUNG | EGFR-mutant NSCLC inclusion explicitly requires brain and/or LM disease, specifies positive malignant CSF cytology and MRI-visible leptomeningeal lesions; MRI alone is insufficient. Read with whole-brain-radiotherapy and CNS-control exclusions. |
| [NCT07362940](https://clinicaltrials.gov/study/NCT07362940) | LUNG | EGFR-mutant NSCLC inclusion expressly permits investigator-confirmed stable meningeal metastasis in the dose-expansion stage. Other stage and CNS stability restrictions remain applicable. |
| [NCT07502027](https://clinicaltrials.gov/study/NCT07502027) | OTHER_SOLID | Gastric/GEJ adenocarcinoma criteria exclude active/untreated meningeal or leptomeningeal disease but expressly permit patients in this combined CNS clause after treatment when asymptomatic, radiologically stable at least four weeks, with measurable extracranial lesions and two-week steroid/anticonvulsant washout. OTHER_SOLID only. |

## Remove

| Study | Resulting buckets | Source-grounded decision |
|---|---|---|
| [NCT06440954](https://clinicaltrials.gov/study/NCT06440954) | Excluded; none | Dedicated NSCLC LM title and inclusion conflict with an unqualified exclusion for meningeal metastasis. No public protocol or explicit exemption scopes that exclusion; conservatively exclude until official criteria establish a consistent eligibility path. |
| [NCT06497543](https://clinicaltrials.gov/study/NCT06497543) | Excluded; none | SCLC LM cohort 2 is described, but the full criteria also unconditionally exclude meningeal metastasis without a cohort exemption. Additional official-record and protocol searches did not resolve that conflict; conservatively exclude the unsupported eligibility claim. |
| [NCT07361562](https://clinicaltrials.gov/study/NCT07361562) | Excluded; none | Current official eligibility and all three arms describe ERBB2/HER2 solid-tumor cohorts but establish no eligible malignant LM population. Neurologic corticosteroid restrictions are not an affirmative LM path. A stale breast override must not create eligibility. |

## Reclassify

| Study | Resulting buckets | Source-grounded decision |
|---|---|---|
| [NCT00924820](https://clinicaltrials.gov/study/NCT00924820) | LUNG, BREAST, MELANOMA | The same neoplastic-meningitis inclusion path requires breast cancer, lung cancer or melanoma and CSF/imaging diagnosis. Named histologies are directly tied to LM, unlike separate cohorts. |
| [NCT01654497](https://clinicaltrials.gov/study/NCT01654497) | General only | Eligible brain-cancer diagnoses list glioblastoma and leptomeningeal metastasis separately. No explicit tumor origin for the malignant LM category supports either GBM or all-comers solid-tumor assignment. |
| [NCT01713699](https://clinicaltrials.gov/study/NCT01713699) | LUNG, BREAST, OTHER_SOLID | Suspected/confirmed LM diagnostic pathway requires advanced EpCAM-positive solid tumors and explicitly names breast and lung cancer in those same inclusion criteria. |
| [NCT02423525](https://clinicaltrials.gov/study/NCT02423525) | General only | The brain-cancer population lists glioblastoma, other CNS tumors, and leptomeningeal metastasis as separate diagnostic categories. Retain malignant LM relevance without an unsupported GBM or solid-tumor-origin assignment. |
| [NCT03719768](https://clinicaltrials.gov/study/NCT03719768) | BREAST, OTHER_SOLID | Solid malignancies with cancerous CSF or clinical LM are eligible; the same eligibility section specifically permits continuing treatment for triple-negative breast cancer within this LM protocol. |
| [NCT03911388](https://clinicaltrials.gov/study/NCT03911388) | GBM | Single eligible malignant cerebellar-tumor population explicitly names glioblastoma/giant-cell glioblastoma; its G207 intervention expressly includes radiation to progressive leptomeningeal disease, without a separate histology-restricted LM cohort. |
| [NCT04500548](https://clinicaltrials.gov/study/NCT04500548) | OTHER_SOLID | The recurrent solid-malignancy inclusion population (also allowing lymphoma) expressly permits new/progressive LM in part 2 when immediate CNS therapy is unnecessary. No explicit GBM-to-LM link. |
| [NCT04588545](https://clinicaltrials.gov/study/NCT04588545) | BREAST, OTHER_SOLID | HER2-positive breast LM population is explicit, and the same inclusion section additionally allows all HER2-positive cancers with LMD. Retain named breast and general solid-tumor paths. |
| [NCT06146010](https://clinicaltrials.gov/study/NCT06146010) | General only | All-cancer meningeosis-neoplastica registry does not positively restrict the LM population to solid tumors or explicitly identify a named tumor path; retain general results only. |
| [NCT07331064](https://clinicaltrials.gov/study/NCT07331064) | General only | The explicit leptomeningeal-seeding assessment is linked to ATRT, while high-grade glioma is a separate population. CNS-primary/high-grade glioma does not by itself establish GBM in the LM path. |
| [NCT07681297](https://clinicaltrials.gov/study/NCT07681297) | LUNG, BREAST, OTHER_SOLID | The CNS cohort allows LM and expressly includes EGFR/ALK NSCLC and HER2-positive metastatic breast cancer with required prior targeted therapies in that same cohort. Other solid tumors remain eligible. |
| [NCT07689721](https://clinicaltrials.gov/study/NCT07689721) | LUNG, BREAST | CSF/ctDNA-positive CNS cohort explicitly includes NSCLC and HER2-positive/triple-negative breast cancer. Recurrent high-grade glioma alone does not establish glioblastoma. |
| [NCT07751744](https://clinicaltrials.gov/study/NCT07751744) | OTHER_SOLID | Separate high-grade-glioma and brain-metastasis cohorts cannot supply GBM or disease-specific labels for the distinct all-comers solid-tumor LM cohort. |

## Conservative Decisions / Uncertain Evidence

All decisions below are completed under the supplied policy. No human classification queue is created. The contradictory records NCT06440954 and NCT06497543 are excluded because their unconditional meningeal-metastasis exclusion cannot be reconciled to the advertised LM inclusion/cohort using available official material. NCT07361562 is excluded because its current source has no affirmative malignant LM eligibility path. General relevance is retained while unsupported GBM/solid-origin labels are removed where the LM cohort or tumor origin is separate/unspecified.

- [NCT06945705](https://clinicaltrials.gov/study/NCT06945705): excluded, no buckets. Only LM without brain metastasis is excluded and there is no explicit eligible LM exception or cohort; do not infer a path from a qualified exclusion.
- [NCT07415018](https://clinicaltrials.gov/study/NCT07415018): excluded, no buckets. Confirmed imaging/cytology LM is excluded; suspected/high-risk disease is not a confirmed malignant LM eligibility cohort.
- [NCT05319873](https://clinicaltrials.gov/study/NCT05319873): excluded, no buckets. Phase IB excludes known/suspected LM and the other phase does not expressly establish an eligible LM path.
- [NCT06492915](https://clinicaltrials.gov/study/NCT06492915): excluded, no buckets. Active/symptomatic LM is excluded; a generic stable-CNS exception does not establish an affirmative meningeal eligibility path.
- [NCT01325194](https://clinicaltrials.gov/study/NCT01325194): excluded, no buckets. Overt MRI/CSF-cytology CNS disease is excluded; below-threshold flow cytometry/prophylaxis does not establish a confirmed malignant LM cohort.
- [NCT00949741](https://clinicaltrials.gov/study/NCT00949741): excluded, no buckets. Clinical or instrumental meningeal localization is excluded; high-risk screening is not an eligible malignant LM cohort.
- [NCT01712659](https://clinicaltrials.gov/study/NCT01712659): excluded, no buckets. Symptomatic leukemic meningitis is excluded and no affirmative eligible leukemic-meningitis population is established.
- [NCT03075072](https://clinicaltrials.gov/study/NCT03075072): excluded, no buckets. Widespread LM is excluded; no explicit remaining eligible LM path is established.
- [NCT03391362](https://clinicaltrials.gov/study/NCT03391362): excluded, no buckets. Widespread LM is excluded; no explicit remaining eligible LM path is established.
- [NCT03368625](https://clinicaltrials.gov/study/NCT03368625): excluded, no buckets. Widespread LM is excluded; no explicit remaining eligible LM path is established.
- [NCT04899908](https://clinicaltrials.gov/study/NCT04899908): excluded, no buckets. Extensive LM exclusion is not positive evidence of an eligible limited LM cohort.

NCT04543188 retains OTHER_SOLID: its specifically designated LM cohort 5 is corroborated by the [sponsor investigator abstract](https://ascopubs.org/doi/10.1200/JCO.2021.39.15_suppl.TPS3152) and [NCI listing](https://www.cancer.gov/research/participate/clinical-trials-search/v?id=NCI-2020-08201). The generic LM exclusion is documented as a material conflict. NCI administrative-complete status differs from the registry status; the website uses current ClinicalTrials.gov registry facts.

No registry study was excluded because retrieval failed. All 668 requested source records were available. Public protocol searches did not provide a resolving protocol for the two contradictory intrathecal-pemetrexed records.

- [NCT00795340](https://clinicaltrials.gov/study/NCT00795340): excluded, no buckets. Untreated brain or meningeal metastases are excluded; the express stable-treated exception names only brain metastases, not meningeal disease. No affirmative eligible LM path.
- [NCT02540876](https://clinicaltrials.gov/study/NCT02540876): excluded, no buckets. Untreated brain or meningeal metastases are excluded; the express stable-treated exception names only brain metastases. No affirmative eligible LM path.
- [NCT03213652](https://clinicaltrials.gov/study/NCT03213652): excluded, no buckets. Non-RECIST-measurable leptomeningeal lesions do not qualify as measurable disease; this measurement restriction alone does not explicitly establish an eligible LM cohort in the mixed Pediatric MATCH population. Conservatively exclude unsupported inclusion.
- [NCT04309968](https://clinicaltrials.gov/study/NCT04309968): excluded, no buckets. Symptomatic/uncontrolled meningeal metastasis is excluded; absence of an exclusion for other cases is not an explicit eligible LM path.
- [NCT04914286](https://clinicaltrials.gov/study/NCT04914286): excluded, no buckets. Active CNS involvement including meningeal metastasis is excluded; no explicit stable/treated meningeal exception or LM cohort.
- [NCT05627245](https://clinicaltrials.gov/study/NCT05627245): excluded, no buckets. Active lymphomatous meningitis is excluded without an explicit eligible treated/stable LM exception or cohort.
- [NCT06258408](https://clinicaltrials.gov/study/NCT06258408): excluded, no buckets. Symptomatic/uncontrolled metastases to the meninges are excluded; the qualified exclusion does not positively establish an eligible malignant LM population.

## No Change But Rechecked

All 299 clean-main displayed studies, including all 237 actual production displayed IDs, were rechecked against current registry fields and cohort/exclusion context. The ledger stores title, status, update/retrieval dates, field excerpts, direct source, prior main and actual production bucket assignments, resulting labels and uncertainty. The full record archive preserves complete inclusion/exclusion text, arms, location and registry status data.

Recently updated displayed records (retain existing relevance/buckets):

- [NCT02422641](https://clinicaltrials.gov/study/NCT02422641): RECRUITING, updated 2026-10-05; BREAST.
- [NCT03816345](https://clinicaltrials.gov/study/NCT03816345): RECRUITING, updated 2026-10-05; OTHER_SOLID.
- [NCT04181060](https://clinicaltrials.gov/study/NCT04181060): RECRUITING, updated 2026-10-09; LUNG.
- [NCT04527549](https://clinicaltrials.gov/study/NCT04527549): TERMINATED, updated 2026-10-06; MELANOMA.
- [NCT05810350](https://clinicaltrials.gov/study/NCT05810350): COMPLETED, updated 2026-10-05; LUNG.
- [NCT05967689](https://clinicaltrials.gov/study/NCT05967689): RECRUITING, updated 2026-10-06; LUNG.
- [NCT06422806](https://clinicaltrials.gov/study/NCT06422806): RECRUITING, updated 2026-10-07; OTHER_SOLID.
- [NCT06465316](https://clinicaltrials.gov/study/NCT06465316): RECRUITING, updated 2026-10-05; general only.
- [NCT06589804](https://clinicaltrials.gov/study/NCT06589804): RECRUITING, updated 2026-10-09; OTHER_SOLID.
- [NCT07647432](https://clinicaltrials.gov/study/NCT07647432): NOT_YET_RECRUITING, updated 2026-10-06; general only.

NCT05865990 remains relevant in OTHER_SOLID, but its COMPLETED registry status means it belongs in all-status history rather than the default active-status regression. NCT07704034 retains OTHER_SOLID and NCT07789912 retains LUNG/BREAST/OTHER_SOLID in clean main; their current production labels differ from these already-reviewed main assignments.

## Bugs / Security Fixes

- Validate registry page/study identity and required rendering/filtering fields; malformed or missing study arrays now reject rather than becoming successful empty universes. A valid empty response remains supported.
- Follow supplemental pagination, deduplicate and verify every requested audited ID. Add all fifteen newly verified eligible studies to supplemental retrieval.
- Retry transient network errors, HTTP 429 and server failures with bounded exponential backoff, cancellation and a 30-second request deadline. Audit tools reuse that validated path.
- Remove silent stale-cache fallback from validator/reconciliation; use --fresh for release verification. Fresh exports fail explicitly if retrieval/pagination is incomplete.
- Use a dated authoritative classification manifest for override generation/reconciliation. Validate IDs, uniqueness, booleans and allowed buckets; preserve historical review batches rather than overwriting their decisions with blank templates. Reconciliation now includes supplemental studies and ENROLLING_BY_INVITATION.
- Actually execute named registry regressions, which previously were skipped because generated matrix scenario names never matched. Correct the closed-status expectation from source evidence, retaining an all-status positive assertion and default-status negative assertion.
- Stop treating unexpanded LMD acronym matches as malignant LM and high-grade glioma/anaplastic astrocytoma as automatic GBM. Source-specific reviewed exceptions remain supported.
- Enforce the contact-event 2 KiB limit while streaming, cancelling oversized requests before their full body is consumed. Share the existing bounded JSON reader with suggestions; reject media types that merely begin with application/json.
- Announce error, loading and empty states through accessible alert/status roles; preserve layout and visual styling.

## Verification: Pass 1, Pass 2, Pass 3

**Pass 1 — independent source verification:** Re-fetched 88 official records covering all 77 changed overrides, all ten recently updated displayed studies and the closed-status regression. Reread identity, dates/status, LM cohort relationships, inclusion/exclusion context and resulting tumor assignments. Protocol-section hashes were unchanged for every record. Full refetches and source archives have SHA-256 manifests.

**Pass 2 — code/data/automated verification:** npm run check passes 161 tests, lint and the production build. npm run validate:trials -- --json --fresh passes 46,656 local scenarios and 16 live query comparisons with zero oracle, named-regression or query mismatches. Named cases are now explicitly executed. Age profiles include newborns, six months, 2/3 years and adult boundaries (17/18, 21/22, 70/75/76), all five buckets/general results, study types, phase combinations, geography/continents and recruitment statuses. Ninety-four frozen current-source fixtures include every changed override, recent updates, hematologic/CNS-primary cases and plausible false positives. The projection oracle shares reviewed overrides; source review and independently documented expected fixtures provide the clinical evidence rather than treating agreement between two projections as clinical ground truth. Fresh reconciliation checks 376 authoritative overrides with zero eligibility/bucket mismatches. Regenerated audit exports have 417 raw/311 relevant records and 568 expanded candidates.

**Pass 3 — browser/runtime verification:** Tested the production build with actual Cloudflare Pages Functions locally; live registry search, all five tumor filters, pediatric profile, age/location/phase combined empty state, malformed response error, loading announcement, retry recovery, summary expansion, official-source popup and encoded contact-email/copy interaction work. No message was sent to a trial team. Browser result sets match ledger projections exactly: default 153; LUNG 53, BREAST 30, MELANOMA 6, GBM 7, OTHER_SOLID 52; all nine selectable statuses 309. Desktop 1440×900, tablet 768×1024 and mobile 390×844 were visually inspected after animations settled; controls have labels and reduced-motion results have full opacity. Browser console recorded zero errors.

**Release gate failed:** With the observed production D1 schema reproduced locally and a local test-only admin token, a clean-main suggestion submission returns 503 and the runtime logs no such table: suggestion_rate_limits. Local /privacy renders the search homepage, while live production renders privacy content and returns intentional HTTP 410 for suggestions. This candidate cannot preserve current production behavior without integrating the unrelated uncommitted privacy/retirement work. No merge, migration or deployment was attempted.

## Production Release

- Production project lm-trials, Cloudflare account d30edc14f902d872014ce43c0a5f4fec, branch main, domain https://leptotrials.com were verified before any release action. package.json deploy runs build then wrangler pages deploy dist --project-name lm-trials; a future eligible release must explicitly target --branch main.
- Starting isolated main commit: 8a2e4260068cda10a99335c22b6387a0bea4a424. The remote remained at that commit during final verification. GitHub authentication and Cloudflare Pages/D1 read access were available; the branch was not protected.
- Preserved production deployment: e32dcbfd-60e3-4b4b-a795-72f1b41a67cf, https://e32dcbfd.leptotrials.pages.dev. Its source label is e3116e0, but live privacy/retirement behavior is absent from the corresponding clean Git source. Deployment metadata is not proof of a reproducible clean artifact.
- Final live checks: homepage/privacy and asset return 200, contact-event GET returns expected 405, private analytics GET returns 401, and the intentionally retired suggestion route returns 410 with an explicit no-longer-collected response. The live asset remains index-BHUhDcBw.js. Production was not changed; there is no new deployment identity or rollback.
- Supported rollback: authenticated Cloudflare Pages deployment rollback API/dashboard for an eligible previous successful production deployment. [Official rollback API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/rollback/). No remote database migration or mutation occurred.
- The code/evidence commit, pushed PR and CI identity are recorded after preservation in release-status.json and the final response.

## Coverage / Method

Ran inspected existing export:audit-universe, export:expanded-candidates and validate:trials tools before changes, then regenerated/reconciled after changes. Independent API search covered all twelve requested phrases in both query.term and query.cond (24 fully paginated queries, 527 distinct IDs). ID queries filled gaps from displayed studies, expanded candidates, previous reports, web discoveries and all prior overrides. The coverage ledger records exact phrases, pages, IDs, retrieval timestamps and failures; all requests completed without unresolved retrieval failures.

Independent web searches covered all twelve phrases explicitly and individually (web-coverage.json), with 55 distinct IDs; 29 IDs outside the original source set were retrieved and reviewed. Five have explicit eligible malignant LM paths; 24 were excluded. API and web searches together discovered 566 unique IDs, including 50 outside the expanded export. Earlier synonym-paired searches supplied additional official context; official trial pages and public sponsor/NCI materials were used for additional context. Additional protocol searches targeted NCT06440954, NCT06497543 and NCT04543188. API fields for every expanded candidate were screened across title, official title, conditions, summary, detail, eligibility and arms; potentially relevant references received cohort/exclusion review. Source capture does not establish personal patient eligibility or exhaust every possible registry synonym/public protocol. Registry status, relevance, geography, age and other filters remain separate.

Evidence files: decision-ledger.json, source-records.json.gz, pass-1-refetched.json.gz, source-archives.json, query-coverage.json, baseline snapshots, browser verification/screenshots, browser-final-default.json, browser-final-all-statuses.json, browser-final-buckets.json, web-coverage.json, final-check.txt, final-validation.txt, run-metadata.json, production-health-final.json and deployment-baseline.json. Authoritative runtime inputs are audit/manual-review/classification-decisions.json; npm run generate:manual-audit-overrides regenerates src/utils/manualAuditOverrides.ts. Historical review-batch files are retained as prior context and are no longer authoritative.

Reproduce locally from the audit branch: npm ci; npm run check; npm run validate:trials -- --json --fresh; npm run dev:cloudflare. Release compatibility remains failed until the live privacy/retirement state has a reproducible, verified source integration.
