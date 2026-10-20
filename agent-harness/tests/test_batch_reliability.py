import copy
import json

from conftest import FakeModel, response, trial

from leptotrials_harness.agent_classifier import classify_agent
from leptotrials_harness.decision_pipeline import Pipeline, run_performance
from leptotrials_harness.gemini_client import ModelFailure, ModelReply


def test_concurrent_batch_keeps_input_order(config, tmp_path):
    inputs = [trial("", conditions=["Leptomeningeal Metastasis"]) for _ in range(5)]
    for i, item in enumerate(inputs):
        item.nct_id = f"NCT0000000{i}"
    pipeline = Pipeline(config, tmp_path, dry_run=True)
    rows = pipeline.classify_many(inputs, workers=3)
    assert [r["nct_id"] for r in rows] == [t.nct_id for t in inputs]
    manifest = pipeline.finish()
    assert manifest["record_ids"] == [t.nct_id for t in inputs]
    assert len(list((pipeline.run_dir / "decisions").glob("*.json"))) == 5


def test_rejected_quote_retry_receives_explicit_feedback(config, monkeypatch):
    monkeypatch.setattr("leptotrials_harness.agent_classifier.time.sleep", lambda _: None)
    config.model.max_attempts = 2
    t = trial()
    good = response(t)
    bad = copy.deepcopy(good)
    bad["evidence"][0]["quote"] = "Invented source text"

    class RepairingModel(FakeModel):
        def generate(self, system, task, payload):
            self.calls += 1
            if self.calls == 1:
                assert "validation_feedback" not in payload
                result = bad
            else:
                assert payload["validation_feedback"]["previous_attempt_rejected"]
                result = good
            return ModelReply(json.dumps(result), self.config.model_id, {}, 1)

    result = classify_agent(t, RepairingModel(config, good))
    assert len(result["attempts"]) == 2
    assert result["result"]["is_lm_inclusive"] is True
    assert result["attempts"][0]["error"]["type"] == "SCHEMA_OR_EVIDENCE_FAILURE"


def test_credit_exhaustion_stops_retries_and_later_model_calls(config, tmp_path):
    config.model.max_attempts = 3
    client = FakeModel(
        config, ModelFailure("credit unavailable", code="credit_balance_exhausted", retryable=False)
    )
    first, second = trial(), trial()
    second.nct_id = "NCT01234568"
    pipeline = Pipeline(config, tmp_path, client=client)
    rows = pipeline.classify_many([first, second])
    assert client.calls == 1
    assert all(r["error"] == "MODEL_FAILURE" for r in rows)
    assert len(rows[0]["attempts"]) == 1
    assert rows[1]["model_called"] is False
    manifest = pipeline.finish()
    assert manifest["terminal_provider_error"] == "credit_balance_exhausted"
    assert manifest["state"] == "failed"


def test_schema_retry_reports_semantic_violation_without_input_echo(config, monkeypatch):
    monkeypatch.setattr("leptotrials_harness.agent_classifier.time.sleep", lambda _: None)
    config.model.max_attempts = 2
    t = trial()
    good = response(t, "LM_NOT_INCLUDED")
    bad = copy.deepcopy(good)
    bad["is_lm_inclusive"] = True  # A do-not-include decision cannot claim inclusion.
    bad["primary_reason"] = "UNTRUSTED_TEXT_DO_NOT_ECHO_IN_ERROR"

    class RepairingModel(FakeModel):
        def generate(self, system, task, payload):
            self.calls += 1
            if self.calls == 2:
                feedback = payload["validation_feedback"]
                violation = feedback["error"]["violations"][0]
                assert violation["message"] == "Value error, Binary label contradicts taxonomy"
                assert "UNTRUSTED_TEXT_DO_NOT_ECHO_IN_ERROR" not in json.dumps(feedback)
            return ModelReply(
                json.dumps(bad if self.calls == 1 else good), self.config.model_id, {}, 1
            )

    result = classify_agent(t, RepairingModel(config, good))
    assert result["result"]["is_lm_inclusive"] is False
    assert result["result"]["requires_human_review"] is False
    assert len(result["attempts"]) == 2


def test_missing_usage_is_unknown_not_zero_cost(config, tmp_path):
    config.model.input_usd_per_million = config.model.output_usd_per_million = 1.0
    pipeline = Pipeline(config, tmp_path, client=FakeModel(config, ModelFailure("transport error")))
    row = pipeline.classify(trial())
    result = run_performance([row], config)
    assert result["input_tokens"] is None and result["output_tokens"] is None
    assert result["estimated_cost_usd"] is None
    assert result["token_usage_complete"] is False
