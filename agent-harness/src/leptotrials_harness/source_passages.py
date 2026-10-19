"""Verbatim source anchors, never summaries or eligibility decisions.

These copying aids supplement the complete normalized record. They are not trusted
as evidence until the usual path/substring verifier checks the model's final JSON.
No fuzzy match is ever accepted as a quote or used to repair a model response.
"""

import re
from difflib import SequenceMatcher

from .models import TrialInput
from .terminology import detect


def source_strings(trial: TrialInput) -> list[tuple[str, str]]:
    result = []

    def visit(value, path):
        if isinstance(value, str) and value:
            result.append((path, value))
        elif isinstance(value, list):
            for index, item in enumerate(value):
                visit(item, f"{path}.{index}")
        elif isinstance(value, dict):
            for key, item in value.items():
                visit(item, f"{path}.{key}" if path else key)

    data = trial.model_dump(mode="json")
    # AACT sometimes cannot be split on headings: raw_text remains authoritative.
    fields = (
        "eligibility",
        "arms_and_cohorts",
        "brief_title",
        "official_title",
        "conditions",
        "keywords",
        "brief_summary",
        "detailed_description",
        "primary_outcomes",
        "secondary_outcomes",
    )
    for field in fields:
        if field == "eligibility":
            visit(
                {
                    k: v
                    for k, v in data[field].items()
                    if k not in ("inclusion_text", "exclusion_text", "section_found")
                },
                field,
            )
        else:
            visit(data[field], field)
    return result


def source_passages(trial: TrialInput, limit: int = 80) -> list[dict]:
    """Offer short exact LM-bearing anchors plus titles; retain the entire input too."""
    anchors, seen = [], set()
    for field, value in source_strings(trial):
        # Newlines and AACT's literal '~' delimiters stay unchanged in the source.
        if not (detect(value, trial.brief_title) or field.endswith("title")):
            continue
        if len(value) <= 300:
            quotes = [value]
        else:
            hits = list(
                re.finditer(
                    r"lepto[- ]?mening\w*|meningeal|meningitis|\b(?:LM|LMD|LMC)\b", value, re.I
                )
            )
            # Include preceding source context across literal AACT delimiters, so
            # qualifiers and cohort labels on wrapped lines are not discarded.
            quotes = [value[max(0, hit.start() - 140) : hit.start() + 160] for hit in hits[:12]]
            if not quotes and field.endswith("title"):
                quotes = [value[:300]]
        for quote in quotes:
            if quote not in seen:
                anchor = {"field": field, "quote": quote}
                if field.startswith("eligibility."):
                    offset = value.find(quote)
                    hit = re.search(
                        r"lepto[- ]?mening\w*|meningeal|meningitis|\b(?:LM|LMD|LMC)\b", quote, re.I
                    )
                    section_offset = offset + hit.start() if hit else offset
                    headings = list(
                        re.finditer(
                            r"\b(inclusion|exclusion)\s+criteria\b", value[:section_offset], re.I
                        )
                    )
                    anchor["section_hint"] = (
                        headings[-1].group(1).lower() if headings else "unsectioned"
                    )
                anchors.append(anchor)
                seen.add(quote)
                if len(anchors) == limit:
                    return anchors
    return anchors


def rejection_hints(raw_output: str | None, trial: TrialInput) -> list[dict]:
    """Suggest actual source passages to a *new* bounded attempt, not a repair."""
    import json

    try:
        rejected = json.loads(raw_output or "")
        evidence = rejected.get("evidence", []) + rejected.get("conflicting_evidence", [])
    except (ValueError, TypeError, AttributeError):
        return []
    strings = source_strings(trial)
    hints = []
    for item in evidence[:8]:
        if not isinstance(item, dict) or not isinstance(item.get("quote"), str):
            continue
        quote = item["quote"]
        best = None
        for field, value in strings:
            match = SequenceMatcher(None, quote, value, autojunk=False).find_longest_match()
            if best is None or match.size > best[0]:
                start = max(0, match.b - min(match.a, 80))
                best = (match.size, field, value[start : start + 300])
        if best and best[0] >= 12:
            hints.append({"field": best[1], "quote": best[2]})
    return hints
