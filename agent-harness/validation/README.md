# Temporal validation data and honest evaluation

Current development follow-up: [rejected-output diagnosis and production comparison](reports/2026-10-18-rejection-diagnosis.md).
The original 50-record execution report is [here](reports/2026-10-18-aact-development-v1_1-execution.md).
New semantic-policy warnings are separate from source/decision integrity; applying
stricter checks must not silently remove old records or change historical counts.

The new [reconciled AACT source collection](reports/2026-10-18-aact-reconciliation.md)
contains all ten accepted annual inputs, explicitly replacing the disputed October
2020 archive with September 2020. Complete source preparation and small development
model runs are different milestones: the former covers 275,563 broad candidate
record-round pairs; the latter selects 50 records (47 NCT IDs, 50 versions), not
full-population inference or expert-validated accuracy. See the report for exact
dates, source hashes, selection seed and live-job location.

There are two separate input tracks: genuine dated AACT snapshots (see
[acquisition instructions](../docs/historical-aact.md) and the
[annual source plan](sources/aact-annual-2026-10-18.json)), and the older API-derived
unchanged-record subsets below. Do not combine their counts or describe the latter
as full historical populations. Ready AACT manifests and large source tables are
local generated artifacts under `output/aact-historical/` and `output/aact-source/`.
The [2017 full-snapshot routing inspection](reports/2026-10-18-aact-2017-dry-run.md)
checked all 17,926 saved source/decision artifacts with no integrity issues and no
model calls. It is not an expert accuracy evaluation. The initial local round-02/03/04
imports are superseded for date mapping by `output/aact-historical-v2/`; see the
archive instructions before selecting manifests.

Ten new retrospective API-derived subsets were captured on 2026-10-18 UTC
(2026-10-17 America/Los_Angeles), using annual cutoffs spanning 2017–2026.

| Round | Cutoff | Candidate records |
| --- | --- | ---: |
| 01 | 2017-10-17 | 400 |
| 02 | 2018-10-17 | 467 |
| 03 | 2019-10-17 | 530 |
| 04 | 2020-10-17 | 617 |
| 05 | 2021-10-17 | 720 |
| 06 | 2022-10-17 | 811 |
| 07 | 2023-10-17 | 934 |
| 08 | 2024-10-17 | 1,098 |
| 09 | 2025-10-17 | 1,339 |
| 10 | 2026-10-17 | 1,928 |

These contain 8,844 record-round pairs and 1,928 unique normalized inputs. Inputs
are deduplicated in `records/registry-inputs.json.gz`; each manifest selects exact
content hashes in order and verifies the compressed archive's SHA-256. Public registry
text, full eligibility and source references are preserved. Raw API responses are also
stored locally under `output/retrospective-2026-10-17/rounds/`, outside version control.

**These are not complete as-of historical populations.** ClinicalTrials.gov API v2
serves current versions. The history endpoint returned HTTP 403 in this environment.
Each search therefore requires both first-post and latest-update-post dates to be
on/before its cutoff, verifies both bounds per response, and uses all recruitment
statuses. Records modified after a cutoff are excluded, even if they were relevant
then. This creates survivor/selection bias and cannot measure full historical retrieval
recall. The current registry's terminology indexing may also differ from historical
indexing. Do not call this reconstruction of the original ten-round experiment.

NIH describes the [public API as providing the most recent study version](https://data.nih.gov/data-sources/clinicaltrialsgov-api).
For genuine as-of populations, [AACT offers downloadable historical snapshots through account access](https://aact.ctti-clinicaltrials.org/landing).
Those relational archives require a provenance-preserving import, not current API text
substituted for older versions. Archive access/import and independent expert adjudication
remain distinct from the unchanged-record execution tests already captured here.

The new rounds have role `new_retrospective_subset_evaluation`; none is labeled an
independent historical held-out set. Many inputs repeat across cutoffs. A valid
independent evaluation needs a declared sampling design, true frozen as-of snapshots,
and independent source-checked neuro-oncology reference adjudications. API calls and
another model do not establish expert truth.

Reproduce capture into a new directory:

```bash
leptotrials-harness fetch-historical --dates \
  2017-10-17 2018-10-17 2019-10-17 2020-10-17 2021-10-17 \
  2022-10-17 2023-10-17 2024-10-17 2025-10-17 2026-10-17 \
  --destination output/new-retrospective-capture

# Reproduce routing from the checked-in frozen inputs without model calls
leptotrials-harness validate-all --dry-run

# New model-backed classifications from the same inputs
leptotrials-harness --config config/openai.yaml validate-all
```

Fresh capture may differ if registry records have changed; rerun the frozen manifests
for matched-input comparison. Original historical snapshots can instead be imported
using `import-snapshot`; the JSON needs `snapshot_date` and `studies` (archived API-v2
records). Import never substitutes current registry text.

Each round's `adjudications` field is null until genuine references exist. To attach
them, create a **new versioned manifest** pointing to an expert adjudication JSON file
bound to each input's content hash. Do not overwrite model decisions or fabricate
reviewer identities. Experts should inspect source independently; a corrected rerun
of development examples is not an independent final test.

Per-run inputs, decisions, raw model responses, review packet, metrics and manifest
live in `output/runs/RUN`. A round's `validation.json` explicitly distinguishes dry
run, model-only classifications and expert-adjudicated evaluation. Aggregate reports
live in `output/validation/`. Public summaries of actually executed checks belong
in `validation/reports/`. Private reviewer notes must remain outside version control.

### Actual local execution, October 18, 2026

The detached Ollama run stopped at its requested 11 AM Pacific deadline. Its
[execution report](reports/2026-10-18-ollama-overnight.md) preserves the exact counts
and failure diagnostics. It processed 400 records in round 01 (79 model/schema/evidence
failures), then 246 records of round 02 before interruption (57 failures). Together
with four separately identified synthetic smoke cases, this is 650 record-round
decisions, not 650 unique trials. Model-backed rounds 03–10 were not reached by that
local run. All ten frozen dry-run routing checks completed.

All 650 saved decisions passed source/decision fingerprint inspection. Exact source
quotes/schema compliance do not establish semantic clinical correctness. The report's
expert metrics remain null. Failed outputs are retained for review, not converted
to negatives. Subsequent v1.1.0 prompt refinement and any selected failure-case retries
are development checks and cannot substitute for independent final evaluation.

Classification metrics require exact prediction/reference ID equality and source-checked
binary truth. Abstention and API failure stay visible. No accuracy, no-FP/FN claim or
retrieval recall can be inferred from the API capture or dry-run counts alone.
