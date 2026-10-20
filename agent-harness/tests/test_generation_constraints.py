import copy

import pytest
from conftest import response, trial
from jsonschema import ValidationError, validate

from leptotrials_harness.local_contract import LOCAL_WIRE_VERSION, local_wire_schema
from leptotrials_harness.models import TrialInput
from leptotrials_harness.structured_input import model_payload


def wire(item, category="LM_INCLUSIVE_GENERAL", cohort=None):
    payload = model_payload(item, "gemma4:latest", provider="ollama")
    data = response(item, category)
    data.update(payload["provenance"])
    data["wire_schema_version"] = LOCAL_WIRE_VERSION
    anchor = next(a for a in payload["source_passages"] if a["field"] == "eligibility.raw_text")
    data["evidence"] = [
        {
            "source_passage_id": anchor["source_passage_id"],
            "cohort": cohort,
            "direction": "context" if category == "LM_NOT_INCLUDED" else "inclusion",
            "interpretation": "Synthetic evidence fixture",
        }
    ]
    return payload, data


def test_grammar_prevents_contradictory_binary_and_missing_affirmative_evidence():
    payload, data = wire(trial())
    schema = local_wire_schema(payload)
    validate(data, schema)
    for patch in ({"is_lm_inclusive": False}, {"evidence": []}):
        with pytest.raises(ValidationError):
            validate(data | patch, schema)


def test_generic_title_cannot_be_cited_as_affirmative_lm_evidence():
    payload, data = wire(trial())
    title = next(a for a in payload["source_passages"] if a["field"] == "brief_title")
    data["evidence"][0]["source_passage_id"] = title["source_passage_id"]
    with pytest.raises(ValidationError):
        validate(data, local_wire_schema(payload))


def test_named_cohort_required_and_cannot_be_invented():
    payload, data = wire(
        trial("Cohort C: Patients with leptomeningeal disease may enroll."),
        "LM_INCLUSIVE_COHORT_SPECIFIC",
        "Cohort C",
    )
    schema = local_wire_schema(payload)
    validate(data, schema)
    for cohort in (None, "Patients with stable LM", "Cohort Z"):
        changed = copy.deepcopy(data)
        changed["evidence"][0]["cohort"] = cohort
        with pytest.raises(ValidationError):
            validate(changed, schema)


def test_cohort_name_cannot_be_attached_to_another_cohorts_arm_evidence():
    item = trial(
        "Cohort A: Patients with leptomeningeal disease may enroll.",
        arms=[
            {"label": "Cohort A", "description": "Leptomeningeal disease may enroll."},
            {"label": "Cohort B", "description": "Leptomeningeal disease is excluded."},
        ],
    )
    payload, data = wire(item, "LM_INCLUSIVE_COHORT_SPECIFIC", "Cohort B")
    anchor = next(
        a for a in payload["source_passages"] if a["field"] == "arms_and_cohorts.0.description"
    )
    data["evidence"][0]["source_passage_id"] = anchor["source_passage_id"]
    with pytest.raises(ValidationError):
        validate(data, local_wire_schema(payload))


@pytest.mark.parametrize(
    "criteria",
    [
        "Exclusion Criteria: Brain metastases.",
        "Exclusion Criteria: Symptomatic leptomeningeal disease requiring immediate treatment.",
    ],
)
def test_generic_or_qualified_restriction_cannot_generate_blanket_lm_exclusion(criteria):
    payload = model_payload(trial(criteria), "gemma4:latest", provider="ollama")
    assert "LM_EXCLUDED" not in local_wire_schema(payload)["$defs"]["Classification"]["enum"]
    assert "LM_NOT_INCLUDED" in local_wire_schema(payload)["$defs"]["Classification"]["enum"]


def test_positive_decision_cannot_omit_existing_lm_exclusion():
    payload, data = wire(
        trial(
            "Inclusion Criteria: Cohort C: Patients with leptomeningeal disease may enroll. "
            "Exclusion Criteria: Cohort A: leptomeningeal disease is excluded."
        ),
        "LM_INCLUSIVE_COHORT_SPECIFIC",
        "Cohort C",
    )
    schema = local_wire_schema(payload)
    with pytest.raises(ValidationError):
        validate(data, schema)
    data["conflicting_evidence"] = [
        {
            **data["evidence"][0],
            "direction": "exclusion",
            "cohort": "Cohort A",
        }
    ]
    validate(data, schema)


def test_empty_registry_only_allows_not_included():
    payload = model_payload(TrialInput(nct_id="NCT01234567"), "gemma4:latest", provider="ollama")
    schema = local_wire_schema(payload)
    assert schema["$defs"]["Classification"]["enum"] == ["LM_NOT_INCLUDED"]
    assert schema["properties"]["evidence"]["maxItems"] == 0
    assert payload["output_transport"]["available_classifications"] == ["LM_NOT_INCLUDED"]


def test_plain_exclusion_remains_available():
    payload = model_payload(
        trial("Exclusion Criteria: Leptomeningeal disease is excluded."),
        "gemma4:latest",
        provider="ollama",
    )
    assert "LM_EXCLUDED" in local_wire_schema(payload)["$defs"]["Classification"]["enum"]
