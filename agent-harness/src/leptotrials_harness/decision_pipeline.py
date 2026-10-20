"""Two-stage orchestration, immutable per-run decisions, cache and provenance."""

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .agent_classifier import classify_agent
from .config import RESOURCES, Config
from .evidence import has_plain_lm_exclusion, scope_is_source_named, verify_evidence
from .gemini_client import ModelFailure
from .logging_utils import digest, git_state, new_run_id, now, read_json, write_json
from .model_client import create_model_client
from .models import (
    INPUT_SCHEMA_VERSION,
    SCHEMA_VERSION,
    UNRESOLVED,
    ClassificationOutput,
    TrialInput,
)
from .strict_classifier import RULE_VERSION, classify_strict
from .structured_input import content_hash, model_payload, prompts
from .trial_normalizer import extract_signals


def implementation_hash() -> str:
    return digest({p.name: p.read_text() for p in sorted(Path(__file__).parent.glob("*.py"))})


def classification_cache_key(
    trial: TrialInput,
    config: Config,
    code_hash: str,
    force_model: bool = False,
    *,
    prompt: dict | None = None,
) -> str:
    return digest(
        {
            "input": content_hash(trial),
            "model": config.model.model_dump(),
            "prompt": prompt if prompt is not None else prompts(),
            "schema": ClassificationOutput.model_json_schema(),
            "rules": RULE_VERSION,
            "implementation": code_hash,
            "terminology": (RESOURCES / "config/terminology.yaml").read_text(),
            "force_model": force_model,
        }
    )


