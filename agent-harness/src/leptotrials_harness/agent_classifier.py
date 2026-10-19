"""Bounded model attempts; retain raw final JSON and explicit rejection diagnostics."""

import time

from pydantic import ValidationError

from .evidence import EvidenceError, verify_evidence
from .gemini_client import ModelFailure
from .local_contract import LOCAL_WIRE_VERSION, resolve_local_output
from .model_client import ModelClient
from .models import ClassificationOutput, TrialInput
from .source_passages import rejection_hints
from .structured_input import model_payload, prompts


def classify_agent(trial: TrialInput, client: ModelClient, *, prompt: dict | None = None) -> dict:
    prompt = prompt if prompt is not None else prompts()
    attempts, usage = [], []
    start = time.perf_counter()
    feedback = None
    terminal_error = None
    for index in range(client.config.max_attempts):
        attempt_start = time.perf_counter()
        attempt = {
            "attempt": index + 1,
            "raw_output": None,
            "error": None,
            "usage": {},
            "validation_feedback": feedback,
        }
        try:
            payload = model_payload(
                trial, client.config.model_id, prompt=prompt, provider=client.config.provider
            )
            if feedback:
                payload["validation_feedback"] = feedback
            reply = client.generate(prompt["system"], prompt["task"], payload)
            attempt.update(
                raw_output=reply.text,
                usage=reply.usage,
                response_model=reply.model_version,
                latency_ms=reply.latency_ms,
            )
            usage.append(reply.usage)
            result = (
                resolve_local_output(reply.text, payload)
                if client.config.provider == "ollama"
                else ClassificationOutput.model_validate_json(reply.text)
            )
            if (result.model_version, result.prompt_version) != (
                client.config.model_id,
                prompt["version"],
            ):
                raise EvidenceError("Output provenance does not match request")
            verify_evidence(result, trial)
            attempts.append(attempt)
            return {
                "result": result.model_dump(mode="json"),
                "attempts": attempts,
                "usage": usage,
                "latency_ms": (time.perf_counter() - start) * 1000,
                "model_output_transport": LOCAL_WIRE_VERSION
                if client.config.provider == "ollama"
                else "canonical_classification_json",
            }
        except (ValidationError, EvidenceError) as exc:
            attempt["error"] = {
                "type": "SCHEMA_OR_EVIDENCE_FAILURE",
                "class": type(exc).__name__,
                "message": str(exc)
                if isinstance(exc, EvidenceError)
                else "Output contract rejected",
            }
            if isinstance(exc, ValidationError):
                # Send actionable contract failures, not the rejected response/input or
                # Pydantic context (which can include arbitrary source text/objects).
                attempt["error"]["violations"] = [
                    {
                        "field": ".".join(str(part) for part in item["loc"]) or "$",
                        "type": item["type"],
                        "message": item["msg"],
                    }
                    for item in exc.errors(include_input=False, include_url=False)[:12]
                ]
        except ModelFailure as exc:
            attempt["error"] = {
                "type": "API_MODEL_FAILURE",
                "message": str(exc),
                "code": exc.code,
                "retryable": exc.retryable,
                "retry_after": exc.retry_after,
            }
            if not exc.retryable:
                terminal_error = exc.code or "non_retryable_provider_error"
        attempts.append(attempt)
        attempt["latency_ms"] = (time.perf_counter() - attempt_start) * 1000
        feedback = {
            "previous_attempt_rejected": True,
            "error": attempt["error"],
            "instruction": "Return corrected complete JSON. Fix the listed contract violations. "
            "Unresolved labels require is_lm_inclusive=null and requires_human_review=true. "
            "Keep quotes verbatim, without ellipses, paraphrasing or joined list entries. "
            "String arrays may be cited by field name; do not guess array indices. "
            "Never invent a named cohort merely to satisfy validation; use ambiguity if unclear.",
            "verbatim_copying_aids_not_classification_evidence": rejection_hints(
                attempt["raw_output"], trial
            ),
        }
        if terminal_error:
            break
        if index + 1 < client.config.max_attempts:
            delay = (attempt["error"] or {}).get("retry_after") or 2**index
            time.sleep(min(max(delay, 2**index), 30))
    return {
        "result": None,
        "attempts": attempts,
        "usage": usage,
        "latency_ms": (time.perf_counter() - start) * 1000,
        "error": "MODEL_FAILURE",
        "terminal_provider_error": terminal_error,
    }
