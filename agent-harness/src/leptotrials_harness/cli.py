"""Local commands used identically by a researcher, cron, or a scheduled ChatGPT task."""

import argparse
import json
import os
import re
import sys
from datetime import date
from pathlib import Path

from .aact import import_aact
from .audit import adjudicate, create_audit_batch, review_packet
from .candidate_search import fetch_candidates
from .clinicaltrials_api import RegistryClient
from .config import RESOURCES, load_config
from .decision_pipeline import Pipeline
from .execution import inspect_execution, prepare_retry, publish_execution
from .export import export_approved
from .historical import capture_unchanged_round, import_snapshot
from .local_contract import ReferenceOutput
from .logging_utils import new_run_id, read_json, write_json
from .models import Adjudication, ClassificationOutput, TrialInput
from .reconciliation import reconcile_production
from .trial_normalizer import normalize
from .validation import compare_configurations, compare_models, validate_all, validate_round


def safe_round(value: str) -> str:
    if not re.fullmatch(r"round_\d{2}", value):
        raise argparse.ArgumentTypeError("Use round_01 through round_99")
    return value


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        description="Auditable registry-level LM classification; no deployment"
    )
    root.add_argument("--config", type=Path, help="Override default YAML settings")
    root.add_argument(
        "--output-root", type=Path, help="Run/cache/adjudication directory (default output)"
    )
    commands = root.add_subparsers(dest="command", required=True)
    single = commands.add_parser("classify", help="Fetch one NCT from API v2 and classify")
    single.add_argument("nct_id")
    batch = commands.add_parser(
        "run-batch", help="Classify frozen normalized inputs or API-v2 studies"
    )
    batch.add_argument("input", type=Path)
    maintain = commands.add_parser(
        "maintain", help="Fetch candidates, classify changed records, emit review packet"
    )
    fetch = commands.add_parser(
        "fetch-candidates", help="Complementary, sensitive discovery; follow every page"
    )
    for p in (fetch, maintain):
        p.add_argument(
            "--status", action="append", help="Registry status, repeatable; recruiting accepted"
        )
        p.add_argument("--all-statuses", action="store_true")
    fetch.add_argument("--output", type=Path, default=Path("candidates.json"))
    for p in (single, batch, maintain):
        p.add_argument(
            "--dry-run", action="store_true", help="Prepare exact inputs without model calls"
        )
        p.add_argument("--no-cache", action="store_true")
        p.add_argument("--workers", type=int, default=1, help="Concurrent requests (1–32)")
    validation = commands.add_parser("validate", help="Evaluate a frozen timestamped round")
    validation.add_argument("manifest", type=Path)
    all_rounds = commands.add_parser("validate-all", help="Round-by-round and aggregate evaluation")
    all_rounds.add_argument("--manifests", type=Path, default=Path("validation/manifests"))
    comparison = commands.add_parser(
        "compare-models", help="Compare supplied model IDs on identical inputs"
    )
    comparison.add_argument("--manifest", type=Path, required=True)
    variants = comparison.add_mutually_exclusive_group(required=True)
    variants.add_argument("--models", nargs="+", help="Explicit provider:model IDs")
    variants.add_argument(
        "--configs", type=Path, nargs="+", help="Complete provider/model configurations"
    )
    for p in (validation, all_rounds, comparison):
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--workers", type=int, default=1)
    review = commands.add_parser(
        "review", help="Write concise source-linked expert review Markdown"
    )
    review.add_argument("run", type=Path)
    review.add_argument("--output", type=Path, required=True)
    audit = commands.add_parser(
        "create-audit-batch", help="Export all recent decisions for periodic audit"
    )
    audit.add_argument("--since", type=date.fromisoformat, required=True)
    audit.add_argument("--output", type=Path, required=True)
    expert = commands.add_parser("adjudicate", help="Validate and append separate expert decisions")
    expert.add_argument("run", type=Path)
    expert.add_argument("adjudications", type=Path)
    export = commands.add_parser(
        "export-approved", help="Create review-only overrides; never overwrite source"
    )
    export.add_argument("--run", type=Path, required=True)
    export.add_argument("--adjudications", type=Path, required=True)
    export.add_argument("--format", choices=["json", "typescript"], default="json")
    export.add_argument("--output", type=Path, default=Path("output/approved-classifications.json"))
    export.add_argument(
        "--app-root", type=Path, help="App repository root for TypeScript type imports"
    )
    schemas = commands.add_parser("schemas", help="Generate public JSON schema contracts")
    schemas.add_argument("--check", action="store_true")
    inspection = commands.add_parser(
        "execution-report", help="Inspect saved/active runs without API calls or accuracy claims"
    )
    inspection.add_argument("directory", type=Path, help="Output directory containing runs/")
    inspection.add_argument("--output", type=Path, help="New JSON report plus Markdown sidecar")
    parity = commands.add_parser(
        "reconcile-production", help="Compare an exact live baseline with independent results"
    )
    parity.add_argument("--baseline", type=Path, required=True)
    parity.add_argument("--candidates", type=Path, required=True)
    parity.add_argument("--run", type=Path, required=True)
    parity.add_argument("--output", type=Path)
    retry = commands.add_parser(
        "prepare-retry", help="Freeze failed decisions into an explicit retry batch"
    )
    retry.add_argument("run", type=Path, help="Sealed source run directory")
    retry.add_argument("--output", type=Path, required=True)
    retry.add_argument(
        "--include-review", action="store_true", help="Also select valid review decisions"
    )
    retry.add_argument("--manifest", type=Path, help="Frozen round; also select unprocessed IDs")
    retry.add_argument("--limit", type=int, help="Bounded development sample, not a full rerun")
    historical = commands.add_parser(
        "fetch-historical", help="New retrospective unchanged-record subsets; NOT full snapshots"
    )
    historical.add_argument("--dates", type=date.fromisoformat, nargs="+", required=True)
    historical.add_argument("--destination", type=Path, required=True)
    aact = commands.add_parser(
        "import-aact", help="Import a true dated AACT flat-file ZIP or folder"
    )
    aact.add_argument("source", type=Path)
    aact.add_argument("--date", type=date.fromisoformat, required=True)
    aact.add_argument("--round", type=safe_round, required=True)
    aact.add_argument("--destination", type=Path, required=True)
    aact.add_argument(
        "--provenance", required=True, help="Archive page/download URL and source date"
    )
    snapshot = commands.add_parser(
        "import-snapshot", help="Import actual archived as-of API-v2 records"
    )
    snapshot.add_argument("source", type=Path)
    snapshot.add_argument("--date", type=date.fromisoformat, required=True)
    snapshot.add_argument("--round", type=safe_round, required=True)
    snapshot.add_argument("--destination", type=Path, required=True)
    snapshot.add_argument("--provenance", required=True)
    snapshot.add_argument(
        "--role", choices=["development", "final_evaluation", "unspecified"], default="unspecified"
    )
    return root


