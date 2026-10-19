"""Conservative, versioned inclusion rules informed by trialFilter.ts, not a port of it."""

import re

from .models import SCHEMA_VERSION, Classification, ClassificationOutput, Evidence, TrialInput
from .terminology import detect
from .trial_normalizer import extract_signals

RULE_VERSION = "strict-1.1.0"


def classify_strict(trial: TrialInput) -> tuple[str, ClassificationOutput] | None:
    signals = extract_signals(trial)
    if signals.negative_lm_phrases or signals.lm_terms_in_exclusion:
        return None
    population_text = " ".join(
        [trial.brief_title, trial.official_title, trial.eligibility.raw_text, trial.brief_summary]
    )
    if re.search(r"\bcohorts?\b|\bparts?\s+[A-F1-9]\b", population_text, re.I):
        return None
    # An LM condition alongside other diseases is not proof of an exclusively LM
    # population (e.g. brain OR LM, or an LM cohort within a general CNS study).
    if re.search(
        r"\b(?:brain|CNS)\b.{0,60}\bor\b.{0,60}leptomeningeal|"
        r"leptomeningeal.{0,60}\bor\b.{0,60}\b(?:brain|CNS)\b",
        population_text,
        re.I,
    ):
        return None
    # Exact named malignant conditions, not arbitrary mentions or ambiguous abbreviations.
    exact_conditions = {
        "leptomeningeal metastasis",
        "leptomeningeal metastases",
        "leptomeningeal disease",
        "leptomeningeal carcinomatosis",
        "meningeal carcinomatosis",
        "neoplastic meningitis",
        "lymphomatous meningitis",
        "leukemic meningitis",
        "leptomeningeal cancer",
    }
    condition = next(
        (i for i, c in enumerate(trial.conditions) if c.strip().lower() in exact_conditions), None
    )
    title_match = re.search(
        r"(?:patients?|participants?|subjects?)\s+with\s+(?:confirmed\s+)?"
        r"(?:leptomeningeal (?:metastas(?:is|es)|disease|carcinomatosis|cancer)"
        r"|neoplastic meningitis)",
        trial.brief_title,
        re.I,
    )
    # No generic title-keyword or washout/cohort bypass. Those require Stage 2.
    if condition is not None and (len(trial.conditions) == 1 or title_match):
        rule, field, quote = (
            "LM_CONDITION_EXACT_UNCONFLICTED",
            f"conditions.{condition}",
            trial.conditions[condition],
        )
    elif title_match:
        rule, field, quote = "LM_TITLE_POPULATION_UNCONFLICTED", "brief_title", title_match.group()
    else:
        return None
    return rule, ClassificationOutput(
        nct_id=trial.nct_id,
        classification=Classification.LM_SPECIFIC,
        is_lm_inclusive=True,
        confidence=1.0,
        requires_human_review=False,
        primary_reason=f"{rule}: explicit LM population; no detected LM exclusion/conflict signal.",
        evidence=[
            Evidence(
                field=field, cohort=None, quote=quote, interpretation=rule, direction="inclusion"
            )
        ],
        conflicting_evidence=[],
        lm_terms_detected=detect(quote),
        classification_notes="Deterministic rule, not model confidence.",
        model_version="none",
        prompt_version=RULE_VERSION,
        input_schema_version=trial.input_schema_version,
        output_schema_version=SCHEMA_VERSION,
    )
