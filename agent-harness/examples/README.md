# Inspectable examples

`cases.json` contains **synthetic instructional examples**, not Gemini responses or
expert ground truth. NCT-shaped identifiers in this file are placeholders only.
Each example retains raw relevant fields, normalized input, schema-valid
illustrative output and final proposed classification.

Run `python examples/classify_single_trial.py` for an actual registry retrieval of
NCT06440954. Its title/inclusion conflict with a meningeal exclusion, so it enters
Stage 2. This example does not change its production classification.

`local-smoke-inputs.json` is a small synthetic infrastructure check that can be run
with any provider using the same `run-batch` command. Its NCT-shaped IDs are placeholders.
Expected routing: first case strict; exclusion, cohort and conflict cases use Stage 2.
The contradictory case must require expert review, irrespective of the raw model label.
