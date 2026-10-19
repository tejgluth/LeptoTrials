"""Explicit local evidence-reference transport; never fuzzy quote repair.

The model selects a source passage ID. After typed validation, a deterministic
lookup resolves BOTH field and quote from the submitted immutable input. Raw wire
JSON remains in attempts; the canonical output is validated again independently.
"""

import copy
import re
from typing import Literal

from pydantic import Field

from .evidence import EvidenceError, lm_permission_exception
from .models import Classification, ClassificationOutput, StrictModel

LOCAL_WIRE_VERSION = "ollama-source-references-1.0.0"


class EvidenceReference(StrictModel):
    source_passage_id: str = Field(pattern=r"^S\d{3}$")
    cohort: str | None
    interpretation: str = Field(min_length=1, max_length=1000)
    direction: Literal["inclusion", "exclusion", "context"]


class ReferenceOutput(ClassificationOutput):
    wire_schema_version: Literal["ollama-source-references-1.0.0"]
    evidence: list[EvidenceReference]
    conflicting_evidence: list[EvidenceReference]


def available_categories(trial: dict) -> list[str]:
    import json

    clinical = {
        k: v
        for k, v in trial.items()
        if k not in ("deterministic_signals", "candidate_retrieval_reasons")
    }
    text = json.dumps(clinical, ensure_ascii=False)
    cohort_signal = len(trial.get("arms_and_cohorts", [])) > 1 or re.search(
        r"\bcohorts?\b|\b(?:part|group|arm)\s+[A-Z0-9]\b", text, re.I
    )
    # Without any identifiable cohort signal, don't let a small local model name
    # a conditional eligibility sentence as a new enrollment cohort. Inclusion,
    # rejection and abstention remain available; no binary answer is forced.
    return [
        c.value
        for c in Classification
        if c != Classification.LM_INCLUSIVE_COHORT_SPECIFIC or cohort_signal
    ]


def local_wire_schema(payload: dict) -> dict:
    schema = ReferenceOutput.model_json_schema()
    schema["$defs"]["Classification"]["enum"] = available_categories(payload.get("trial", {}))
    anchors = payload.get("source_passages", [])
    if anchors:
        base = schema["$defs"]["EvidenceReference"]
        branches = []
        for direction in ("inclusion", "exclusion", "context"):
            choices = [
                a["source_passage_id"]
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
            props["source_passage_id"]["enum"] = choices
            branch["properties"] = {
                k: props[k] for k in ("direction", "source_passage_id", "cohort", "interpretation")
            }
            branches.append(branch)
        schema["$defs"]["EvidenceReference"] = {"anyOf": branches}
    else:
        for key in ("evidence", "conflicting_evidence"):
            schema["properties"][key]["maxItems"] = 0
    for key, value in payload.get("provenance", {}).items():
        if key in schema["properties"]:
            schema["properties"][key]["enum"] = [value]
    if payload.get("trial", {}).get("nct_id"):
        schema["properties"]["nct_id"]["enum"] = [payload["trial"]["nct_id"]]
    return schema


def resolve_local_output(text: str, payload: dict) -> ClassificationOutput:
    wire = ReferenceOutput.model_validate_json(text)
    if wire.classification.value not in available_categories(payload["trial"]):
        raise EvidenceError(
            "Cohort-specific label has no source cohort signal; use general "
            "conditional permission or abstain, not an invented cohort"
        )
    anchors = {a["source_passage_id"]: a for a in payload["source_passages"]}
    if len(anchors) != len(payload["source_passages"]):
        raise EvidenceError("Duplicate source passage IDs in submitted input")
    result = wire.model_dump(mode="json", exclude={"wire_schema_version"})
    for key in ("evidence", "conflicting_evidence"):
        resolved = []
        for ref in result[key]:
            anchor = anchors.get(ref["source_passage_id"])
            if not anchor:
                raise EvidenceError("Unknown source passage ID; no evidence was guessed")
            resolved.append(
                {
                    "field": anchor["field"],
                    "quote": anchor["quote"],
                    **{k: v for k, v in ref.items() if k != "source_passage_id"},
                }
            )
        result[key] = resolved
    import json

    return ClassificationOutput.model_validate_json(json.dumps(result))
