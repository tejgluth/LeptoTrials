import json

import pytest
from conftest import response, trial

from leptotrials_harness.evidence import EvidenceError, verify_evidence
from leptotrials_harness.models import ClassificationOutput
from leptotrials_harness.source_passages import rejection_hints, source_passages
from leptotrials_harness.structured_input import model_payload, wire_output_schema
from leptotrials_harness.terminology import detect


def test_copying_aids_are_exact_and_do_not_replace_full_eligibility():
    text = (
        "Inclusion Criteria:~Cohort C: Patients with LM may enroll.~Exclusion Criteria:~"
        "Cohort A: Patients with lepto-meningeal disease are excluded."
    )
    item = trial(text)
    payload = model_payload(item, "test")
    assert payload["trial"]["eligibility"]["raw_text"] == text
    anchors = source_passages(item)
    assert any("lepto-meningeal" in a["quote"] for a in anchors)
    for anchor in anchors:
        output = response(item, field=anchor["field"], quote=anchor["quote"])
        verify_evidence(
            ClassificationOutput.model_validate_json(json.dumps(output)),
            item,
            semantic_support=False,
        )


def test_retry_hints_dont_fix_invalid_quotes():
    item = trial("Exclusion Criteria:~2. Known leptomeningeal disease~3. Infection")
    rejected = response(item, "LM_EXCLUDED", quote="Known leptomeningeal disease...")
    original = json.dumps(rejected)
    hints = rejection_hints(original, item)
    assert hints and hints[0]["quote"] in item.eligibility.raw_text
    assert json.loads(original) == rejected
    with pytest.raises(EvidenceError, match="Quote absent"):
        verify_evidence(ClassificationOutput.model_validate_json(original), item)


def test_brain_exclusion_not_accepted_as_explicit_lm_exclusion():
    item = trial("Exclusion Criteria: Brain metastases.")
    output = response(item, "LM_EXCLUDED")
    with pytest.raises(EvidenceError, match="LM-specific exclusion"):
        verify_evidence(ClassificationOutput.model_validate_json(json.dumps(output)), item)


def test_carcinomatous_meningitis_and_hyphenated_synonym_detected():
    assert "carcinomatous meningitis" in detect("CNS metastases and/or carcinomatous meningitis")
    assert "lepto-meningeal" in detect("Previously untreated lepto-meningeal disease")


def test_local_wire_choices_are_real_source_quotes_and_fields():
    item = trial("Part F includes patients with~            leptomeningeal metastases.")
    payload = model_payload(item, "gemma4:latest")
    schema = wire_output_schema(payload, constrain_quotes=True)
    evidence = schema["$defs"]["Evidence"]["anyOf"][-1]["properties"]
    assert any("~" in q for q in evidence["quote"]["enum"])
    assert evidence["quote"]["enum"] == sorted({a["quote"] for a in payload["source_passages"]})
    assert all(a["field"] in evidence["field"]["enum"] for a in payload["source_passages"])
    assert "~" in payload["trial"]["eligibility"]["raw_text"]


def test_local_generation_cannot_quote_plain_exclusion_as_inclusion():
    item = trial(
        "Inclusion Criteria:~Part F: leptomeningeal metastases required.~"
        + "Other criteria. " * 40
        + "Exclusion Criteria:~Parts A: leptomeningeal metastases excluded."
        " Note: discrete dural metastases are permitted."
    )
    schema = wire_output_schema(model_payload(item, "test"), constrain_quotes=True)
    branches = schema["$defs"]["Evidence"]["anyOf"]
    inclusion = next(b for b in branches if b["properties"]["direction"]["enum"] == ["inclusion"])
    assert all("Parts A:" not in q for q in inclusion["properties"]["quote"]["enum"])


def test_wrong_cohort_exclusion_cannot_be_used_as_affirmative_evidence():
    item = trial(
        "Inclusion Criteria:~Part F: leptomeningeal metastases required.~"
        "Exclusion Criteria:~Parts A and B: leptomeningeal metastases."
    )
    bad = response(
        item,
        "LM_INCLUSIVE_COHORT_SPECIFIC",
        cohort="Part F",
        quote="Parts A and B: leptomeningeal metastases.",
    )
    with pytest.raises(EvidenceError, match="exclusion section"):
        verify_evidence(ClassificationOutput.model_validate_json(json.dumps(bad)), item)
    good = response(
        item,
        "LM_INCLUSIVE_COHORT_SPECIFIC",
        cohort="Part F",
        quote="Part F: leptomeningeal metastases required.",
    )
    good["conflicting_evidence"] = [
        {**bad["evidence"][0], "direction": "exclusion", "cohort": "Parts A and B"}
    ]
    verify_evidence(ClassificationOutput.model_validate_json(json.dumps(good)), item)


def test_dural_permission_does_not_turn_lm_exclusion_into_inclusion():
    quote = (
        "For Parts A, B: Have evidence of leptomeningeal metastases. "
        "Note: discrete dural metastases are permitted."
    )
    item = trial("Exclusion Criteria:~" + quote)
    bad = response(item, "LM_INCLUSIVE_COHORT_SPECIFIC", cohort="Parts A, B", quote=quote)
    with pytest.raises(EvidenceError, match="exclusion section"):
        verify_evidence(ClassificationOutput.model_validate_json(json.dumps(bad)), item)
