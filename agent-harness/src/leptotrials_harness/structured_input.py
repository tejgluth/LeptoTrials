"""Builds the model payload and a content hash for caching."""

from .config import RESOURCES
from .evidence import lm_permission_exception
from .local_contract import LOCAL_WIRE_VERSION, available_categories, local_wire_schema
from .logging_utils import digest, read_json
from .models import DECISIVE_CLASSIFICATIONS, SCHEMA_VERSION, ClassificationOutput, TrialInput
from .source_passages import source_passages
from .trial_normalizer import eligibility_sections, extract_signals


def prompts() -> dict:
    registry = read_json(RESOURCES / "prompts/prompt_versions.json")
    version = registry["current"]
    item = registry["versions"][version]
    return {
        "version": version,
        "system": (RESOURCES / "prompts" / item["system"]).read_text(),
        "task": (RESOURCES / "prompts" / item["task"]).read_text(),
    }


def content_hash(trial: TrialInput) -> str:
    data = trial.model_dump(mode="json")
    for key in ("last_update_date", "candidate_retrieval_reasons", "deterministic_signals"):
        data.pop(key)
    if trial.input_schema_version == "1.0.0":
        # 1.0.0 inputs had no population field, keep their old hashes stable
        data["eligibility"].pop("population")
    return digest(data)


def model_payload(
    trial: TrialInput, model_id: str, *, prompt: dict | None = None, provider: str | None = None
) -> dict:
    projected = trial.model_copy(deep=True)
    inclusion, exclusion, found = eligibility_sections(trial.eligibility.raw_text)
    projected.eligibility.inclusion_text = inclusion
    projected.eligibility.exclusion_text = exclusion
    projected.eligibility.section_found = found
    projected.deterministic_signals = extract_signals(projected)
    data = projected.model_dump(mode="json")
    if trial.input_schema_version == "1.0.0":
        data["eligibility"].pop("population")
    payload = {
        "decision_policy": {
            "version": "binary-inclusion-1.0.0",
            "allowed_classifications": sorted(c.value for c in DECISIVE_CLASSIFICATIONS),
            "decision_required": True,
            "no_inclusion_evidence": "LM_NOT_INCLUDED with is_lm_inclusive=false; "
            "explain the source limitations without claiming explicit LM exclusion",
        },
        "provenance": {
            "model_version": model_id,
            "prompt_version": (prompt if prompt is not None else prompts())["version"],
            "input_schema_version": trial.input_schema_version,
            "output_schema_version": SCHEMA_VERSION,
        },
        "trial": data,
        "input_projection": {
            "version": "eligibility-headings-1.0.0",
            "source_input_hash": content_hash(trial),
            "raw_eligibility_unchanged": True,
            "derived_eligibility_views_rebuilt": True,
            "criteria_evidence_policy": "Cite eligibility.raw_text, not derived section views",
        },
        "source_passages": [
            {"source_passage_id": f"S{i:03}", **anchor}
            for i, anchor in enumerate(source_passages(trial))
        ],
    }
    if provider == "ollama":
        payload["output_transport"] = {
            "wire_schema_version": LOCAL_WIRE_VERSION,
            "available_classifications": available_categories(data),
            "evidence_format": "Select source_passage_id, cohort, direction and interpretation. "
            "Do not generate field or quote: the harness resolves BOTH "
            "from the selected ID after wire-schema validation.",
        }
        # keep this list in sync with the grammar (some choices are removed per trial)
        payload["output_transport"]["available_classifications"] = local_wire_schema(payload)[
            "$defs"
        ]["Classification"]["enum"]
    return payload


def wire_output_schema(payload: dict, *, constrain_quotes: bool = False) -> dict:
    """Restrict evidence paths and provenance values to what exists in this input."""
    schema = ClassificationOutput.model_json_schema()
    # providers get the plain schema without the archive version branch
    schema.pop("allOf", None)
    if payload.get("provenance", {}).get("output_schema_version") == SCHEMA_VERSION:
        schema["$defs"]["Classification"]["enum"] = sorted(
            c.value for c in DECISIVE_CLASSIFICATIONS
        )
        schema["properties"]["is_lm_inclusive"] = {"type": "boolean"}
        schema["properties"]["requires_human_review"] = {"type": "boolean", "enum": [False]}
    paths = []

    def visit(value, path):
        if isinstance(value, str) and value:
            paths.append(path)
        elif isinstance(value, list):
            if value and all(isinstance(v, str) for v in value):
                paths.append(path)
                return
            for i, item in enumerate(value):
                visit(item, f"{path}.{i}")
        elif isinstance(value, dict):
            for name, item in value.items():
                if name not in (
                    "deterministic_signals",
                    "candidate_retrieval_reasons",
                    "input_schema_version",
                ):
                    visit(item, f"{path}.{name}" if path else name)

    clinical_fields = {
        "brief_title",
        "official_title",
        "conditions",
        "keywords",
        "brief_summary",
        "detailed_description",
        "eligibility",
        "arms_and_cohorts",
        "interventions",
        "primary_outcomes",
        "secondary_outcomes",
    }
    fields = {k: v for k, v in payload.get("trial", {}).items() if k in clinical_fields}
    if "eligibility" in fields:
        fields["eligibility"] = {
            k: v
            for k, v in fields["eligibility"].items()
            if k not in ("inclusion_text", "exclusion_text", "section_found")
        }
    visit(fields, "")
    if paths and len(paths) <= 250:
        schema["$defs"]["Evidence"]["properties"]["field"]["enum"] = sorted(
            set(paths + ["trial." + path for path in paths])
        )
    anchors = payload.get("source_passages", [])
    if constrain_quotes and anchors:
        # small local models kept mangling AACT's "~" delimiters, so only allow
        # exact source strings here
        import copy

        base = schema["$defs"]["Evidence"]
        branches = []
        for direction in ("inclusion", "exclusion", "context"):
            choices = [
                a
                for a in anchors
                if direction != "inclusion"
                or a.get("section_hint") != "exclusion"
                or lm_permission_exception(a["quote"], payload["trial"].get("brief_title", ""))
            ]
            if not choices:
                continue
            branch = copy.deepcopy(base)
            props = branch["properties"]
            props["direction"]["enum"] = [direction]
            props["quote"]["enum"] = sorted({a["quote"] for a in choices})
            anchor_paths = {a["field"] for a in choices}
            props["field"]["enum"] = sorted(anchor_paths | {"trial." + p for p in anchor_paths})
            branch["properties"] = {
                k: props[k] for k in ("direction", "cohort", "field", "quote", "interpretation")
            }
            branches.append(branch)
        # a plain exclusion can't be emitted as an inclusion; scope is still checked later
        schema["$defs"]["Evidence"] = {"anyOf": branches}
    provenance = payload.get("provenance", {})
    for key in ("model_version", "prompt_version", "input_schema_version", "output_schema_version"):
        if provenance.get(key):
            schema["properties"][key]["enum"] = [provenance[key]]
    if payload.get("trial", {}).get("nct_id"):
        schema["properties"]["nct_id"]["enum"] = [payload["trial"]["nct_id"]]
    return schema
