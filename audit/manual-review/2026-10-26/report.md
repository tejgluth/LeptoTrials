# 2026-10-26 weekly LM audit

Release-candidate audit: all three verification passes passed. Production release receipt is recorded after deployment in `release-receipt.json` in this dated evidence directory. This report describes the verified changes; the receipt determines whether production has actually been updated.

## Baseline and scope

Requested clean checkout: `/Users/speakeasy/Projects/websites/Leptomeningeal`, starting commit `51cd104bf36f03510736e08a22077dd5550d7821`, matching `origin/main` and the captured production deployment `1be7bb4a-e4e8-487f-acff-c3e3ccadf2a4`. Remote: `https://github.com/tejgluth/LeptoTrials.git`. Main is unprotected; GitHub quality checks run on pushes and PRs. Previous draft audit PR #2 is closed. The privacy integration that blocked October 17 now exists in clean main and production. No unrelated working changes were present or included.

Previous successful source audit: October 17, 2026; archived ledger and source objects recovered from Git commit `fe2c4c9e03ac508dfb91c5dc1db0239d20b0e3dd`. Prior classifications were checked against current source fields, not accepted as clinical truth. This is coding-assistant development review, not neuro-oncology expert adjudication, and no harness expert records were written.

Counts: 318 -> 320 across the nine selectable statuses; default results 155 -> 157. Broad unfiltered relevance including expanded-access statuses: 320 -> 322. 570 expanded candidates screened, 678 distinct official records reviewed, 529 independent API IDs, 47 IDs from the twelve required web searches, 37 independent API/web IDs outside the expanded export. All 15 displayed records posted after October 17 rechecked. Additions 2; removals 0; bucket reclassifications 0. Fourteen completed conservative exclusions retained; 356 total source records excluded. Membership and per-bucket IDs were captured directly from production before edits.

## Add

