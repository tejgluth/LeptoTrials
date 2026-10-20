"""Inspect finished or interrupted runs without touching them."""

import json
from collections import Counter
from pathlib import Path

from pydantic import ValidationError

from .audit import load_decisions
from .evidence import verify_evidence
from .logging_utils import digest, now, read_json, write_json
from .models import ClassificationOutput, TrialInput
from .structured_input import content_hash


def decision_fingerprint(record: dict) -> str:
    return digest({key: record[key] for key in ("input_hash", "result", "status", "error")})


def failure_kind(record: dict) -> str | None:
    if not record.get("error"):
        return None
    if record.get("failure_kind"):
        return record["failure_kind"]
    attempts = record.get("attempts", [])
    last = (attempts[-1].get("error") or {}) if attempts else {}
    return (
        "MODEL_OUTPUT_REJECTED"
        if last.get("type") == "SCHEMA_OR_EVIDENCE_FAILURE"
        else "INFERENCE_ERROR"
    )


def checked_record(path: Path, run: Path) -> tuple[dict, TrialInput]:
    record = read_json(path)
    if record["nct_id"] != path.stem or record["run_id"] != run.name:
        raise ValueError("Decision filename/run identity mismatch")
    if decision_fingerprint(record) != record["decision_hash"]:
        raise ValueError("Decision fingerprint mismatch")
    trial = TrialInput.model_validate_json((run / "inputs" / path.name).read_text())
    if trial.nct_id != record["nct_id"] or content_hash(trial) != record["input_hash"]:
        raise ValueError("Source input fingerprint mismatch")
    if record.get("result"):
        result = ClassificationOutput.model_validate_json(json.dumps(record["result"]))
        # Old outputs can disagree with the current policy without being broken.
        # Check identity, schema and quotes here and report policy warnings separately.
        verify_evidence(result, trial, semantic_support=False)
    return record, trial


