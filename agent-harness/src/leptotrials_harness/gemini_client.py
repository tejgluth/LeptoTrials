"""Official Google GenAI Interactions adapter; no fallback model or hidden tools."""

import os
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx
from google import genai
from google.genai import errors, types

from .config import ModelConfig
from .logging_utils import canonical
from .structured_input import wire_output_schema


class ModelFailure(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        retryable: bool = True,
        retry_after: float | None = None,
        halt_provider: bool | None = None,
    ):
        super().__init__(message)
        self.code = code if code and re.fullmatch(r"[a-z0-9_]{1,80}", code) else None
        self.retryable = retryable
        self.retry_after = retry_after
        self.halt_provider = not retryable if halt_provider is None else halt_provider


@dataclass
class ModelReply:
    text: str
    model_version: str
    usage: dict[str, Any]
    latency_ms: float


class GeminiClient:
    def __init__(self, config: ModelConfig, client=None):
        self.config = config
        key_env = config.api_key_env or "GEMINI_API_KEY"
        if client is None and not os.getenv(key_env):
            raise ModelFailure(
                f"{key_env} is not configured; use --dry-run or configure local .env",
                code="missing_api_key",
                retryable=False,
            )
        self.client = client or genai.Client(
            api_key=os.environ[key_env],
            http_options=types.HttpOptions(
                timeout=config.timeout_seconds * 1000,
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )

    def generate(self, system: str, task: str, payload: dict) -> ModelReply:
        start = time.perf_counter()
        generation = {
            "temperature": self.config.temperature,
            "max_output_tokens": self.config.max_output_tokens,
        }
        if self.config.reasoning_effort:
            generation["thinking_level"] = self.config.reasoning_effort
        try:
            response = self.client.interactions.create(
                model=self.config.model_id,
                system_instruction=system,
                input=task + "\n" + canonical(payload),
                generation_config=generation,
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": wire_output_schema(payload),
                },
                store=False,
                timeout=self.config.timeout_seconds,
            )
        except (errors.APIError, httpx.HTTPError, TimeoutError) as exc:
            # Never serialize an SDK exception body: upstream diagnostics can contain secrets.
            raise ModelFailure(f"Gemini request failed: {type(exc).__name__}") from None
        if getattr(response, "status", None) not in (None, "completed"):
            raise ModelFailure("Gemini returned incomplete/failed interaction")
        text = getattr(response, "output_text", None)
        if not text:
            raise ModelFailure("Gemini returned no structured output")
        usage = getattr(response, "usage", None)
        if hasattr(usage, "model_dump"):
            usage = usage.model_dump(mode="json", exclude_none=True)
        return ModelReply(
            text=text,
            model_version=getattr(response, "model", None) or self.config.model_id,
            usage=usage or {},
            latency_ms=(time.perf_counter() - start) * 1000,
        )

    def close(self):
        self.client.close()