class Pipeline:
    def __init__(
        self,
        config: Config,
        output: Path,
        *,
        dry_run=False,
        use_cache=True,
        client=None,
        force_model=False,
        source=None,
    ):
        self.config, self.output = config, output
        # Snapshot once: editing the prompt registry must not change later records,
        # retries, cache provenance or the final manifest of an already-running batch.
        self.prompt = prompts()
        self.dry_run, self.use_cache, self.force_model = dry_run, use_cache, force_model
        self.client = client
        self.source = source
        if config.model.provider == "ollama" and not dry_run and client is None:
            # Resolve local tag to immutable digest before constructing a cache key.
            self.client = create_model_client(config.model)
        self.client_lock = threading.Lock()
        self.provider_halt = None
        self.run_id = new_run_id()
        self.run_dir = output / "runs" / self.run_id
        self.started_at, self.start = now(), time.perf_counter()
        self.code_hash = implementation_hash()
        self.records = []
        self.input_versions = set()
        write_json(
            self.run_dir / "started.json",
            {
                "run_id": self.run_id,
                "started_at": self.started_at,
                "implementation_hash": self.code_hash,
                "model": self.config.model.model_dump(),
                "dry_run": self.dry_run,
                "source": source,
            },
        )

    def classify(self, trial: TrialInput) -> dict:
        started = time.perf_counter()
        self.input_versions.add(trial.input_schema_version)
        trial.deterministic_signals = extract_signals(trial)
        input_hash = content_hash(trial)
        prompt = self.prompt
        cache_key = classification_cache_key(
            trial, self.config, self.code_hash, self.force_model, prompt=prompt
        )
        record = {
            "run_id": self.run_id,
            "timestamp": now(),
            "nct_id": trial.nct_id,
            "title": trial.brief_title,
            "input_hash": input_hash,
            "input_schema_version": trial.input_schema_version,
            "output_schema_version": SCHEMA_VERSION,
            "cache_key": cache_key,
            "pipeline_stage": "strict_rule",
            "strict_rule_result": None,
            "model_called": False,
            "model_id": self.config.model.model_id,
            "model_provider": self.config.model.provider,
            "prompt_version": prompt["version"],
            "result": None,
            "attempts": [],
            "requires_review": False,
            "latency_ms": 0.0,
            "usage": [],
            "error": None,
            "cached": False,
            "source_url": f"https://clinicaltrials.gov/study/{trial.nct_id}",
        }
        write_json(self.run_dir / "inputs" / f"{trial.nct_id}.json", trial.model_dump(mode="json"))
        strict = None if self.force_model else classify_strict(trial)
        if strict:
            rule, result = strict
            verify_evidence(result, trial)
            record.update(
                strict_rule_result=rule,
                result=result.model_dump(mode="json"),
                status="AUTO_ACCEPTED_STRICT",
            )
        else:
            record["pipeline_stage"] = "agent"
            payload = model_payload(
                trial,
                self.config.model.model_id,
                prompt=prompt,
                provider=self.config.model.provider,
            )
            record["model_input_hash"] = digest(payload)
            record["input_projection_version"] = payload["input_projection"]["version"]
            record["model_output_transport"] = payload.get("output_transport", {}).get(
                "wire_schema_version", "canonical_classification_json"
            )
            write_json(self.run_dir / "model_inputs" / f"{trial.nct_id}.json", payload)
            cache_file = self.output / "cache" / f"{cache_key}.json"
            if self.dry_run:
                record.update(status="DRY_RUN_STAGE_2", requires_review=True)
            else:
                cached = read_json(cache_file) if self.use_cache and cache_file.exists() else None
                if cached:
                    result = ClassificationOutput.model_validate_json(json.dumps(cached["result"]))
                    verify_evidence(result, trial)
                    record.update(
                        result=result.model_dump(mode="json"),
                        cached=True,
                        cache_source_run_id=cached["run_id"],
                    )
                else:
                    try:
                        with self.client_lock:
                            if self.provider_halt:
                                raise ModelFailure(
                                    "Run halted after terminal provider error",
                                    code=self.provider_halt,
                                    retryable=False,
                                )
                            if self.client is None:
                                self.client = create_model_client(self.config.model)
                        record["model_called"] = True
                        record.update(classify_agent(trial, self.client, prompt=prompt))
                        if record.get("terminal_provider_error"):
                            with self.client_lock:
                                self.provider_halt = record["terminal_provider_error"]
                    except ModelFailure as exc:
                        if exc.halt_provider:
                            with self.client_lock:
                                self.provider_halt = exc.code or "non_retryable_provider_error"
                        record.update(
                            error="MODEL_FAILURE",
                            failure_detail=str(exc),
                            terminal_provider_error=exc.code if exc.halt_provider else None,
                            failure_kind="INFERENCE_ERROR",
                        )
                result = record["result"]
                unscoped_conflict = bool(
                    result
                    and result["conflicting_evidence"]
                    and any(
                        not scope_is_source_named(e["cohort"], trial)
                        for e in result["conflicting_evidence"] + result["evidence"]
                    )
                )
                needs_review = not result or result["requires_human_review"] or unscoped_conflict
                if (
                    result
                    and result["is_lm_inclusive"] is True
                    and has_plain_lm_exclusion(trial)
                    and not result["conflicting_evidence"]
                ):
                    needs_review = True
                    record["safety_review_reason"] = (
                        "Source contains LM exclusion not addressed as conflicting evidence"
                    )
                if result and result["classification"] == "LM_INCLUSIVE_COHORT_SPECIFIC":
                    clinical = trial.model_dump(mode="json")
                    for key in ("deterministic_signals", "candidate_retrieval_reasons"):
                        clinical.pop(key)
                    source_text = json.dumps(clinical, ensure_ascii=False).casefold()
                    placeholders = {
                        "n/a",
                        "na",
                        "none",
                        "null",
                        "unspecified",
                        "not applicable",
                        "all",
                        "all patients",
                        "study-wide",
                        "whole study",
                    }
                    identifiable = any(
                        e["direction"] == "inclusion"
                        and e["cohort"]
                        and e["cohort"].strip().casefold() not in placeholders
                        and e["cohort"].strip().casefold() in source_text
                        for e in result["evidence"]
                    )
                    if not identifiable:
                        needs_review = True
                        record["safety_review_reason"] = (
                            "Cohort-specific proposal lacks an identifiable source-defined cohort"
                        )
                record.update(
                    status="REQUIRES_EXPERT_REVIEW" if needs_review else "MODEL_CLASSIFIED",
                    requires_review=bool(needs_review),
                )
                if result and not record["cached"] and self.use_cache and not cache_file.exists():
                    write_json(cache_file, {"run_id": self.run_id, "result": result})
        record["classification"] = (record["result"] or {}).get("classification")
        record["processing_ms"] = (time.perf_counter() - started) * 1000
        record["decision_hash"] = digest(
            {
                "input_hash": input_hash,
                "result": record["result"],
                "status": record["status"],
                "error": record["error"],
            }
        )
        write_json(self.run_dir / "decisions" / f"{trial.nct_id}.json", record)
        # Minimal machine-readable event logs deliberately exclude full registry text.
        self.run_dir.mkdir(parents=True, exist_ok=True)
        with (self.run_dir / "events.jsonl").open("a") as file:
            from .logging_utils import canonical

            file.write(
                canonical({k: v for k, v in record.items() if k not in ("result", "attempts")})
                + "\n"
            )
        self.records.append(record)
        return record

    def classify_many(self, trials: list[TrialInput], workers: int = 1) -> list[dict]:
        if len({t.nct_id for t in trials}) != len(trials):
            raise ValueError("Duplicate NCT IDs in batch")
        if workers < 1 or workers > 32:
            raise ValueError("workers must be between 1 and 32")
        write_json(
            self.run_dir / "plan.json",
            {
                "run_id": self.run_id,
                "count": len(trials),
                "record_ids": [t.nct_id for t in trials],
                "input_hashes": {t.nct_id: content_hash(t) for t in trials},
                "source": self.source,
            },
        )
        if workers == 1:
            rows = [self.classify(t) for t in trials]
        else:
            with ThreadPoolExecutor(max_workers=workers) as executor:
                rows = list(executor.map(self.classify, trials))
        self.records = rows
        return rows

    def finish(self, *, source=None, error=None) -> dict:
        manifest = {
            "run_id": self.run_id,
            "started_at": self.started_at,
            "finished_at": now(),
            "git": git_state(),
            "implementation_hash": self.code_hash,
            "model": self.config.model.model_dump(),
            "prompts": self.prompt,
            "prompt_hash": digest(self.prompt),
            "input_schema_version": next(iter(self.input_versions))
            if len(self.input_versions) == 1
            else "mixed"
            if self.input_versions
            else INPUT_SCHEMA_VERSION,
            "input_schema_versions": sorted(self.input_versions),
            "output_schema_version": SCHEMA_VERSION,
            "strict_rule_version": RULE_VERSION,
            "dry_run": self.dry_run,
            "force_model": self.force_model,
            "source": source if source is not None else self.source,
            "count": len(self.records),
            "record_ids": [r["nct_id"] for r in self.records],
            "state": "failed"
            if error or any(r["error"] for r in self.records)
            else "dry_run"
            if self.dry_run
            else "completed",
            "error": error,
            "terminal_provider_error": self.provider_halt,
            "elapsed_ms": (time.perf_counter() - self.start) * 1000,
            "performance": run_performance(self.records, self.config),
            "records_hash": digest(self.records),
        }
        write_json(self.run_dir / "manifest.json", manifest)
        return manifest

    def close(self):
        if self.client:
            self.client.close()


