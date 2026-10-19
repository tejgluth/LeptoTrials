# Methods-to-implementation map

| Method / failure mode | Inspectable implementation |
| --- | --- |
| Complementary sensitive registry discovery | `config/default.yaml`, `candidate_search.py`, `clinicaltrials_api.py` |
| Complete pagination and failure handling | `RegistryClient.search`, `tests/test_registry.py` |
| Conservative strict bypass with exact rule evidence | `strict_classifier.py`, `tests/test_strict_classifier.py` |
| Preserve structured protocol text and cohorts | `trial_normalizer.py`, `schemas/trial_input.schema.json` |
| Alternate terms and cautious acronyms | `config/terminology.yaml`, `terminology.py` |
| Exact model input and constrained task | `structured_input.py`, `prompts/`, per-run `model_inputs/` |
| Seven-way taxonomy, consistency and confidence | `models.py`, `schemas/classification_output.schema.json` |
| Cohort-specific/negative/ambiguous reasoning instructions | Versioned prompts selected in `prompts/prompt_versions.json` |
| Provider-specific constrained APIs | `gemini_client.py`, `openai_client.py`, `anthropic_client.py`, `ollama_client.py`, `model_client.py` |
| Source quote and provenance validation | `evidence.py`, `agent_classifier.py` |
| Bounded retries, explicit MODEL_FAILURE | `agent_classifier.py`, pipeline failure artifacts |
| Cache and substantive change detection | `structured_input.content_hash`, `decision_pipeline.py` |
| Frozen temporal inputs and checksums | `historical.py`, `validation/manifests/`, `validation/records/` |
| Genuine historical relational snapshots | `aact.py`, `import-aact`, dated source plan and table SHA-256 checksums |
| Protocol-only archive transfer and routing checks | `scripts/inspect_aact_archive.py`, `scripts/prepare_aact_history.py` |
| Round-level and aggregate evaluation | `validation.py`, `metrics.py` |
| Model/provider comparisons on matched inputs | `compare-models`; Stage 1 bypass disabled for comparison |
| Separate expert truth and model decisions | `audit.py`, `schemas/adjudication.schema.json` |
| All recent classifications for expert audit | `create-audit-batch`, CSV and Markdown review packets |
| Compatible reviewed export | `export.py`; app's `ManualAuditOverride` shape |
| Runtime, tokens, failures, estimated cost | `run_performance`, immutable manifests and events |
| CLI / optional scheduling | `cli.py`, `scripts/maintenance.py`, `docs/scheduling.md` |
| New/changed-trial polling and cache reuse | `maintain`; `tests/test_maintenance_polling.py`; opt-in LaunchAgent/cron examples |
| Detached, bounded offline verification | `scripts/offline_verify.py`; frozen snapshot, LaunchAgent, deadline and saved outputs |
| Active/interrupted execution inspection | `execution.py`; source/decision integrity, failure diagnostics, no invented accuracy |
| Failed/pending input recovery | `prepare-retry`; original frozen manifest, lineage and explicit sample bounds |
| Secrets and data minimization | ignored `.env`, public registry-only inputs, redacted SDK diagnostics |
| Unit/integration regression cases | `tests/`; offline adapter transport tests; public frozen inputs |

Historical dates/counts are recorded from actual API calls or explicitly dated AACT
archives. The API subsets' unchanged-record sampling limitation is explicit; genuine
AACT imports are a separate track. Original expert adjudications, experimental
prompt/model history and an independent final evaluation are not invented. New
OpenAI or Ollama testing is not evidence of Gemini performance.
