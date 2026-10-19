import pytest
from conftest import trial

from leptotrials_harness.strict_classifier import classify_strict


def test_explicit_condition_records_rule_and_field():
    rule, result = classify_strict(trial("", conditions=["Leptomeningeal Metastasis"]))
    assert rule == "LM_CONDITION_EXACT_UNCONFLICTED"
    assert result.is_lm_inclusive is True
    assert result.evidence[0].field == "conditions.0"


def test_explicit_enrollment_title_not_background_title():
    assert classify_strict(trial("", title="Therapy in Patients With Leptomeningeal Disease"))
    assert (
        classify_strict(trial("", title="Preventing leptomeningeal disease in breast cancer"))
        is None
    )


@pytest.mark.parametrize(
    "criteria",
    [
        "Exclusion Criteria:\nPatients with known leptomeningeal disease are excluded.",
        "Inclusion Criteria:\nNo evidence of leptomeningeal metastasis.",
        "Patients receiving radiation for leptomeningeal disease must finish "
        "14 days before enrollment.",
        "Symptomatic leptomeningeal disease is excluded. "
        "Stable asymptomatic leptomeningeal disease may enroll.",
    ],
)
def test_contextual_cases_never_bypass(criteria):
    # Broad non-LM conditions route all these cases to contextual Stage 2.
    assert classify_strict(trial(criteria)) is None


def test_conflict_overrides_lm_title_and_condition():
    # NCT06440954 motivation: title/condition does not settle a contradictory record.
    t = trial(
        "Exclusion criteria:\nMeningeal metastasis.",
        conditions=["Leptomeningeal Metastasis"],
        title="Therapy in Patients With Leptomeningeal Disease",
    )
    assert classify_strict(t) is None


def test_cohorts_route_for_contextual_scope():
    t = trial(
        "Cohort A excludes LM; Cohort C allows leptomeningeal disease.",
        arms=[{"label": "Cohort C", "description": "Leptomeningeal disease patients eligible"}],
    )
    assert classify_strict(t) is None


def test_imported_signals_cannot_hide_a_lowercase_acronym_exclusion():
    t = trial(
        "Cancer study. Exclusion Criteria:\nPatients with lmd excluded.",
        conditions=["Leptomeningeal Metastasis"],
    )
    t.deterministic_signals.negative_lm_phrases = []
    t.deterministic_signals.lm_terms_in_exclusion = []
    assert classify_strict(t) is None


def test_lm_condition_does_not_mislabel_mixed_cns_populations_as_lm_specific():
    t = trial(
        "Brain metastases and/or leptomeningeal metastases are eligible.",
        conditions=["Brain Metastases", "Leptomeningeal Metastasis"],
    )
    assert classify_strict(t) is None


def test_confirmed_lmd_exclusion_in_diagnostic_trial_does_not_bypass():
    # Public NCT07415018 source regression, current API capture 2026-10-18.
    item = trial(
        "Inclusion Criteria:\nPatients with tissue confirmed solid malignancy and "
        "equivocal results for LMD. Initially, we will target solid tumors.\n"
        "Exclusion Criteria:\nParticipants with CSF sampling positive for LMD "
        "or MR brain/spine with definitive evidence of LMD.",
        conditions=["Leptomeningeal Disease"],
        title="Optimizing Contrast Dose and Scanning Parameters "
        "for Detection of Leptomeningeal Disease",
    )
    assert "LMD" in item.deterministic_signals.lm_terms_in_exclusion
    assert classify_strict(item) is None
    t = trial(
        "Cohort A: brain metastases. Cohort C: leptomeningeal disease.",
        conditions=["Leptomeningeal Disease"],
    )
    assert classify_strict(t) is None