def run_trials(args, config, output, trials: list[TrialInput], source) -> dict:
    if len(trials) != len({t.nct_id for t in trials}):
        raise ValueError("Duplicate NCT IDs in batch; refusing ambiguous run")
    pipeline = Pipeline(
        config, output, dry_run=args.dry_run, use_cache=not args.no_cache, source=source
    )
    try:
        pipeline.classify_many(trials, args.workers)
        manifest = pipeline.finish(source=source)
        review_packet(pipeline.run_dir, pipeline.run_dir / "review.md")
        return manifest
    except (Exception, KeyboardInterrupt) as exc:
        if not (pipeline.run_dir / "manifest.json").exists():
            pipeline.finish(source=source, error=type(exc).__name__)
        raise
    finally:
        pipeline.close()


def execute(args) -> dict:
    config = load_config(args.config)
    output = args.output_root or Path(os.getenv("LEPTOTRIALS_OUTPUT", "output"))
    command = args.command
    if command == "reconcile-production":
        report = reconcile_production(args.baseline, args.candidates, args.run)
        if args.output:
            write_json(args.output, report)
        return report
    if command == "execution-report":
        report = inspect_execution(args.directory)
        if args.output:
            publish_execution(report, args.output)
        return report
    if command == "prepare-retry":
        return prepare_retry(args.run, args.output, args.include_review, args.manifest, args.limit)
    if command == "import-aact":
        return import_aact(
            args.source,
            args.date,
            args.round,
            args.destination,
            args.provenance,
            progress=lambda item: print(json.dumps(item), file=sys.stderr, flush=True),
        )
    if command == "schemas":
        for name, model in [
            ("trial_input", TrialInput),
            ("classification_output", ClassificationOutput),
            ("adjudication", Adjudication),
            ("ollama_reference_output", ReferenceOutput),
        ]:
            path = RESOURCES / "schemas" / f"{name}.schema.json"
            schema = model.model_json_schema()
            if args.check:
                if read_json(path) != schema:
                    raise ValueError(f"Schema drift: regenerate {name}")
            else:
                # Generated schema is a bulk mechanical rewrite, not a run artifact.
                path.write_text(json.dumps(schema, indent=2) + "\n")
        return {"schemas": "checked" if args.check else "generated"}
    if command in ("classify", "fetch-candidates", "maintain", "fetch-historical"):
        registry = RegistryClient(config.registry)
        try:
            if command == "classify":
                raw = registry.study(args.nct_id)
                return run_trials(args, config, output, [normalize(raw)], {"registry": args.nct_id})
            if command == "fetch-historical":
                results = []
                for i, cutoff in enumerate(args.dates, 1):
                    results.append(
                        capture_unchanged_round(
                            registry, cutoff, f"round_{i:02d}", args.destination
                        )
                    )
                return {"rounds": results, "kind": "retrospective_unchanged_subsets"}
            statuses = (
                []
                if args.all_statuses
                else [s.upper().replace("-", "_") for s in args.status]
                if args.status
                else config.registry.statuses
            )
            candidates = fetch_candidates(registry, statuses)
            if command == "fetch-candidates":
                write_json(args.output, candidates)
                return {"output": str(args.output), "count": candidates["count"], "complete": True}
            capture = output / "candidates" / f"{new_run_id()}.json"
            write_json(capture, candidates)
            return run_trials(
                args,
                config,
                output,
                [TrialInput.model_validate_json(json.dumps(t)) for t in candidates["trials"]],
                {"candidate_capture": str(capture)},
            )
        except Exception as exc:
            write_json(
                output / "failures" / f"{new_run_id()}.json",
                {"command": command, "complete": False, "error_type": type(exc).__name__},
            )
            raise
        finally:
            registry.close()
    if command == "run-batch":
        data = read_json(args.input)
        if data.get("complete") is False:
            raise ValueError("Candidate retrieval is incomplete")
        trials = (
            [TrialInput.model_validate_json(json.dumps(t)) for t in data["trials"]]
            if "trials" in data
            else [normalize(s) for s in data["studies"]]
        )
        return run_trials(args, config, output, trials, {"file": str(args.input)})
    if command == "validate":
        return validate_round(
            args.manifest, config, output, dry_run=args.dry_run, workers=args.workers
        )
    if command == "validate-all":
        return validate_all(
            args.manifests, config, output, dry_run=args.dry_run, workers=args.workers
        )
    if command == "compare-models":
        if args.configs:
            return compare_configurations(
                args.manifest, output, args.configs, args.dry_run, args.workers
            )
        return compare_models(
            args.manifest, config, output, args.models, args.dry_run, args.workers
        )
    if command == "import-snapshot":
        return import_snapshot(
            args.source, args.date, args.round, args.destination, args.provenance, args.role
        )
    if command == "review":
        review_packet(args.run, args.output)
        return {"output": str(args.output)}
    if command == "create-audit-batch":
        return {"count": create_audit_batch(output, args.since.isoformat(), args.output)}
    if command == "adjudicate":
        return {"adjudications": adjudicate(args.run, args.adjudications, output / "adjudications")}
    if command == "export-approved":
        return export_approved(
            args.run, args.adjudications, args.output, args.format, args.app_root
        )
    raise ValueError("Unsupported command")


