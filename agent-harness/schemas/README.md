These JSON schemas are generated from the Pydantic contracts with
`leptotrials-harness schemas`. CI checks that they match the executable contracts.
Semantic consistency and source-quote validation run in addition to JSON schema.

`classification_output.schema.json` is the canonical full-evidence result shared
by all providers. Native local Ollama uses the separately typed
`ollama_reference_output.schema.json` wire contract: it selects submitted passage
IDs, and the harness resolves their exact field/quote pairs before independently
validating the canonical output. Raw reference JSON is retained. Runtime schema
choices are further constrained by the submitted IDs, provenance and cohort signals.
This explicit lookup does not repair malformed model text or establish clinical truth.
