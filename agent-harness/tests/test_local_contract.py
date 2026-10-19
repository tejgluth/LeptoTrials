import json

import pytest
from conftest import response, trial
from pydantic import ValidationError

from leptotrials_harness.evidence import EvidenceError, verify_evidence
from leptotrials_harness.local_contract import (
    LOCAL_WIRE_VERSION,
    local_wire_schema,
    resolve_local_output,
)
from leptotrials_harness.structured_input import model_payload


def referenced(item, payload):
    result = response(item)
    anchor = next(a for a in payload["source_passages"] if a["field"] == "eligibility.raw_text")
    result["wire_schema_version"] = LOCAL_WIRE_VERSION
    result["evidence"] = [
        {
            "source_passage_id": anchor["source_passage_id"],
            "cohort": None,
            "direction": "inclusion",
            "interpretation": "Explicit permission",
        }
    ]
    return result


def test_typed_reference_transport_binds_field_and_quote_together_and_preserves_raw():
    item = trial("Patients with~leptomeningeal disease may enroll.")
    payload = model_payload(item, "test", provider="ollama")
    raw = json.dumps(referenced(item, payload))
    canonical = resolve_local_output(raw, payload)
    verify_evidence(canonical, item)
    assert canonical.evidence[0].field == "eligibility.raw_text"
    assert canonical.evidence[0].quote == item.eligibility.raw_text
    assert "source_passage_id" in json.loads(raw)["evidence"][0]
    assert "quote" not in json.loads(raw)["evidence"][0]
    assert "wire_schema_version" not in canonical.model_dump()
    assert payload["trial"]["eligibility"]["raw_text"] == item.eligibility.raw_text


def test_unknown_reference_or_mixed_free_quote_output_is_rejected_not_repaired():
    item = trial()
    payload = model_payload(item, "test", provider="ollama")
    data = referenced(item, payload)
    data["evidence"][0]["source_passage_id"] = "S999"
    with pytest.raises(EvidenceError, match="Unknown source passage"):
        resolve_local_output(json.dumps(data), payload)
    data = referenced(item, payload)
    data["evidence"][0]["quote"] = "invented"
    with pytest.raises(ValidationError):
        resolve_local_output(json.dumps(data), payload)


def test_local_wire_ids_are_direction_constrained_and_have_no_free_quote_field():
    item = trial(
        "Inclusion Criteria:~Cohort C: leptomeningeal disease may enroll.~"
        + "Other criteria. " * 40
        + "Exclusion Criteria:~Cohort A: leptomeningeal disease excluded."
    )
    payload = model_payload(item, "test", provider="ollama")
    schema = local_wire_schema(payload)
    branch = next(
        b
        for b in schema["$defs"]["EvidenceReference"]["anyOf"]
        if b["properties"]["direction"]["enum"] == ["inclusion"]
    )
    ids = branch["properties"]["source_passage_id"]["enum"]
    negative_ids = [
        a["source_passage_id"]
        for a in payload["source_passages"]
        if a.get("section_hint") == "exclusion"
    ]
    assert negative_ids and not set(ids).intersection(negative_ids)
    assert "quote" not in branch["properties"] and "field" not in branch["properties"]


def test_eligibility_sentence_cannot_invent_a_source_named_cohort():
    item = trial("Patients with stable leptomeningeal disease are eligible.")
    output = response(
        item, "LM_INCLUSIVE_COHORT_SPECIFIC", cohort="Patients with stable leptomeningeal disease"
    )
    from leptotrials_harness.models import ClassificationOutput

    with pytest.raises(EvidenceError, match="Conditional permission alone"):
        verify_evidence(ClassificationOutput.model_validate_json(json.dumps(output)), item)