def inspect_execution(output_root: Path) -> dict:
    """Summarize the decisions a run has written so far. Read-only, no API calls.

    Safe to call while the run is still writing. Unreadable or unsealed files are
    reported as such instead of being counted.
    """
    started = now()
    runs = output_root / "runs"
    if not runs.is_dir():
        raise ValueError("Expected an output directory containing runs/")
    reports, all_records, integrity, policy_warnings = [], [], [], []
    reasons, schema_violations = Counter(), Counter()
    for directory in sorted(p for p in runs.iterdir() if p.is_dir()):
        manifest_path = directory / "manifest.json"
        sealed = manifest_path.exists()
        try:
            manifest = read_json(manifest_path if sealed else directory / "started.json")
        except (OSError, ValueError) as exc:
            integrity.append(
                {
                    "run_id": directory.name,
                    "artifact": "manifest/started",
                    "error": type(exc).__name__,
                }
            )
            continue
        records, excluded = [], []
        for path in sorted((directory / "decisions").glob("*.json")):
            try:
                record, trial = checked_record(path, directory)
            except (OSError, KeyError, ValueError, TypeError) as exc:
                issue = {
                    "run_id": directory.name,
                    "artifact": str(path.relative_to(directory)),
                    "error": type(exc).__name__,
                }
                integrity.append(issue)
                excluded.append(path.stem)
                continue
            records.append(record)
            if record.get("result"):
                try:
                    verify_evidence(
                        ClassificationOutput.model_validate_json(json.dumps(record["result"])),
                        trial,
                    )
                except ValueError as exc:
                    policy_warnings.append(
                        {"run_id": directory.name, "nct_id": record["nct_id"], "message": str(exc)}
                    )
        if sealed:
            try:
                ordered = load_decisions(directory)
                if set(manifest["record_ids"]) != {r["nct_id"] for r in records}:
                    raise ValueError("Manifest and decision file sets differ")
                records = ordered
            except (OSError, KeyError, ValueError, TypeError) as exc:
                integrity.append(
                    {
                        "run_id": directory.name,
                        "artifact": "manifest integrity",
                        "error": type(exc).__name__,
                    }
                )
                records = []
        attempts = [a for r in records for a in r.get("attempts", [])]
        for attempt in attempts:
            error = attempt.get("error")
            if not error:
                continue
            reasons[(error.get("type", "unknown"), error.get("message", "unknown"))] += 1
            violations = error.get("violations", [])
            # re-check old responses in memory, the saved file stays as is
            if error.get("message") == "Output contract rejected" and not violations:
                try:
                    ClassificationOutput.model_validate_json(attempt.get("raw_output") or "")
                except ValidationError as exc:
                    violations = exc.errors(include_input=False, include_url=False)
            for violation in violations:
                schema_violations[violation.get("message", violation.get("msg", "unknown"))] += 1
        counts = Counter(r["status"] for r in records)
        source = manifest.get("source")
        planned_count = pending = None
        if (directory / "plan.json").exists():
            try:
                plan = read_json(directory / "plan.json")
                expected = set(plan["record_ids"])
                if (
                    plan["run_id"] != directory.name
                    or len(expected) != plan["count"]
                    or set(plan["input_hashes"]) != expected
                    or any(
                        plan["input_hashes"].get(r["nct_id"]) != r["input_hash"] for r in records
                    )
                ):
                    raise ValueError("Plan/source revisions do not match")
                planned_count = plan["count"]
                pending = len(expected - {r["nct_id"] for r in records})
                source = source or plan.get("source")
            except (OSError, KeyError, ValueError, TypeError) as exc:
                integrity.append(
                    {"run_id": directory.name, "artifact": "plan.json", "error": type(exc).__name__}
                )
        failures = [r["nct_id"] for r in records if r.get("error")]
        reports.append(
            {
                "run_id": directory.name,
                "sealed": sealed,
                "state": manifest.get("state", "unsealed_running_or_interrupted"),
                "dry_run": manifest.get("dry_run", False),
                "source": source,
                "round": source.get("round") if isinstance(source, dict) else None,
                "record_count": len(records),
                "planned_count": planned_count,
                "pending_count": pending,
                "status_counts": dict(counts),
                "failure_count": len(failures),
                "failure_kinds": dict(Counter(failure_kind(r) for r in records if r.get("error"))),
                "failed_nct_ids": failures,
                "review_count": sum(r.get("requires_review", False) for r in records),
                "cache_hits": sum(r.get("cached", False) for r in records),
                "attempt_count": len(attempts),
                "excluded_unreadable_nct_ids": excluded,
                "model": manifest.get("model"),
                "implementation_hash": manifest.get("implementation_hash"),
                "started_at": manifest.get("started_at"),
                "finished_at": manifest.get("finished_at"),
            }
        )
        if not manifest.get("dry_run"):
            all_records.extend(records)
    attempts = [a for r in all_records for a in r.get("attempts", [])]
    failures = sum(bool(r.get("error")) for r in all_records)
    return {
        "kind": "execution_inspection_not_expert_validation",
        "report_version": "1.1.0",
        "inspection_started_at": started,
        "inspection_finished_at": now(),
        "scope": "All runs in supplied directory, including separately identified smoke batches. "
        "A live run may advance during this non-atomic inspection.",
        "runs": reports,
        "integrity_issues": integrity,
        "current_policy_review_warnings": policy_warnings,
        "totals": {
            "record_round_decisions": len(all_records),
            "unique_nct_ids": len({r["nct_id"] for r in all_records}),
            "unique_input_revisions": len({(r["nct_id"], r["input_hash"]) for r in all_records}),
            "model_attempts": len(attempts),
            "model_failure_records": failures,
            "failure_kinds": dict(Counter(failure_kind(r) for r in all_records if r.get("error"))),
            "source_verified_result_records": sum(bool(r.get("result")) for r in all_records),
            "review_required": sum(r.get("requires_review", False) for r in all_records),
            "cache_hits": sum(r.get("cached", False) for r in all_records),
            "status_counts": dict(Counter(r["status"] for r in all_records)),
        },
        "attempt_rejection_reasons": [
            {"type": key[0], "message": key[1], "count": count}
            for key, count in reasons.most_common()
        ],
        "schema_violation_reasons": [
            {"message": reason, "count": count} for reason, count in schema_violations.most_common()
        ],
        "expert_metrics": None,
        "limitation": "Schema compliance and exact-quote checks are not clinical accuracy. "
        "Independent source-checked expert adjudications are required for FP/FN metrics. "
        "Retrospective unchanged-record subsets are not complete historical populations.",
    }


