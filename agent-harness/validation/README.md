# Validation data

The [latest local verification](reports/2026-10-19-local-validation.md) covers 694
record-round outputs with no failed or unclear decisions. It records the exact
scope, mixed prompt versions, remaining conflict flags and reproducibility command.
Passing these checks does not establish independent clinical accuracy.

## Dated AACT sources

The [accepted collection](reports/2026-10-18-aact-reconciliation.md) contains ten dated
archives spanning 2017–2026 and 275,563 broad candidate record-round pairs. The
[provenance report](reports/2026-10-18-aact-reconciled-source-plan.json) records source
URLs, table checksums, input fingerprints and development selections. The nominal
October 2020 archive was rejected; September 2020 is the explicit replacement.

The canonical local inputs and manifests are in
`output/aact-reconciled-20261018-v1/`. The 50-record historical development sample
is separate from full-population inference and expert validation. See
[archive acquisition](../docs/historical-aact.md) for preparation and integrity checks.

## API-derived retrospective subsets

The checked-in `manifests/`, `rounds/` and compressed `records/registry-inputs.json.gz`
contain older unchanged-record subsets captured on October 18, 2026. They select
records first posted and last updated before annual cutoffs from 2017 through 2026.
There are 8,844 record-round pairs and 1,928 unique inputs. These survivor subsets
are not complete historical registry populations; do not combine their counts with
the dated AACT collection.

Each manifest selects exact content hashes and verifies the compressed input archive.
The original cutoffs and selection metadata remain in the manifests. Reproduce the
routing checks without model requests with `leptotrials-harness validate-all --dry-run`.

## Reference labels and results

Expert adjudications remain separate from model decisions and bind to the exact input
revision. Add them through a new versioned manifest; do not invent reviewer identities
or treat source/API captures as ground truth. Clinical classification metrics require
independently checked reference labels with exact prediction/reference membership.

Generated inputs, model outputs and run artifacts belong under `output/`, outside
version control. Retain the final source evidence and configurations needed to
reproduce a result; remove obsolete local runs after consolidating and verifying
their successful replacements. Public verification summaries belong in `reports/`.
