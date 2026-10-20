"""OpenAI Responses API client, plus OpenAI-compatible chat endpoints."""

import os
import time

import openai

from .config import ModelConfig
from .gemini_client import ModelFailure, ModelReply
from .logging_utils import canonical
from .structured_input import wire_output_schema


class OpenAIClient:
    def __init__(self, config: ModelConfig, client=None):
        self.config = config
        key_env = config.api_key_env or (
            "OPENAI_API_KEY" if config.provider == "openai" else "OPENAI_COMPATIBLE_API_KEY"
        )
        if client is None and not os.getenv(key_env):
            raise ModelFailure(f"{key_env} is not configured; set local .env or use --dry-run")
        self.client = client or openai.OpenAI(
            api_key=os.environ[key_env],
            base_url=config.base_url,
            timeout=config.timeout_seconds,
            max_retries=0,
        )

    def generate(self, system: str, task: str, payload: dict) -> ModelReply:
        start = time.perf_counter()
        schema = wire_output_schema(payload)
        temperature = (
            {"temperature": self.config.temperature} if self.config.send_temperature else {}
        )
        try:
            if self.config.provider == "openai":
                reasoning = (
                    {"reasoning": {"effort": self.config.reasoning_effort}}
                    if self.config.reasoning_effort
                    else {}
                )
                response = self.client.responses.create(
                    model=self.config.model_id,
                    instructions=system,
                    input=task + "\n" + canonical(payload),
                    text={
                        "format": {
                            "type": "json_schema",
                            "name": "lm_classification",
                            "strict": True,
                            "schema": schema,
                        }
                    },
                    max_output_tokens=self.config.max_output_tokens,
                    store=False,
                    **reasoning,
                    **temperature,
                )
                if response.status != "completed" or not response.output_text:
                    raise ModelFailure("OpenAI returned refusal, incomplete response or no output")
                text = response.output_text
                usage = response.usage.model_dump(mode="json") if response.usage else {}
                usage = {
                    **usage,
                    "total_input_tokens": usage.get("input_tokens"),
                    "total_output_tokens": usage.get("output_tokens"),
                }
            else:
                reasoning = (
                    {"reasoning_effort": self.config.reasoning_effort}
                    if self.config.reasoning_effort
                    else {}
                )
                response = self.client.chat.completions.create(
                    model=self.config.model_id,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": task + "\n" + canonical(payload)},
                    ],
                    response_format={
                        "type": "json_schema",
                        "json_schema": {
                            "name": "lm_classification",
                            "strict": True,
                            "schema": schema,
                        },
                    },
                    max_tokens=self.config.max_output_tokens,
                    **reasoning,
                    **temperature,
                )
                if not response.choices or response.choices[0].finish_reason != "stop":
                    raise ModelFailure("Compatible provider returned incomplete output")
                text = response.choices[0].message.content
                usage = response.usage.model_dump(mode="json") if response.usage else {}
                usage = {
                    **usage,
                    "total_input_tokens": usage.get("prompt_tokens"),
                    "total_output_tokens": usage.get("completion_tokens"),
                }
                if not text:
                    raise ModelFailure("Compatible provider returned no output")
        except openai.OpenAIError as exc:
            status = getattr(exc, "status_code", None)
            code = getattr(exc, "code", None)
            terminal = code in {
                "credit_balance_exhausted",
                "insufficient_quota",
                "billing_hard_limit_reached",
                "invalid_api_key",
                "model_not_found",
            }
            retryable = not terminal and (
                status is None or status in (408, 409, 429) or status >= 500
            )
            headers = getattr(getattr(exc, "response", None), "headers", {})
            retry_header = headers.get("retry-after", "")
            delay = float(retry_header) if retry_header.replace(".", "", 1).isdigit() else None
            raise ModelFailure(
                f"Provider request failed: {type(exc).__name__}; HTTP {status}",
                code=code,
                retryable=retryable,
                retry_after=delay,
            ) from None
        return ModelReply(text, response.model, usage, (time.perf_counter() - start) * 1000)

    def close(self):
        self.client.close()
