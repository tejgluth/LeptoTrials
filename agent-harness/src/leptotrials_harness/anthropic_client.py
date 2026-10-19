"""Anthropic Messages API with JSON schema, bounded transport and no thought storage."""

import os
import time

import httpx

from .config import ModelConfig
from .gemini_client import ModelFailure, ModelReply
from .logging_utils import canonical
from .structured_input import wire_output_schema


def wire_schema(value):
    """Remove unsupported grammar constraints; complete local schema still enforced afterward."""
    unsupported = {"minimum", "maximum", "minLength", "maxLength", "pattern", "format"}
    if isinstance(value, dict):
        return {k: wire_schema(v) for k, v in value.items() if k not in unsupported}
    if isinstance(value, list):
        return [wire_schema(v) for v in value]
    return value


class AnthropicClient:
    def __init__(self, config: ModelConfig, client=None):
        self.config = config
        key_env = config.api_key_env or "ANTHROPIC_API_KEY"
        if client is None and not os.getenv(key_env):
            raise ModelFailure(f"{key_env} is not configured; set local .env or use --dry-run")
        self.client = client or httpx.Client(
            timeout=config.timeout_seconds,
            headers={"x-api-key": os.environ[key_env], "anthropic-version": "2023-06-01"},
        )

    def generate(self, system: str, task: str, payload: dict) -> ModelReply:
        start = time.perf_counter()
        body = {
            "model": self.config.model_id,
            "max_tokens": self.config.max_output_tokens,
            "system": system,
            "messages": [{"role": "user", "content": task + "\n" + canonical(payload)}],
            "output_config": {
                "format": {
                    "type": "json_schema",
                    "schema": wire_schema(wire_output_schema(payload)),
                }
            },
        }
        if self.config.reasoning_effort:
            body["thinking"] = {"type": "adaptive"}
            body["output_config"]["effort"] = self.config.reasoning_effort
        elif self.config.send_temperature:
            body["temperature"] = self.config.temperature
        try:
            response = self.client.post("https://api.anthropic.com/v1/messages", json=body)
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ModelFailure(f"Anthropic request failed: {type(exc).__name__}") from None
        if data.get("stop_reason") != "end_turn":
            raise ModelFailure("Anthropic returned refusal or incomplete response")
        text = "".join(
            b.get("text", "") for b in data.get("content", []) if b.get("type") == "text"
        )
        if not text:
            raise ModelFailure("Anthropic returned no structured output")
        usage = data.get("usage") or {}
        usage = {
            **usage,
            "total_input_tokens": usage.get("input_tokens"),
            "total_output_tokens": usage.get("output_tokens"),
        }
        return ModelReply(
            text,
            data.get("model") or self.config.model_id,
            usage,
            (time.perf_counter() - start) * 1000,
        )

    def close(self):
        self.client.close()
