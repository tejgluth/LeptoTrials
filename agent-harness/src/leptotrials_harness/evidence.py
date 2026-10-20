"""Checks model output against the source: quotes, IDs, versions and provenance."""

import re

from .models import SCHEMA_VERSION, SUPPORTED_OUTPUT_VERSIONS, ClassificationOutput, TrialInput
from .terminology import detect


class EvidenceError(ValueError):
    pass


def lm_permission_exception(quote: str, context: str = "") -> bool:
    """Rough check for an LM exception in a passage (used to gate copying, not to classify)."""
    return any(
        detect(clause, context)
        and re.search(
            r"\b(unless|except|eligible|permitted|allowed|may\s+(?:enroll|participate))\b"
            r"|\bwithout\b.{0,60}(?:meningeal|\bLM\b)",
            clause,
            re.I,
        )
        for clause in re.split(r"[.;]", quote.replace("~", " "))
    )


def has_plain_lm_exclusion(trial: TrialInput) -> bool:
    """Flags a source-level conflict; this isn't a classification."""
    sections = re.split(
        r"(\b(?:inclusion|exclusion)\s+criteria\b)",
        trial.eligibility.raw_text.replace("~", "\n"),
        flags=re.I,
    )
    section = "unsectioned"
    for fragment in sections:
        if re.fullmatch(r"(?:inclusion|exclusion)\s+criteria", fragment, re.I):
            section = fragment.split()[0].casefold()
            continue
        for clause in re.split(r"[.;]|\n\s*(?:[-*]|\d+[.)])\s+", fragment):
            words = re.sub(r"\s+", " ", clause)
            if not detect(words, trial.brief_title):
                continue
            negative = section == "exclusion" or re.search(
                r"\b(excluded|ineligible|not\s+eligible)\b", words, re.I
            )
            if negative and not lm_permission_exception(words, trial.brief_title):
                return True
    return False


def scope_is_source_named(cohort: str | None, trial: TrialInput) -> bool:
    """Scope labels have to name a group from the source, not a made-up sentence."""
    if not cohort:
        return False
    normalize = lambda s: re.sub(r"\s+", " ", s).strip().casefold()  # noqa: E731
    name = normalize(cohort)
    clinical = trial.model_dump(mode="json")
    for key in ("deterministic_signals", "candidate_retrieval_reasons"):
        clinical.pop(key)
    is_label = any(name in normalize(a.label) for a in trial.arms_and_cohorts if a.label)
    identifier = re.search(
        r"\b(?:cohorts?|parts?|arms?|groups?|regimens?|stratum)\s+(?:[A-Z]|\d+[A-Z]?)\b", name, re.I
    )
    return name in normalize(str(clinical)) and bool(is_label or identifier)


