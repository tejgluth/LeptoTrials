import json

import pytest
from conftest import response, trial
from jsonschema import validate
from pydantic import ValidationError

from leptotrials_harness.evidence import EvidenceError, verify_evidence
from leptotrials_harness.models import ClassificationOutput


def test_valid_result_satisfies_schema_and_source():
    t = trial()
    data = response(t)
    validate(data, ClassificationOutput.model_json_schema())
    verify_evidence(ClassificationOutput.model_validate_json(json.dumps(data)), t)


def test_payload_root_paths_and_string_array_fields():
    t = trial()
    t.keywords = ["leptomeningeal disease", "breast cancer"]
    for field in ("keywords", "trial.keywords", "trial.keywords.0"):
        data = response(t, field=field, quote="leptomeningeal disease")
        verify_evidence(ClassificationOutput.model_validate_json(json.dumps(data)), t)
    with pytest.raises(EvidenceError):
        data = response(t, field="keywords", quote="disease breast")
        verify_evidence(ClassificationOutput.model_validate_json(json.dumps(data)), t)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.pop("classification"),
        lambda d: d.update(classification="YES"),
        lambda d: d.update(evidence=[{"quote": "bad"}]),
        lambda d: d.update(is_lm_inclusive=False),
        lambda d: d.update(evidence=[]),
        lambda d: d.update(classification="LM_INCLUSIVE_COHORT_SPECIFIC"),
    ],
)
def test_invalid_results_rejected(mutate):
    data = response(trial())
    mutate(data)
    with pytest.raises(ValidationError):
        ClassificationOutput.model_validate_json(json.dumps(data))


@pytest.mark.parametrize(
    "field,quote",
    [
        ("eligibility.raw_text", "fabricated passage"),
        ("eligibility.nonexistent", "anything"),
        ("deterministic_signals.lm_terms_in_title.0", "LM"),
    ],
)
def test_source_quote_and_path_verification(field, quote):
    t = trial()
    data = response(t, field=field, quote=quote)
    with pytest.raises(EvidenceError):
        verify_evidence(ClassificationOutput.model_validate_json(json.dumps(data)), t)
