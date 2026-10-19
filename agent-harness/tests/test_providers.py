import json
from types import SimpleNamespace

import httpx
import openai
import pytest
from conftest import response, trial
from pydantic import ValidationError

from leptotrials_harness.anthropic_client import AnthropicClient
from leptotrials_harness.config import ModelConfig
from leptotrials_harness.gemini_client import GeminiClient, ModelFailure
from leptotrials_harness.openai_client import OpenAIClient


def test_openai_responses_request_is_constrained_and_not_stored():
    captured = {}

    def callback(request):
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "resp_test",
                "object": "response",
                "created_at": 1,
                "model": "test-openai",
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "id": "msg_test",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {
                                "type": "output_text",
                                "text": json.dumps(response(trial())),
                                "annotations": [],
                            }
                        ],
                    }
                ],
                "usage": {"input_tokens": 12, "output_tokens": 9, "total_tokens": 21},
            },
        )

    sdk = openai.OpenAI(
        api_key="offline-test-placeholder",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(callback)),
    )
    adapter = OpenAIClient(ModelConfig(provider="openai", model_id="test-openai"), sdk)
    result = adapter.generate("system", "task", {})
    assert result.usage["total_input_tokens"] == 12
    assert captured["text"]["format"]["strict"] is True
    assert captured["store"] is False
    assert captured["reasoning"]["effort"] == "high"
    assert "temperature" not in captured
    assert "tools" not in captured
    adapter.close()


def test_openai_incomplete_and_auth_errors_are_explicit_and_redacted():
    for status, data in [
        (
            200,
            {
                "id": "resp_test",
                "object": "response",
                "created_at": 1,
                "model": "test",
                "status": "incomplete",
                "output": [],
            },
        ),
        (401, {"error": {"message": "secret-diagnostic-not-for-log"}}),
    ]:
        sdk = openai.OpenAI(
            api_key="offline-test-placeholder",
            max_retries=0,
            http_client=httpx.Client(
                transport=httpx.MockTransport(
                    lambda request, status=status, data=data: httpx.Response(status, json=data)
                )
            ),
        )
        adapter = OpenAIClient(ModelConfig(provider="openai", model_id="test"), sdk)
        with pytest.raises(ModelFailure) as error:
            adapter.generate("system", "task", {})
        assert "secret-diagnostic" not in str(error.value)
        adapter.close()


def test_compatible_endpoint_explicit_schema_and_usage():
    requests = []

    def callback(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "chat_test",
                "object": "chat.completion",
                "created": 1,
                "model": "local-test",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "{}"},
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            },
        )

    sdk = openai.OpenAI(
        api_key="offline-test-placeholder",
        base_url="http://localhost:8000/v1",
        http_client=httpx.Client(transport=httpx.MockTransport(callback)),
    )
    config = ModelConfig(
        provider="openai-compatible",
        model_id="local-test",
        base_url="http://localhost:8000/v1",
        reasoning_effort=None,
    )
    result = OpenAIClient(config, sdk).generate("system", "task", {})
    assert requests[0]["response_format"]["json_schema"]["strict"]
    assert result.usage["total_output_tokens"] == 5
    sdk.close()


def test_anthropic_structured_output_and_thoughts_not_retained():
    captured = {}

    def callback(request):
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "model": "test",
                "stop_reason": "end_turn",
                "content": [
                    {"type": "thinking", "thinking": "must-not-retain"},
                    {"type": "text", "text": "{}"},
                ],
                "usage": {"input_tokens": 12, "output_tokens": 9},
            },
        )

    adapter = AnthropicClient(
        ModelConfig(provider="anthropic", model_id="test"),
        httpx.Client(transport=httpx.MockTransport(callback)),
    )
    result = adapter.generate("system", "task", {})
    assert result.text == "{}"
    assert "must-not-retain" not in result.text
    assert captured["output_config"]["format"]["type"] == "json_schema"
    assert captured["thinking"] == {"type": "adaptive"}
    adapter.close()


def test_gemini_exact_sdk_parameters_and_metadata():
    captured = {}

    def create(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            status="completed",
            output_text="{}",
            model="gemini-3.8-flash",
            usage=SimpleNamespace(model_dump=lambda **_: {"total_input_tokens": 10}),
        )

    adapter = GeminiClient(
        ModelConfig(), SimpleNamespace(interactions=SimpleNamespace(create=create))
    )
    reply = adapter.generate("system", "task", {})
    assert captured["generation_config"]["thinking_level"] == "high"
    assert captured["store"] is False
    assert captured["response_format"]["schema"]["additionalProperties"] is False
    assert captured["timeout"] == 90
    assert reply.usage["total_input_tokens"] == 10


def test_credit_exhaustion_is_terminal_and_safe_to_log():
    sdk = openai.OpenAI(
        api_key="offline-test-placeholder",
        max_retries=0,
        http_client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    429,
                    json={
                        "error": {
                            "message": "private upstream diagnostic",
                            "type": "rate_limit_error",
                            "code": "credit_balance_exhausted",
                        }
                    },
                )
            )
        ),
    )
    adapter = OpenAIClient(ModelConfig(provider="openai", model_id="test"), sdk)
    with pytest.raises(ModelFailure) as error:
        adapter.generate("system", "task", {})
    assert error.value.code == "credit_balance_exhausted"
    assert error.value.retryable is False
    assert "private upstream diagnostic" not in str(error.value)
    sdk.close()


@pytest.mark.parametrize(
    "url",
    ["http://remote.example/v1", "https://user:secret@host/v1", "https://host/v1?api_key=secret"],
)
def test_custom_endpoint_cannot_leak_credentials_into_manifests(url):
    with pytest.raises(ValidationError):
        ModelConfig(provider="openai-compatible", model_id="test", base_url=url)
