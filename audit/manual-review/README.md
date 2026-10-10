# LM classification audit inputs

`classification-decisions.json` is the dated authoritative manifest for runtime overrides. Its entries link to a dated evidence ledger containing registry identity/status/dates, retrieval time, source fields, before/after classifications and rationale. Edit this manifest only from reviewed official evidence, then run:

```
npm run generate:manual-audit-overrides
npm run export:audit-universe
npm run export:expanded-candidates
npm run reconcile:manual-audit -- --fresh
npm run validate:trials -- --json --fresh
npm run check
```

The generator validates IDs, unique entries, completed boolean relevance and allowed tumor labels. Reconciliation includes the same supplemental retrieval and statuses as the app. Exporting does not overwrite existing historical `review-batch-*` decisions. Those older batches are context, not the current manifest.

Use `--fresh` for release checks: validator/reconciliation otherwise permit a fresh six-hour local cache, but never silently substitute stale records after upstream failure. Missing/malformed records, incomplete pagination and missing requested supplemental IDs are errors, not empty results. Archive source responses with timestamps and hashes; preserve last verified classifications when evidence cannot be retrieved.

Only verified malignant LM eligibility supports relevance. Specific tumor labels require a link to that eligible LM path. All-comers solid LM belongs in OTHER_SOLID; hematologic/CNS-primary LM may belong only in general results. Status, age and geography remain independent filters. A returned study never proves individual eligibility.
