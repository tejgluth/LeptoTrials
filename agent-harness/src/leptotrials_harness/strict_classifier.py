"""Stage 1: a couple of strict rules that can include a trial without a model call."""

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
    # LM listed next to other conditions doesn't mean the whole study is LM
    # (e.g. "brain or LM", or one LM cohort in a general CNS trial)
    if re.search(
        r"\b(?:brain|CNS)\b.{0,60}\bor\b.{0,60}leptomeningeal|"
        r"leptomeningeal.{0,60}\bor\b.{0,60}\b(?:brain|CNS)\b",
        population_text,
        re.I,
    ):
        return None
    # exact condition names only, no substrings or abbreviations
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
    # anything fuzzier than this goes to stage 2
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
