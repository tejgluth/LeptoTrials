# Examples

Run `python examples/classify_single_trial.py` to retrieve and classify the public
registry record NCT06440954. This uses the configured provider and writes a new run;
it does not change the website’s classification or provide expert approval.

`local-smoke-inputs.json` contains small synthetic inputs for an infrastructure check:

```bash
leptotrials-harness --config config/ollama.yaml run-batch examples/local-smoke-inputs.json
```

Its NCT-shaped identifiers are placeholders. Explicit inclusion can use the strict
stage; exclusion, cohort and conflict cases exercise model classification. Successful
outputs require a yes/no decision and source-checked evidence. Conflicting criteria
remain visible and can trigger a review flag.

`adjudication-template.json` shows the separate expert correction format. Replace its
placeholder identities and hashes with real source-checked expert information before
using it; model outputs and synthetic inputs are not expert reference labels.