def run_performance(records: list[dict], config: Config) -> dict:
    calls = [a for r in records for a in r["attempts"]]
    tokens_in = sum(a.get("usage", {}).get("total_input_tokens", 0) or 0 for a in calls)
    tokens_out = sum(a.get("usage", {}).get("total_output_tokens", 0) or 0 for a in calls)
    input_complete = all(
        isinstance(a.get("usage", {}).get("total_input_tokens"), (int, float)) for a in calls
    )
    output_complete = all(
        isinstance(a.get("usage", {}).get("total_output_tokens"), (int, float)) for a in calls
    )
    cost = None
    m = config.model
    if calls and m.input_usd_per_million is not None and m.output_usd_per_million is not None:
        if input_complete and output_complete:
            cost = (
                tokens_in * m.input_usd_per_million + tokens_out * m.output_usd_per_million
            ) / 1e6
    return {
        "strict_count": sum(r["status"] == "AUTO_ACCEPTED_STRICT" for r in records),
        "stage_2_count": sum(r["pipeline_stage"] == "agent" for r in records),
        "model_calls": len(calls),
        "cache_hits": sum(r["cached"] for r in records),
        "model_inclusive": sum(
            r["pipeline_stage"] == "agent" and (r["result"] or {}).get("is_lm_inclusive") is True
            for r in records
        ),
        "model_rejected": sum(
            r["pipeline_stage"] == "agent" and (r["result"] or {}).get("is_lm_inclusive") is False
            for r in records
        ),
        "human_review_count": sum(r["requires_review"] for r in records),
        "mean_model_latency_ms": sum(a.get("latency_ms", 0) for a in calls) / len(calls)
        if calls
        else None,
        "input_tokens": tokens_in if calls and input_complete else None,
        "output_tokens": tokens_out if calls and output_complete else None,
        "observed_input_tokens": tokens_in,
        "observed_output_tokens": tokens_out,
        "token_usage_complete": bool(calls and input_complete and output_complete),
        "estimated_cost_usd": cost,
        "schema_failures": sum(
            (a["error"] or {}).get("type") == "SCHEMA_OR_EVIDENCE_FAILURE" for a in calls
        ),
        "api_model_failures": sum(
            (a["error"] or {}).get("type") == "API_MODEL_FAILURE" for a in calls
        ),
        "unresolved": sum((r["result"] or {}).get("classification") in UNRESOLVED for r in records),
    }
