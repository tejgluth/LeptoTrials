import json

import httpx
import pytest
from conftest import response, trial

from leptotrials_harness.agent_classifier import classify_agent
from leptotrials_harness.config import load_config
from leptotrials_harness.gemini_client import ModelFailure
from leptotrials_harness.local_contract import LOCAL_WIRE_VERSION
from leptotrials_harness.ollama_client import OllamaClient
from leptotrials_harness.structured_input import model_payload


def recovering_client(config, failure, captured):
    config.model.provider = "ollama"
    config.model.model_id = "gemma4:latest"
    config.model.reasoning_effort = None
    config.model.max_attempts = 3
    item = trial()
    payload = model_payload(item, "gemma4:latest", provider="ollama")
    data = response(item) | payload["provenance"]
    data["wire_schema_version"] = LOCAL_WIRE_VERSION
    anchor = next(a for a in payload["source_passages"] if a["field"] == "eligibility.raw_text")
    data["evidence"] = [
        {
            "source_passage_id": anchor["source_passage_id"],
            "cohort": None,
            "interpretation": "Explicit LM permission",
            "direction": "inclusion",
        }
    ]
    calls = 0

    def callback(request):
        nonlocal calls
        if request.url.path == "/api/tags":
            return httpx.Response(
                200, json={"models": [{"name": "gemma4:latest", "digest": "a" * 64}]}
            )
        if request.url.path == "/api/version":
            return httpx.Response(200, json={"version": "0.40.6"})
        if request.url.path == "/api/show":
            return httpx.Response(200, json={"model_info": {"gemma4.context_length": 131072}})
        calls += 1
        captured.append(json.loads(request.content))
        if calls < 3:
            if isinstance(failure, int):
                return httpx.Response(
                    failure,
                    headers={"retry-after": "2"},
                    json={"error": "UNTRUSTED_SERVER_ERROR_DO_NOT_LOG"},
                )
            raise failure("Simulated transient failure", request=request)
        return httpx.Response(
            200,
            json={"done": True, "done_reason": "stop", "message": {"content": json.dumps(data)}},
        )

    return item, OllamaClient(config.model, httpx.Client(transport=httpx.MockTransport(callback)))


@pytest.mark.parametrize("failure", [httpx.ConnectError, httpx.RemoteProtocolError, 503])
def test_connection_and_temporary_server_errors_recover_with_bounded_attempts(
    config, monkeypatch, failure
):
    monkeypatch.setattr("leptotrials_harness.agent_classifier.time.sleep", lambda _: None)
    captured = []
    item, client = recovering_client(config, failure, captured)
    try:
        row = classify_agent(item, client)
        assert row["result"]["is_lm_inclusive"] is True
        assert len(row["attempts"]) == 3
        assert len(captured) == 3
        assert all(a["error"]["retryable"] for a in row["attempts"][:2])
        assert all(call["keep_alive"] == "30m" for call in captured)
        assert "UNTRUSTED_SERVER_ERROR" not in json.dumps(row)
    finally:
        client.close()


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_bad_requests_and_missing_models_stop_instead_of_retrying(config, status):
    captured = []
    item, client = recovering_client(config, status, captured)
    try:
        row = classify_agent(item, client)
        assert row["result"] is None
        assert len(row["attempts"]) == 1
        assert row["failure_kind"] == "INFERENCE_ERROR"
        assert row["terminal_provider_error"] == (None if status == 400 else f"local_http_{status}")
        assert not row["attempts"][0]["error"]["retryable"]
    finally:
        client.close()


def test_invalid_outputs_are_distinguished_from_inference_errors(config):
    from conftest import FakeModel

    rejected = classify_agent(trial(), FakeModel(config, "not json"))
    broken = classify_agent(trial(), FakeModel(config, ModelFailure("Unavailable")))
    assert rejected["failure_kind"] == "MODEL_OUTPUT_REJECTED"
    assert broken["failure_kind"] == "INFERENCE_ERROR"


def test_local_config_uses_three_attempts():
    from leptotrials_harness.config import RESOURCES

    assert load_config(RESOURCES / "config/ollama.yaml").model.max_attempts == 3


def test_one_invalid_record_does_not_halt_the_remaining_batch(config, tmp_path):
    from conftest import FakeModel

    from leptotrials_harness.decision_pipeline import Pipeline
    from leptotrials_harness.gemini_client import ModelReply

    first, second = trial(), trial()
    second.nct_id = "NCT01234568"

    class RecordFailure(FakeModel):
        def generate(self, *args):
            self.calls += 1
            if self.calls == 1:
                raise ModelFailure(
                    "Invalid record", code="local_http_400", retryable=False, halt_provider=False
                )
            return ModelReply(json.dumps(response(second)), self.config.model_id, {}, 1)

    client = RecordFailure(config, {})
    pipeline = Pipeline(config, tmp_path, client=client)
    rows = pipeline.classify_many([first, second])
    assert rows[0]["failure_kind"] == "INFERENCE_ERROR"
    assert rows[1]["error"] is None
    assert rows[1]["result"]["is_lm_inclusive"] is True
    assert pipeline.provider_halt is None
    assert client.calls == 2
