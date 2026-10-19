import json

import httpx
import pytest

from leptotrials_harness.config import ModelConfig
from leptotrials_harness.gemini_client import ModelFailure
from leptotrials_harness.ollama_client import OllamaClient


def transport(captured, revision="a" * 64):
    def callback(request):
        assert request.url.host == "127.0.0.1"
        assert "authorization" not in request.headers
        if request.url.path == "/api/tags":
            return httpx.Response(
                200, json={"models": [{"name": "gemma4:latest", "digest": revision}]}
            )
        if request.url.path == "/api/version":
            return httpx.Response(200, json={"version": "0.40.6"})
        if request.url.path == "/api/show":
            return httpx.Response(200, json={"model_info": {"gemma4.context_length": 131072}})
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "done": True,
                "done_reason": "stop",
                "message": {"content": "{}", "thinking": "Do not save hidden thoughts"},
                "prompt_eval_count": 200,
                "eval_count": 100,
                "total_duration": 12345,
            },
        )

    return httpx.MockTransport(callback)


def test_native_ollama_same_schema_no_key_and_no_truncation():
    captured = {}
    config = ModelConfig(
        provider="ollama",
        model_id="gemma4:latest",
        base_url="http://127.0.0.1:11434",
        reasoning_effort=None,
    )
    client = OllamaClient(config, httpx.Client(transport=transport(captured)))
    result = client.generate("system", "task", {"trial": {"nct_id": "NCT01234567"}})
    assert captured["format"]["additionalProperties"] is False
    assert captured["truncate"] is False and captured["shift"] is False
    assert captured["options"]["num_ctx"] == 32768
    assert captured["stream"] is False
    assert config.model_revision == "a" * 64
    assert result.text == "{}"
    assert "Do not save" not in result.text
    assert result.usage["api_cost_usd"] == 0
    assert result.usage["local_model"]["digest"] == "a" * 64
    client.close()


def test_model_digest_change_fails_before_inference():
    config = ModelConfig(provider="ollama", model_id="gemma4:latest", model_revision="b" * 64)
    with pytest.raises(ModelFailure, match="differs"):
        OllamaClient(config, httpx.Client(transport=transport({})))


def test_local_provider_cannot_point_at_cloud_service():
    with pytest.raises(ValueError, match="local-only"):
        ModelConfig(provider="ollama", model_id="gemma4:latest", base_url="https://api.example.com")
