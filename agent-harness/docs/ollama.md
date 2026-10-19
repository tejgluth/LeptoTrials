# Local models through the same harness

Ollama is another model provider. Candidate retrieval, Stage 1, normalized input,
classification taxonomy, evidence verification, expert review, metrics and exports
are the same as for Gemini/OpenAI. Only the adapter and provider configuration change.

```bash
cd agent-harness
# Once per machine/model, if it is not already installed:
ollama pull gemma4

# Same pipeline; model requests stay on this machine and need no API key
.venv/bin/leptotrials-harness --config config/ollama.yaml classify NCT06440954
.venv/bin/leptotrials-harness --config config/ollama.yaml run-batch candidates.json --workers 1
.venv/bin/leptotrials-harness --config config/ollama.yaml validate-all --workers 1
.venv/bin/leptotrials-harness --config config/ollama.yaml maintain --workers 1
```

Keep Ollama running. The tested setup already has `gemma4:latest` installed; no new
download was needed. Change `model_id` in the YAML to choose another installed model.
The native local adapter does not read cloud API keys, download models, contact a
paid provider, accept cloud-backed model tags, or fall back to hosted inference.
ClinicalTrials.gov retrieval still uses its free public API; frozen-input runs can
be evaluated without registry network calls.

The adapter uses `/api/chat` with the common JSON schema and explicit context/output
limits. Truncation and context shifting are disabled, preserving full eligibility.
Oversized inputs or incomplete generation fail visibly. The digest of the installed
model is resolved before cache lookup and recorded with the Ollama server version,
token counts and timing. Set `model_revision` to pin a particular digest. Hidden
thinking is not stored. API cost is zero; inference uses your computer's resources.

Start with one worker. A full pass over 1,928 unique records may take hours depending
on hardware, context and thinking settings. Cache entries are provider/model-specific:
Gemma results do not replace or pretend to reproduce Gemini/OpenAI results. Local
model quality must be assessed against independent expert reference labels.

`config/ollama-fast.yaml` is an explicit development alternative with thinking
disabled. It does not relax the JSON contract, source verification or expert gate.
Compare both configurations on the same small frozen manifest with `compare-models
--configs config/ollama-fast.yaml config/ollama.yaml`. Do not infer clinical quality
from speed or from correcting previously inspected development examples.

For a scheduled ChatGPT task, use the existing scheduling prompt with
`--config config/ollama.yaml maintain --workers 1`. No other architecture is required.

Official interfaces: [structured outputs](https://docs.ollama.com/capabilities/structured-outputs),
[native chat endpoint](https://docs.ollama.com/api/chat).