def main():
    args = parser().parse_args()
    try:
        result = execute(args)
        display = result
        if args.command == "fetch-historical":
            display = {
                "kind": result["kind"],
                "rounds": [
                    {
                        "round": r["round_id"],
                        "date": r["snapshot_date"],
                        "count": len(r["candidate_ids"]),
                    }
                    for r in result["rounds"]
                ],
            }
        elif args.command == "validate-all":
            display = {
                **result,
                "rounds": [
                    {
                        "round": r["round"],
                        "run_id": r["run"]["run_id"],
                        "state": r["validation_state"],
                        "count": r["run"]["count"],
                        "performance": r["run"]["performance"],
                        "metrics": r["metrics"],
                    }
                    for r in result["rounds"]
                ],
            }
        elif "prompts" in result:
            display = {k: v for k, v in result.items() if k not in ("prompts", "record_ids")}
        elif isinstance(result.get("run"), dict):
            display = {
                **result,
                "run": {
                    k: v for k, v in result["run"].items() if k not in ("prompts", "record_ids")
                },
            }
        print(json.dumps(display, indent=2))
        failed = result.get("state") == "failed" or result.get("complete") is False
        if isinstance(result.get("run"), dict):
            failed |= result["run"]["state"] == "failed"
        if args.command == "validate-all":
            failed |= any(r["run"]["state"] == "failed" for r in result["rounds"])
        if args.command == "compare-models":
            failed |= any(r["state"] == "failed" for r in result["results"])
        if failed:
            sys.exit(2)
    except (ValueError, KeyError, TypeError, OSError, RuntimeError) as exc:
        # Do not print arbitrary SDK exception text or response payloads.
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        sys.exit(2)