- **NCT07361562 — BREAST.** Recruiting, updated September 4, 2026. Registry primary ORR and secondary safety outcomes define Part C breast cancer with brain metastases +/- LM. NYU's investigator study page independently confirms the LM population. Part B establishes NSCLC brain metastases but lacks an equivalent LM connection, so LUNG and OTHER_SOLID are unsupported. The old exclusion overlooked outcome-defined participants. [Registry](https://clinicaltrials.gov/study/NCT07361562), [NYU investigator page](https://clinicaltrials.med.nyu.edu/cancer/clinicaltrial/2954/study-selective-erbb2-inhibitor/).
- **NCT02125786 — general results, no named tumor bucket.** Active, not recruiting, updated February 24, 2026. Ependymoma strata 2/3 treat neuraxis metastatic disease, with residual leptomeningeal dissemination assessed from baseline. Posted protocol section 5.7.2 reserves CSI for dissemination demonstrated by CSF cytology or neuraxis imaging. Registry and protocol exclude metastatic ependymoma below age three: apply a reviewed three-year LM minimum rather than the localized-disease one-year minimum. Ependymoma does not establish GBM or OTHER_SOLID. [Registry](https://clinicaltrials.gov/study/NCT02125786), [official posted protocol](https://cdn.clinicaltrials.gov/large-docs/86/NCT02125786/Prot_SAP_000.pdf).

## Remove

None.

## Reclassify

None among previously displayed records. The two additions correct previous unsupported exclusions, not changes in recruitment status.

## Conservative Decisions / Uncertain Evidence

Fourteen completed conservative exclusions are identified in the ledger: NCT00013533, NCT00949741, NCT01325194, NCT03075072, NCT03213652, NCT03368625, NCT03391362, NCT04527549, NCT04899908, NCT05200143, NCT06440954, NCT06497543, NCT06945705, NCT07415018. They retain no buckets. Reasons include contradictory inclusion/exclusion, lack of an explicit LM exception, or screening/prophylaxis without eligible confirmed LM. The ledger provides source URLs, fields, excerpts, dates, and individual decisions. No human decision queue was created.

NCT02125786's cohort summaries use strict >36-month/<21-year wording, whereas current structured eligibility says 1–21 years and its metastatic exclusion is <3 years. Website filtering uses the current registry's metastatic three-year floor and structured maximum of 21; individual eligibility must be confirmed by the study team. This source discrepancy is retained in its ledger entry rather than concealed.

## No Change But Rechecked

Every previously displayed record and bucket retained after current-source screening, complete source comparison, and current inclusion/exclusion/cohort/outcome review. Fifteen displayed records posted since October 17: NCT02446457, NCT04181060, NCT05257967, NCT05305365, NCT05904080, NCT06422806, NCT06462222, NCT06465316, NCT06492915, NCT06589804, NCT06728865, NCT07134153, NCT07624201, NCT07647432, NCT07789912.

Notable updates: NCT06462222 changes hepatitis-related exclusion wording, without changing its OTHER_SOLID LM path. NCT05305365 updates arms/outcomes and retains BREAST + OTHER_SOLID; separate lung metadata remain insufficient for LUNG. NCT07134153 corrects first enrollment to May 12, 2025 and retains BREAST. Current registry status, dates, cohorts, locations, supporting excerpts and all before/after buckets are in `decision-ledger.json` and the immutable source archive.

NCT07365410 retains LUNG: asymptomatic meningeal patients are explicitly described in outcome measures; its symptomatic exclusion does not veto that cohort. NCT05984108 retains MELANOMA for explicitly named malignant primary meningeal melanocytic cohorts. NCT06440954/NCT06497543 retain exclusion because current LM inclusion still conflicts with unqualified meningeal exclusions. NCT05200143's independent melanoma-LM exclusion is not clearly superseded by a later generic CNS stability clause.

## Bugs / Security Fixes

No additional confirmed runtime/security defect requiring a production code change was found. Retrieval, pagination caps/repeated-token detection, retries/cancellation, schema validation, deduplication, status/phase/geography/age filters, rendering, safe NCT URLs and normalized mailto links, privacy preferences, bounded JSON request bodies, same-origin checks, aggregate-only contact counters and admin authorization were inspected and tested.

Restored the requested read-only export npm commands, intentionally removed during October 19 cleanup. The new exporter does not regenerate clinical decisions or modify the separate harness/expert store. It records complete query/page coverage and retrieval timestamps, validates deduplicated counts against API totals, fails explicitly on retrieval errors, and writes success atomically. `manualAuditOverrides.ts` remains the repository's hand-maintained authority. No obsolete override generator or historical authoritative manifest was reintroduced.

Added five source-derived regression fixtures and updated the existing NCT07361562 fixture. Tests cover both additions, unsupported named tumor assignments, the ependymoma LM age floor, current updated positive cohorts, and a plausible false positive where a treated brain exception does not permit lymphomatous meningitis. Live must-include/must-exclude assertions were corrected only where independent evidence justified a change.

## Verification: Pass 1, Pass 2, Pass 3

**Pass 1 — independent sources:** all 678 reviewed IDs refetched independently using paginated query.id batches. Full protocol objects match the initial discovery captures, with zero changes. Primary registry evidence reread for both additions; corroborating NYU source and the complete posted ependymoma protocol resolve the prior exclusions. All old and new bucket assignments checked against LM-related cohort context.

**Pass 2 — code/data/tests:** `npm run check` passed 188 tests, ESLint, TypeScript and the production build. `npm run validate:trials -- --fresh --json` passed 46,656 synthetic filter combinations and 17 live comparisons, with zero oracle mismatches, regression failures or query mismatches. Scenarios include all tumor buckets/general results, pediatric/adult ages and boundaries, geography, statuses, phases, study types and combined filters. Final exports reconciled to every ledger inclusion and bucket. Final diff checked for unrelated changes and whitespace errors. No check was weakened or suppressed.

**Pass 3 — browser/runtime:** tested the actual production build with Cloudflare Pages Functions and a local D1 database migrated to the current production schema. Configured local analytics rejects anonymous access (401) and accepts the local-only test credential (200); unconfigured local admin mode initially returned the expected 503. Live production secret values were neither read nor changed. No production schema migrations are required.

Browser plugin not available; used the available Playwright connector. Desktop 1440, tablet 768 and mobile 390 screenshots visually inspected; no horizontal overflow. Reduced and normal motion checked. Exact browser IDs reconcile to the ledger: all statuses 320; LUNG 107, BREAST 60, MELANOMA 14, GBM 8, OTHER_SOLID 113. Default 157. Age checks 1/2 exclude both additions; age 3 includes only the ependymoma addition; 17 excludes the breast addition; 18 includes both; 22 excludes ependymoma. Combined adult/US/BREAST/interventional/phase-2 returns 17 exact verified IDs. Empty, loading, malformed-upstream error and retry states checked; incomplete upstream data show an error with zero cards, and retry restores 157. Summary expansion, official CTgov popup including eligibility/locations, valid contact draft URL and real clipboard copy checked. No trial team messages were sent. Clean final console has zero errors/warnings and no framework overlay.

A production API health probe incremented one synthetic email-copy counter because Chrome strips a manually set DNT header. That probe's one increment was removed, and its now-zero row removed conditionally; exact mutation receipts are saved. No other analytics records were changed. Python's default user agent was blocked by existing Cloudflare WAF 1010; actual browser verification returned homepage/privacy 200, contact-events GET405, private analytics401, retired suggestions410. Neither test-harness routing errors nor WAF responses were represented as application failures or silently ignored.

## Production Release

Verified account `d30edc14f902d872014ce43c0a5f4fec`, Pages project `lm-trials`, production branch `main`, domains `leptotrials.com` and `leptotrials.pages.dev`, and Git repository identity `1182688009` (the Cloudflare source still uses the repository's old display name). GitHub quality workflow runs on push and PR; preview builds lack the production-only analytics secret, which is an expected environment difference. Supported rollback is POST `/accounts/d30edc14f902d872014ce43c0a5f4fec/pages/projects/lm-trials/deployments/1be7bb4a-e4e8-487f-acff-c3e3ccadf2a4/rollback` followed by live verification.

The inspected `npm run deploy` rebuilds and runs `wrangler pages deploy dist --project-name lm-trials`; any direct production deployment must explicitly supply `--branch main` and the verified commit. Prefer the established GitHub-to-Pages release path after passing PR checks. Actual pushed/merged commit, deployment ID, asset equality and live post-release verification are saved in `release-receipt.json` after release. A preview or successful build alone is not a production release. Rollback is required if live verification fails.

## Coverage / Method

All twelve requested concepts searched independently with both query.term and query.cond: leptomeningeal metastasis; leptomeningeal metastases; leptomeningeal disease; leptomeningeal carcinomatosis; neoplastic meningitis; carcinomatous meningitis; meningeal metastasis; meningeal metastases; leptomeningeal neoplasm; malignant neoplasm in the leptomeninges; lymphomatous meningitis; leukemic meningitis. All 24 API searches and the expanded search suite followed pagination and deduplicated NCT IDs. Twelve independent web searches supplemented the API; 20 web-only records outside the API/expanded/raw union received complete official record review. No registry requests remain unresolved. Fourteen conservative decisions are completed exclusions, not missing-access cases.

Registry facts are current to saved retrieval timestamps; search coverage is limited to these documented queries and reviewed records, not an assertion of exhaustive worldwide trial coverage. The 678 count includes displayed, expanded, independently discovered and excluded records, while 570 is the expanded candidate count. The 37 independent candidates outside expanded are discoveries relative to this export, not necessarily newly registered trials.

Full raw records are stored once in `source-records.json.gz`; baseline/final export snapshots retain query coverage, retrieval times, hashes, classifications and references to that archive to avoid duplicating tens of megabytes. Independent second captures are in `pass-1-refetched.json.gz`. `decision-ledger.json` records each study's current title/status/date, source URL, supporting field excerpts with section context, rationale, supported buckets, previous/resulting classification, uncertainty and access limitations. Source JSON field/order differences are normalized for full protocol comparisons. The detailed browser and automated check outputs, production membership captures, backend schema, protocol PDF and artifact hashes are saved alongside this report.
