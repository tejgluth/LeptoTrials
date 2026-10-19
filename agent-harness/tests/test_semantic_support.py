import json

import pytest
from conftest import response, trial

from leptotrials_harness.evidence import (
    EvidenceError,
    has_plain_lm_exclusion,
    scope_is_source_named,
    verify_evidence,
)
from leptotrials_harness.local_contract import available_categories
from leptotrials_harness.models import ClassificationOutput


def test_qualified_lm_exclusion_is_not_blanket_exclusion():
    item = trial(
        "Exclusion Criteria:~Symptomatic, progressive or corticosteroids-requiring "
        "documented brain metastases or~leptomeningeal disease involvement."
    )
    with pytest.raises(EvidenceError, match="Qualified symptomatic"):
        verify_evidence(
            ClassificationOutput.model_validate_json(json.dumps(response(item, "LM_EXCLUDED"))),
            item,
        )


def test_positive_lm_exception_under_exclusion_heading_is_not_plain_exclusion():
    item = trial(
        "Exclusion Criteria:~Patients with leptomeningeal disease are eligible if "
        "immediate CNS treatment is not required."
    )
    assert not has_plain_lm_exclusion(item)
    verify_evidence(ClassificationOutput.model_validate_json(json.dumps(response(item))), item)


def test_plain_cohort_exclusion_must_be_addressed_separately():
    positive = "Part F: Patients with leptomeningeal disease may enroll."
    item = trial(
        "Inclusion Criteria:~" + positive + "~Exclusion Criteria:~"
        "Parts A and B: Leptomeningeal disease."
    )
    assert has_plain_lm_exclusion(item)
    proposed = response(item, "LM_INCLUSIVE_COHORT_SPECIFIC", quote=positive, cohort="Part F")
    with pytest.raises(EvidenceError, match="not addressed"):
        verify_evidence(ClassificationOutput.model_validate_json(json.dumps(proposed)), item)


def test_local_cohort_label_needs_source_signal_not_conditional_sentence():
    item = trial("Patients with stable leptomeningeal disease may enroll.")
    assert "LM_INCLUSIVE_COHORT_SPECIFIC" not in available_categories(item.model_dump())
    item.eligibility.raw_text = "Cohort C: Patients with LM may enroll."
    assert "LM_INCLUSIVE_COHORT_SPECIFIC" in available_categories(item.model_dump())


def test_generic_cancer_quote_cannot_support_affirmative_lm_permission():
    item = trial("Patients with cancer may enroll.")
    with pytest.raises(EvidenceError, match="does not establish LM permission"):
        verify_evidence(ClassificationOutput.model_validate_json(json.dumps(response(item))), item)


def test_generated_population_names_cannot_hide_unscoped_conflicts():
    item = trial("Patients with stable leptomeningeal disease may enroll. Cohort C allows LM.")
    assert not scope_is_source_named("Patients with stable leptomeningeal disease", item)
    assert scope_is_source_named("Cohort C", item)
    item.candidate_retrieval_reasons = ["Search for Cohort Z"]
    assert not scope_is_source_named("Cohort Z", item)