def publish_execution(report: dict, output: Path) -> None:
    markdown = output.with_suffix(".md")
    if output.exists() or markdown.exists() or markdown == output:
        raise FileExistsError("Choose a new JSON report path and unused Markdown sidecar")
    lines = [
        "# Harness execution inspection",
        "",
        report["limitation"],
        "",
        report["scope"],
        "",
        f"Observed: {report['inspection_finished_at']}",
        "",
        "| Run | State | Decisions | Model failures | Review | Cache hits |",
        "| --- | --- | ---: | ---: | ---: | ---: |",
    ]
    for run in report["runs"]:
        lines.append(
            f"| {run['run_id']} | {run['state']} | {run['record_count']} | "
            f"{run['failure_count']} | {run['review_count']} | {run['cache_hits']} |"
        )
    lines += [
        "",
        "Record-round counts can repeat the same source record; see unique revision counts.",
        "Rejected model outputs: "
        f"{report['totals'].get('failure_kinds', {}).get('MODEL_OUTPUT_REJECTED', 0)}. "
        "Inference/connection errors: "
        f"{report['totals'].get('failure_kinds', {}).get('INFERENCE_ERROR', 0)}.",
        f"Integrity/unreadable-artifact issues: {len(report['integrity_issues'])}.",
        f"Separate current-policy review warnings: "
        f"{len(report.get('current_policy_review_warnings', []))}. "
        "These do not remove or rewrite historical decisions.",
        "",
        "## Rejected attempts",
        "",
    ]
    lines += [
        f"- {item['count']}: {item['message']}" for item in report["schema_violation_reasons"]
    ]
    lines += [
        "",
        "Raw decisions remain unchanged. No expert approval or production export was made.",
    ]
    write_json(output, report)
    with markdown.open("x") as file:
        file.write("\n".join(lines) + "\n")


def prepare_retry(
    run: Path,
    output: Path,
    include_review: bool = False,
    manifest_path: Path | None = None,
    limit: int | None = None,
) -> dict:
    """Write a retry batch with just the failed inputs. Existing decisions are kept."""
    if limit is not None and limit < 1:
        raise ValueError("--limit must be positive")
    records = load_decisions(run)  # Require a sealed, integrity-checked source run.
    selected, lineage, prior, inputs = [], [], {}, []
    for record in records:
        checked, trial = checked_record(run / "decisions" / f"{record['nct_id']}.json", run)
        prior[trial.nct_id] = checked
        inputs.append(trial)
    if manifest_path:
        from .validation import load_round

        frozen, inputs, _ = load_round(manifest_path)
        expected = {trial.nct_id: content_hash(trial) for trial in inputs}
        if not set(prior) <= set(expected) or any(
            expected[nct] != row["input_hash"] for nct, row in prior.items()
        ):
            raise ValueError("Frozen manifest does not match processed source input revisions")
        source = read_json(run / "manifest.json").get("source")
        if isinstance(source, dict) and source.get("manifest_hash") not in (None, digest(frozen)):
            raise ValueError("Frozen manifest differs from the recorded round manifest")
        if (run / "plan.json").exists():
            plan = read_json(run / "plan.json")
            if (
                plan.get("run_id") != run.name
                or plan.get("count") != len(expected)
                or plan.get("record_ids") != [trial.nct_id for trial in inputs]
                or plan.get("input_hashes") != expected
            ):
                raise ValueError(
                    "Frozen manifest differs from the complete planned input revisions"
                )
    for trial in inputs:
        record = prior.get(trial.nct_id)
        if (
            record
            and not record.get("error")
            and not (include_review and record.get("requires_review"))
        ):
            continue
        selected.append(trial.model_dump(mode="json"))
        lineage.append(
            {key: record[key] for key in ("nct_id", "input_hash", "decision_hash")}
            if record
            else {
                "nct_id": trial.nct_id,
                "input_hash": content_hash(trial),
                "prior_status": "unprocessed",
            }
        )
    if not selected:
        raise ValueError("No failed/review records matched; no retry batch was created")
    matching = len(selected)
    if limit is not None:
        selected, lineage = selected[:limit], lineage[:limit]
    artifact = {
        "kind": "explicit_retry_batch_not_adjudication",
        "complete": True,
        "created_at": now(),
        "source_run_id": run.name,
        "selection": "failures_and_review" if include_review else "failures_only",
        "count": len(selected),
        "total_matching": matching,
        "sample_limit": limit,
        "includes_pending_from_frozen_manifest": manifest_path is not None,
        "is_complete_round_reproduction": False,
        "trials": selected,
        "lineage": lineage,
        "note": "Prior decisions are unchanged. Classify this file in a new run. "
        "Changed prompts/configuration invalidate old model caches.",
    }
    write_json(output, artifact)
    return {key: value for key, value in artifact.items() if key not in ("trials", "lineage")}
