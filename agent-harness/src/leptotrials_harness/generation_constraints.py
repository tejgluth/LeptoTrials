"""Grammar constraints for local models so they can't produce known-bad combinations.

Evidence is still verified separately afterwards.
"""

import copy
import re

from .evidence import has_plain_lm_exclusion, lm_permission_exception, scope_is_source_named
from .models import INCLUSIVE, Classification, TrialInput
from .terminology import detect

_QUALIFIED = re.compile(
    r"\b(symptomatic|progressive|active|untreated|uncontrolled|corticosteroids?[- ]requiring)\b",
    re.I,
)
_NEGATIVE = re.compile(r"\b(exclusion|excluded|ineligible|not\s+eligible|no)\b", re.I)
_SCOPE = re.compile(
    r"\b(?:cohorts?|parts?|arms?|groups?|stratum|regimens?)\s+(?:[A-Z]|\d+[A-Z]?)\b",
    re.I,
)


def lm_clauses(anchor: dict, title: str) -> list[str]:
    return [c for c in re.split(r"[.;]", anchor["quote"].replace("~", " ")) if detect(c, title)]


def source_choices(payload: dict) -> dict:
    """Only allow references to passages that actually mention LM."""
    trial = TrialInput.model_validate(payload["trial"])
    title = trial.brief_title
    anchors = payload.get("source_passages", [])
    positive, negative, blanket, scoped = [], [], [], []
    source_names = {a.label for a in trial.arms_and_cohorts if a.label}
    for anchor in anchors:
        source_names.update(m.group() for m in _SCOPE.finditer(anchor["quote"]))
    source_names = {name for name in source_names if scope_is_source_named(name, trial)}
    for anchor in anchors:
        identifier = anchor["source_passage_id"]
        clauses = lm_clauses(anchor, title)
        if not clauses:
            continue
        if anchor.get("section_hint") != "exclusion" or lm_permission_exception(
            anchor["quote"], title
        ):
            positive.append(identifier)
            for name in sorted(source_names):
                linked = name.casefold() in anchor["quote"].casefold()
                parts = anchor["field"].split(".")
                if len(parts) >= 3 and parts[0] == "arms_and_cohorts":
                    try:
                        linked |= (
                            name.casefold()
                            in trial.arms_and_cohorts[int(parts[1])].label.casefold()
                        )
                    except (IndexError, ValueError):
                        pass
                if linked:
                    scoped.append((identifier, name))
        if anchor.get("section_hint") == "exclusion" or any(_NEGATIVE.search(c) for c in clauses):
            negative.append(identifier)
            if any(not _QUALIFIED.search(c) for c in clauses):
                blanket.append(identifier)
    return {
        "inclusion": positive,
        "exclusion": negative,
        "blanket_exclusion": blanket,
        "cohort_inclusion": scoped,
        "requires_conflict_evidence": has_plain_lm_exclusion(trial),
    }


def _reference(ids: list[str], direction: str, base: dict) -> dict:
    item = copy.deepcopy(base)
    item["properties"]["source_passage_id"] = {"type": "string", "enum": ids}
    item["properties"]["direction"] = {"type": "string", "enum": [direction]}
    return item


def constrain_local_decisions(schema: dict, payload: dict) -> dict:
    """Each branch is a full object, otherwise the grammar conversion drops fields."""
    choices = source_choices(payload)
    base = schema["$defs"]["EvidenceReference"]
    # specialised branches use a plain item schema instead of free-text references
    if "anyOf" in base:
        base = base["anyOf"][0]
    positive = _reference(choices["inclusion"], "inclusion", base)
    negative = _reference(choices["exclusion"], "exclusion", base)
    blanket = _reference(choices["blanket_exclusion"], "exclusion", base)
    scoped = []
    for identifier, name in choices["cohort_inclusion"]:
        item = _reference([identifier], "inclusion", base)
        item["properties"]["cohort"] = {"type": "string", "enum": [name]}
        scoped.append(item)
    allowed = schema["$defs"]["Classification"]["enum"]
    branches, actual = [], []
    for category in allowed:
        if category in INCLUSIVE and not choices["inclusion"]:
            continue
        if category == Classification.LM_INCLUSIVE_COHORT_SPECIFIC and not scoped:
            continue
        if category == Classification.LM_EXCLUDED and not choices["blanket_exclusion"]:
            continue
        if category == Classification.LM_MENTION_ONLY and not any(
            detect(a["quote"], payload["trial"].get("brief_title", ""))
            for a in payload.get("source_passages", [])
        ):
            continue
        branch = {k: copy.deepcopy(v) for k, v in schema.items() if k not in ("$defs", "anyOf")}
        props = branch["properties"]
        props["classification"] = {"type": "string", "enum": [category]}
        props["is_lm_inclusive"] = {"type": "boolean", "enum": [category in INCLUSIVE]}
        if category in INCLUSIVE:
            props["evidence"] = {
                "type": "array",
                "minItems": 1,
                "items": {"anyOf": scoped}
                if category == Classification.LM_INCLUSIVE_COHORT_SPECIFIC
                else positive,
            }
            if choices["requires_conflict_evidence"] and choices["exclusion"]:
                props["conflicting_evidence"] = {"type": "array", "minItems": 1, "items": negative}
        elif category == Classification.LM_EXCLUDED:
            props["evidence"] = {"type": "array", "minItems": 1, "items": blanket}
        else:
            # a "not included" decision can't cite inclusion evidence
            context = copy.deepcopy(schema["$defs"]["EvidenceReference"])
            if "anyOf" in context:
                context["anyOf"] = [
                    b
                    for b in context["anyOf"]
                    if b["properties"]["direction"]["enum"] != ["inclusion"]
                ]
            props["evidence"]["items"] = context
            if category == Classification.LM_MENTION_ONLY:
                props["evidence"]["minItems"] = 1
        branches.append(branch)
        actual.append(category)
    schema["$defs"]["Classification"]["enum"] = actual
    schema["anyOf"] = branches
    return schema
