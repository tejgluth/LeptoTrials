# Genuine historical AACT inputs

AACT publishes dated relational snapshots of ClinicalTrials.gov. Unlike filtering
today's API records by dates, these retain records as they appeared in the archive.
Sign in to [AACT](https://aact.ctti-clinicaltrials.org/snapshots) locally to obtain a
download. Never copy passwords, database credentials or browser cookies into this repo.

The checked-in [annual source plan](../validation/sources/aact-annual-2026-10-18.json)
records actual October archive choices for 2017–2026, resolved on October 18, 2026.
Dates are not invented annual cutoffs: 2017 is October 17, 2021 is October 4, and the
other selected archives are October 1. This is a **new snapshot execution study**,
not a reconstruction of undocumented original paper experiments or a held-out split.

**2020 provenance exception:** the archive listed as October 1 has posted dates
after that date and ZIP member timestamps of October 4. Its corrected date-bound
import therefore failed. It is not counted as a passed as-of snapshot; do not
silently loosen bounds or infer an effective snapshot date from ZIP timestamps.
The nominal listing and conflicting source metadata need reconciliation first.

The new reconciliation recipe `validation/sources/aact-reconciled-v1.json` explicitly
replaces that rejected October source with the independently checked **2020-09-01**
archive. This is a new evaluation revision, not a relabeled October capture. Original
archives/imports remain intact. Its full-universe preflight scanned 350,374 studies;
the latest checked source date was 2020-08-31. The provenance-preserving import then
selected 23,368 broad candidates with no missing source-date checks.

## Import an archive

From `agent-harness/`, using the installed virtual environment:

```bash
leptotrials-harness import-aact /path/to/archive.zip --date 2018-10-01 \
  --round round_02 --destination output/aact-historical \
  --provenance 'Dated AACT archive page/download URL and capture method'

leptotrials-harness --output-root output/aact-verification validate \
  output/aact-historical/manifests/round_02.json --dry-run
```

An extracted directory containing the required `.txt` files also works. The importer
requires studies, eligibility, conditions, keywords, summaries, descriptions, groups,
outcomes, interventions, group/intervention links, facilities and sponsors. It scans
all studies/statuses and uses versioned, sensitive text matching to select broad
candidates; candidate counts are **not LM-inclusive trial counts**. It preserves
population text, complete eligibility and cohort/intervention relationships.

Outputs include a frozen manifest, compressed normalized inputs, original joined
source rows, table SHA-256 checksums, full-table row counts and explicit limitations.
AACT may already flatten whitespace; the importer cannot reconstruct lost formatting.
Importer `aact-import-1.1.0` checks both legacy dates (`first_received_date`,
`last_changed_date`) and the newer submitted/posted date columns. The normalized
last update uses `last_update_posted_date` when available, otherwise legacy
`last_changed_date`, whose different meaning remains documented. No current
registry text is substituted during import. Initial local round-02/03/04 imports
that predated this mapping are superseded by corrected versioned imports under
`output/aact-historical-v2/`; do not rely on their missing-date checks.

## Optional protocol-only downloads

The helper accepts a local ZIP or an unsigned public HTTPS archive URL already
obtained from an authenticated AACT download. It does not authenticate, follow
redirects, copy cookies or bypass access restrictions. A server must support exact
HTTP byte ranges. Only twelve protocol tables are saved, excluding results and
contact tables. Selected ZIP-member CRCs and table SHA-256 hashes are checked;
this does **not** claim a full-archive checksum.

```bash
python scripts/inspect_aact_archive.py PUBLIC_ARCHIVE_URL \
  --download-protocol-tables output/aact-source/2018-10-01

# Reuse a completed browser download, verifying against its known public origin
python scripts/inspect_aact_archive.py /path/to/download.zip \
  --verify-public-origin PUBLIC_ARCHIVE_URL \
  --download-protocol-tables output/aact-source/2026-10-01

# Download, verify, import, then dry-run selected rounds. No model calls.
python scripts/prepare_aact_history.py \
  --plan validation/sources/aact-annual-2026-10-18.json \
  --rounds round_02 round_03 \
  --verification-root output/new-aact-preparation
```

The preparation script checks transfer receipts and checksums, stops on a failed
stage, has finite per-stage timeouts, and writes progress/logs. Use a new verification
directory; existing imported rounds are not overwritten or silently trusted. A failed
partial transfer needs a fresh source directory. Downloads require internet; imported
dry runs and local Ollama classification can run offline.

For a reused local ZIP, the helper compares object size and the complete ZIP central
directory against the public source using small HTTP range reads. It records the
local archive SHA-256, then verifies selected member CRCs and table SHA-256 checksums
while extracting. This does not claim a cryptographic SHA match against the remote
object. The origin-bound receipt lets a queued preparation job reuse the verified
tables without downloading them again.

## What can be claimed

The first imported source (2017-10-17) scanned 256,653 studies and selected 17,926
broad candidates. Its complete dry run routed 11 through strict rules and 17,915
to pending Stage 2, with zero model calls and no recorded pipeline errors. That
demonstrates ingestion/routing, not 17,926 clinical classifications or accuracy.

Full local model inference over these broad populations is substantially larger
than the earlier unchanged-record subsets. Record actual throughput before budgeting
a full run. Model outputs still need independent, source-checked expert reference
labels to calculate clinical FP/FN metrics. An LLM, API call or developer inspection
does not manufacture neuro-oncology expert ground truth. Preserve original model
outputs and store any expert correction separately.

## Reconciled collection and bounded development execution

The source recipe selects exactly one accepted import per year, using corrected
2018/2019 imports and the September 2020 replacement. To reconstruct the collection
from the locally retained source imports without changing them:

```bash
python scripts/build_aact_evaluation.py \
  --recipe validation/sources/aact-reconciled-v1.json \
  --destination output/aact-reconciled-20261018-v1 \
  --per-round 5 --seed aact-dev-smoke-2026-10-18-v1
```

Use a fresh destination when rerunning. `collection.json` is written only after all
ten rounds pass input/checksum/schema/identity checks. `full/` contains the complete
normalized inputs, source rows and manifests. `development/` contains five complete
source records per round, with original input fingerprints and an explicit sampling
plan. No original inputs, model outputs or expert labels are overwritten.

Sampling uses observable source strata (cohort language, negative/qualified mentions,
title/condition LM, eligibility LM, and other broad candidates), not model predictions
or expert labels. One record per nonempty stratum is selected by a recorded seeded
SHA-256 rank; any remaining slots use the same hash ordering without replacement.
These are **50 development smoke records**, not proportional random sampling,
independent held-out evaluation or classification of the full candidate population.

To run just those ten small rounds independently of the chat, using frozen code,
exact copied sample inputs, an installed local model, and a finite deadline:

```bash
python scripts/offline_verify.py schedule --hours 3 \
  --manifests output/aact-reconciled-20261018-v1/development/manifests \
  --classification-only
```

This opt-in one-shot job makes no registry retrievals or paid model calls. Its
`selected-inputs/` and `snapshot-hashes.json` record the exact data/code; no `.env`,
API keys or expert adjudications are copied. The job's `status.json` gives progress
and `summary.json` its terminal state. `harness-output/runs/` retains per-record
outputs and failures; a schema/model failure is not silently converted to a negative.
A completed execution with failures is not a clinically validated classifier.
The old overnight unchanged-record sweep is not substituted for these selected inputs.
