"""Native local Ollama adapter: explicit context, JSON schema, no keys or cloud fallback."""

import re
import time

import httpx

from .config import ModelConfig
from .gemini_client import ModelFailure, ModelReply
from .local_contract import local_wire_schema
from .logging_utils import canonical


class OllamaClient:
    def __init__(self, config: ModelConfig, client=None):
        self.config = config
        self.client = client or httpx.Client(
            timeout=httpx.Timeout(config.timeout_seconds, connect=10),
            transport=httpx.HTTPTransport(retries=2, trust_env=False),
            trust_env=False,
        )
        self.url = (config.base_url or "http://127.0.0.1:11434").rstrip("/")
        try:
            tags = self.client.get(self.url + "/api/tags")
            tags.raise_for_status()
            models = tags.json().get("models", [])
            match = next((m for m in models if m.get("name") == config.model_id), None)
            if not match:
                raise ModelFailure(
                    "Requested local model is not installed; pull it explicitly",
                    code="local_model_not_found",
                    retryable=False,
                )
            revision = match.get("digest")
            if not revision:
                raise ModelFailure(
                    "Local model has no digest", code="missing_model_digest", retryable=False
                )
            if config.model_revision and revision != config.model_revision:
                raise ModelFailure(
                    "Installed local model digest differs from configured revision",
                    code="model_revision_mismatch",
                    retryable=False,
                )
            config.model_revision = revision
            self.revision = revision
            version = self.client.get(self.url + "/api/version")
            version.raise_for_status()
            self.server_version = version.json().get("version", "unknown")
            parsed = re.match(r"^(\d+)\.(\d+)\.(\d+)", self.server_version)
            if not parsed or tuple(map(int, parsed.groups())) < (0, 34, 0):
                raise ModelFailure(
                    "Update Ollama for explicit non-truncating context controls",
                    code="unsupported_local_version",
                    retryable=False,
                )
            info = self.client.post(self.url + "/api/show", json={"model": config.model_id})
            info.raise_for_status()
            info = info.json()
            if (
                info.get("remote_host")
                or info.get("remote_model")
                or config.model_id.endswith(":cloud")
            ):
                raise ModelFailure(
                    "Cloud-backed Ollama tags are not allowed by the local provider",
                    code="nonlocal_model",
                    retryable=False,
                )
            native_contexts = [
                v
                for k, v in info.get("model_info", {}).items()
                if k.endswith(".context_length") and isinstance(v, int)
            ]
            if native_contexts and config.context_length > max(native_contexts):
                raise ModelFailure(
                    "Configured context exceeds local model capacity",
                    code="invalid_local_context",
                    retryable=False,
                )
            self.model_metadata = {
                "digest": revision,
                "server_version": self.server_version,
                "details": match.get("details"),
                "thinking": info.get("thinking"),
            }
        except (httpx.HTTPError, ValueError) as exc:
            raise ModelFailure(
                f"Local Ollama is unavailable: {type(exc).__name__}",
                code="local_service_unavailable",
                retryable=False,
            ) from None

    def generate(self, system: str, task: str, payload: dict) -> ModelReply:
        start = time.perf_counter()
        schema = local_wire_schema(payload)
        # Server-side truncation and context shifting are disabled: never discard eligibility.
        body = {
            "model": self.config.model_id,
            "stream": False,
            "format": schema,
            "think": self.config.local_thinking,
            "truncate": False,
            "shift": False,
            "keep_alive": "30m",
            "messages": [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": task
                    + "\n"
                    + canonical(payload)
                    + "\nRequired JSON schema:\n"
                    + canonical(schema),
                },
            ],
            "options": {
                "temperature": self.config.temperature,
                "num_ctx": self.config.context_length,
                "num_predict": self.config.max_output_tokens,
            },
        }
        try:
            response = self.client.post(self.url + "/api/chat", json=body)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            retryable = status in (408, 429, 500, 502, 503, 504)
            delay = exc.response.headers.get("retry-after", "")
            retry_after = min(float(delay), 30) if re.fullmatch(r"\d+(?:\.\d+)?", delay) else None
            raise ModelFailure(
                f"Local inference returned HTTP {status}",
                code=f"local_http_{status}",
                retryable=retryable,
                retry_after=retry_after,
                halt_provider=status in (401, 403, 404),
            ) from None
        except (httpx.HTTPError, ValueError) as exc:
            raise ModelFailure(
                f"Local inference failed: {type(exc).__name__}",
                code="local_transport_error",
            ) from None
        if not data.get("done") or data.get("done_reason") != "stop":
            raise ModelFailure("Local model returned an incomplete response")
        text = (data.get("message") or {}).get("content")
        if not text:
            raise ModelFailure("Local model returned no final JSON")
        try:
            tags = self.client.get(self.url + "/api/tags")
            tags.raise_for_status()
            current = next(
                (m for m in tags.json().get("models", []) if m.get("name") == self.config.model_id),
                {},
            )
        except (httpx.HTTPError, ValueError) as exc:
            raise ModelFailure("Unable to verify local model revision after inference") from exc
        if current.get("digest") != self.revision:
            raise ModelFailure(
                "Local model revision changed during the run",
                code="model_revision_changed",
                retryable=False,
            )
        # Never retain message.thinking or other hidden reasoning.
        usage = {
            "total_input_tokens": data.get("prompt_eval_count"),
            "total_output_tokens": data.get("eval_count"),
            "local_total_duration_ns": data.get("total_duration"),
            "local_model": self.model_metadata,
            "api_cost_usd": 0.0,
        }
        return ModelReply(
            text,
            f"{self.config.model_id}@{self.revision}",
            usage,
            (time.perf_counter() - start) * 1000,
        )

    def close(self):
        self.client.close()
