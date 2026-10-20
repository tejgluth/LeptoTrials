import json

import pytest
from conftest import FakeModel, response, trial
from jsonschema import ValidationError as SchemaError
from jsonschema import validate
from pydantic import ValidationError

from leptotrials_harness.agent_classifier import classify_agent
from leptotrials_harness.decision_pipeline import Pipeline
from leptotrials_harness.evidence import EvidenceError, verify_evidence
from leptotrials_harness.local_contract import local_wire_schema
from leptotrials_harness.models import SCHEMA_VERSION, UNRESOLVED, ClassificationOutput
from leptotrials_harness.structured_input import model_payload, wire_output_schema


@pytest.mark.parametrize("category", sorted(UNRESOLVED))
def test_current_outputs_reject_abstention_in_typed_and_generated_schema(category):
    data = response(trial(), category)
    with pytest.raises(ValidationError, match="unclear is not allowed"):
        ClassificationOutput.model_validate_json(json.dumps(data))
    with pytest.raises(SchemaError):
        validate(data, ClassificationOutput.model_json_schema())


@pytest.mark.parametrize("provider", ["ollama", "google", "openai", "anthropic"])
def test_every_live_provider_schema_requires_boolean_decision(provider):
    payload = model_payload(trial(), "test", provider=provider)
    schema = local_wire_schema(payload) if provider == "ollama" else wire_output_schema(payload)
    assert not set(schema["$defs"]["Classification"]["enum"]).intersection(UNRESOLVED)
    assert "LM_NOT_INCLUDED" in schema["$defs"]["Classification"]["enum"]
    assert schema["properties"]["is_lm_inclusive"] == {"type": "boolean"}
    assert schema["properties"]["requires_human_review"]["enum"] == [False]
    assert payload["decision_policy"]["decision_required"] is True
    assert payload["provenance"]["output_schema_version"] == SCHEMA_VERSION


def test_no_registry_support_produces_concrete_negative_without_false_exclusion(config, tmp_path):
    item = trial("Previously treated brain metastases may participate.")
    output = response(item, "LM_NOT_INCLUDED")
    row = Pipeline(config, tmp_path, client=FakeModel(config, output)).classify(item)
    assert row["classification"] == "LM_NOT_INCLUDED"
    assert row["result"]["is_lm_inclusive"] is False
    assert row["status"] == "MODEL_CLASSIFIED"
    assert row["requires_review"] is False
    assert row["error"] is None


def test_empty_source_can_return_do_not_include_without_fabricating_evidence():
    item = trial("")
    output = response(item, "LM_NOT_INCLUDED")
    output["evidence"] = []
    result = ClassificationOutput.model_validate_json(json.dumps(output))
    verify_evidence(result, item)
    assert result.is_lm_inclusive is False


def test_actual_lm_evidence_still_required_for_inclusion():
    item = trial("Previously treated brain metastases may participate.")
    output = ClassificationOutput.model_validate_json(json.dumps(response(item)))
    with pytest.raises(EvidenceError, match="does not establish LM permission"):
        verify_evidence(output, item)


def test_legacy_abstentions_remain_readable_but_cannot_satisfy_new_requests(config):
    item = trial()
    data = response(item, "AMBIGUOUS_REQUIRES_REVIEW")
    data["output_schema_version"] = "1.0.0"
    historical = ClassificationOutput.model_validate_json(json.dumps(data))
    validate(data, ClassificationOutput.model_json_schema())
    verify_evidence(historical, item)
    assert historical.is_lm_inclusive is None
    result = classify_agent(item, FakeModel(config, data))
    assert result["result"] is None
    assert result["error"] == "MODEL_FAILURE"
    assert "schema version does not match" in result["attempts"][0]["error"]["message"]


def test_rejected_unclear_answer_is_retried_not_silently_converted(config, monkeypatch):
    from leptotrials_harness.gemini_client import ModelReply

    monkeypatch.setattr("leptotrials_harness.agent_classifier.time.sleep", lambda _: None)
    config.model.max_attempts = 2
    item = trial("Patients with breast cancer may enroll.")

    class DecidingModel(FakeModel):
        def generate(self, system, task, payload):
            self.calls += 1
            if self.calls == 1:
                output = response(item, "INSUFFICIENT_INFORMATION")
            else:
                instruction = payload["validation_feedback"]["instruction"]
                assert "LM_NOT_INCLUDED" in instruction
                assert "use ambiguity if unclear" not in instruction
                output = response(item, "LM_NOT_INCLUDED")
            return ModelReply(json.dumps(output), self.config.model_id, {}, 1)

    result = classify_agent(item, DecidingModel(config, {}))
    assert len(result["attempts"]) == 2
    assert result["attempts"][0]["error"]
    assert result["result"]["classification"] == "LM_NOT_INCLUDED"
    assert result["result"]["is_lm_inclusive"] is False


def test_current_outputs_reject_null_decision_and_review_request():
    for patch in ({"is_lm_inclusive": None}, {"requires_human_review": True}):
        data = response(trial()) | patch
        with pytest.raises(ValidationError):
            ClassificationOutput.model_validate_json(json.dumps(data))
        with pytest.raises(SchemaError):
            validate(data, ClassificationOutput.model_json_schema())