def verify_evidence(
    result: ClassificationOutput, trial: TrialInput, *, semantic_support: bool = True
) -> None:
    if result.nct_id != trial.nct_id:
        raise EvidenceError("Model returned a different NCT ID")
    if (
        result.input_schema_version != trial.input_schema_version
        or result.output_schema_version not in SUPPORTED_OUTPUT_VERSIONS
    ):
        raise EvidenceError("Schema version mismatch")
    fallback = (
        "choose LM_NOT_INCLUDED with is_lm_inclusive=false and explain why LM enrollment "
        "is not established; this is a do-not-include decision, not proof of blanket exclusion"
        if result.output_schema_version == SCHEMA_VERSION
        else "use INSUFFICIENT_INFORMATION or AMBIGUOUS_REQUIRES_REVIEW if scope is unresolved"
    )
    source = trial.model_dump(mode="json")
    normalized = lambda s: re.sub(r"\s+", " ", s).strip()  # noqa: E731
    for evidence in result.evidence + result.conflicting_evidence:
        value = source
        try:
            field = evidence.field.removeprefix("trial.")
            if field.startswith(("deterministic_signals", "candidate_retrieval_reasons")):
                raise KeyError("Signals are not source evidence")
            for part in field.split("."):
                value = value[int(part)] if isinstance(value, list) else value[part]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise EvidenceError(f"Invalid evidence field {evidence.field}") from exc
        # a quote has to come from a single field value
        values = [value] if isinstance(value, str) else value if isinstance(value, list) else []
        if not any(
            isinstance(v, str) and normalized(evidence.quote) in normalized(v) for v in values
        ):
            raise EvidenceError(f"Quote absent from source field {evidence.field}")
        if (
            semantic_support
            and evidence.direction == "inclusion"
            and field.startswith("eligibility.")
        ):
            # reject exclusions passed off as inclusion evidence, but let real
            # exceptions ("unless...", "are eligible...") through
            text = normalized(trial.eligibility.raw_text)
            offset = text.find(normalized(evidence.quote))
            lm = re.search(
                r"lepto[- ]?mening\w*|meningeal|meningitis|\b(?:LM|LMD|LMC)\b",
                normalized(evidence.quote),
                re.I,
            )
            section_offset = offset + lm.start() if offset >= 0 and lm else offset
            headings = list(
                re.finditer(r"\b(inclusion|exclusion)\s+criteria\b", text[:section_offset], re.I)
            )
            in_exclusion = field == "eligibility.exclusion_text" or (
                offset >= 0 and headings and headings[-1].group(1).lower() == "exclusion"
            )
            # an exception for brain/dural mets nearby doesn't count, it has to be the LM clause
            explicit_exception = lm_permission_exception(evidence.quote, trial.brief_title)
            if in_exclusion and not explicit_exception:
                raise EvidenceError(
                    "Inclusion evidence is from an exclusion section without an explicit "
                    "permission/exception. Cite actual affirmative LM enrollment evidence."
                )
    if (
        semantic_support
        and result.is_lm_inclusive is True
        and not any(
            e.direction == "inclusion" and detect(e.quote, trial.brief_title)
            for e in result.evidence
        )
    ):
        raise EvidenceError(
            "Affirmative evidence does not establish LM permission. Cite actual LM enrollment "
            f"evidence; otherwise {fallback}. "
            "General oncology/brain-only text is not LM permission."
        )
    if (
        semantic_support
        and result.classification == "LM_EXCLUDED"
        and not any(
            detect(e.quote, trial.brief_title) and e.direction == "exclusion"
            for e in result.evidence
        )
    ):
        raise EvidenceError(
            "LM_EXCLUDED requires LM-specific exclusion evidence. Generic brain/CNS "
            "metastasis wording alone does not establish explicit LM exclusion; "
            f"{fallback}."
        )
    if semantic_support and result.classification == "LM_EXCLUDED":
        lm_clauses = [
            clause
            for e in result.evidence
            if e.direction == "exclusion"
            for clause in re.split(r"[.;]", e.quote.replace("~", " "))
            if detect(clause, trial.brief_title)
        ]

        def qualified(s):
            return bool(
                re.search(
                    r"\b(symptomatic|progressive|active|untreated|uncontrolled|"
                    r"corticosteroids?[- ]requiring)\b",
                    s,
                    re.I,
                )
            )

        if lm_clauses and all(qualified(s) for s in lm_clauses):
            raise EvidenceError(
                "Qualified symptomatic/active/progressive LM exclusion does not establish "
                "exclusion of ALL LM. Unless another source passage resolves stable/asymptomatic "
                f"LM, {fallback}."
            )
    if (
        semantic_support
        and result.is_lm_inclusive is True
        and has_plain_lm_exclusion(trial)
        and not any(e.direction == "exclusion" for e in result.conflicting_evidence)
    ):
        raise EvidenceError(
            "Source contains a plain LM exclusion not addressed in conflicting_evidence. "
            "Cite that actual exclusion with its cohort scope and distinguish it from "
            "affirmative enrollment. Never describe an exclusion as mandatory inclusion."
        )
    if semantic_support and result.classification == "LM_INCLUSIVE_COHORT_SPECIFIC":

        def linked(e):
            if e.direction != "inclusion" or not e.cohort:
                return False
            name = normalized(e.cohort).casefold()
            if name in normalized(e.quote).casefold():
                return True
            path = e.field.removeprefix("trial.").split(".")
            if len(path) >= 3 and path[0] == "arms_and_cohorts":
                try:
                    return name in normalized(trial.arms_and_cohorts[int(path[1])].label).casefold()
                except (IndexError, ValueError):
                    return False
            return False

        if not any(linked(e) for e in result.evidence):
            raise EvidenceError(
                "Cohort-specific inclusion evidence is not linked to its stated cohort. "
                "Quote the affirmative cohort passage including its real cohort name, "
                "or cite that cohort's own arm field. Never cite another cohort's exclusion."
            )
        if not any(
            e.direction == "inclusion" and scope_is_source_named(e.cohort, trial)
            for e in result.evidence
        ):
            raise EvidenceError(
                "Conditional permission alone is not a source-defined cohort. Use "
                "LM_INCLUSIVE_GENERAL for study-wide conditional LM permission; otherwise "
                f"cite an actual source-named cohort/part/arm; otherwise {fallback}. "
                "Do not invent a cohort."
            )
