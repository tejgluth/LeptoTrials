"""Re-run the frozen validation rounds. No expert labels means no accuracy number."""

import hashlib
import json
import uuid
from pathlib import Path

from .audit import load_adjudications, load_decisions
from .config import load_config
from .decision_pipeline import Pipeline
from .logging_utils import digest, read_json, write_json
from .metrics import calculate_metrics, retrieval_metrics
from .models import TrialInput
from .structured_input import content_hash


def load_round(manifest_path: Path) -> tuple[dict, list[TrialInput], list[dict]]:
    manifest = read_json(manifest_path)
    if manifest.get("state") != "ready":
        raise ValueError(
            f"{manifest_path.name}: round is {manifest.get('state')}; source data required"
        )
    inputs = manifest_path.parent / manifest["inputs"]
    if hashlib.sha256(inputs.read_bytes()).hexdigest() != manifest["inputs_sha256"]:
        raise ValueError("Frozen historical input checksum mismatch")
    data = read_json(inputs)
    rows = (
        [data["records"][key] for key in manifest["input_keys"]]
        if "input_keys" in manifest
        else data["trials"]
    )
    trials = [TrialInput.model_validate_json(json.dumps(t)) for t in rows]
    if len(trials) != len({t.nct_id for t in trials}):
        raise ValueError("Duplicate IDs in validation input")
    if manifest["candidate_ids"] != [t.nct_id for t in trials]:
        raise ValueError("Candidate manifest does not match frozen inputs")
    if not manifest.get("snapshot_date") or not manifest.get("snapshot_source"):
        raise ValueError("Historical rounds require timestamp and source provenance")
    truth = []
    if manifest.get("adjudications"):
        experts = load_adjudications(manifest_path.parent / manifest["adjudications"])
        hashes = {t.nct_id: content_hash(t) for t in trials}
        for expert in experts:
            if expert.input_hash != hashes[expert.nct_id]:
                raise ValueError("Historical reference is for a different input revision")
        truth = [e.model_dump(mode="json") for e in experts]
    return manifest, trials, truth


def validate_round(
    manifest_path: Path,
    config,
    output: Path,
    *,
    dry_run=False,
    force_model=False,
    use_cache=True,
    client=None,
    workers=1,
) -> dict:
    manifest, trials, truth = load_round(manifest_path)
    source = {
        "validation_manifest": str(manifest_path),
        "manifest_hash": digest(manifest),
        "round": manifest["round_id"],
        "role": manifest.get("role", "unspecified"),
    }
    pipeline = Pipeline(
        config,
        output,
        dry_run=dry_run,
        force_model=force_model,
        use_cache=use_cache,
        client=client,
        source=source,
    )
    try:
        pipeline.classify_many(trials, workers)
        run = pipeline.finish()
        result = {
            "round": manifest["round_id"],
            "role": manifest.get("role"),
            "run": run,
            "validation_state": "dry_run"
            if dry_run
            else "expert_adjudicated"
            if truth
            else "classifications_only_awaiting_expert_adjudication",
            "metrics": calculate_metrics(pipeline.records, truth)
            if truth and not dry_run
            else None,
            "retrieval_metrics": retrieval_metrics(
                manifest["candidate_ids"], manifest["reference_inclusive_ids"]
            )
            if "reference_inclusive_ids" in manifest
            else None,
        }
        write_json(pipeline.run_dir / "validation.json", result)
        return result
    except (Exception, KeyboardInterrupt) as exc:
        if not (pipeline.run_dir / "manifest.json").exists():
            pipeline.finish(error=type(exc).__name__)
        raise
    finally:
        pipeline.close()


def validate_all(directory: Path, config, output: Path, *, dry_run=False, workers=1) -> dict:
    results, unavailable, records, truth = [], [], [], []
    provider_halt = None
    for path in sorted(directory.glob("round_*.json")):
        manifest = read_json(path)
        if provider_halt:
            unavailable.append(
                {"manifest": str(path), "state": "blocked_provider", "error_code": provider_halt}
            )
            continue
        if manifest.get("state") != "ready":
            unavailable.append({"manifest": str(path), "state": manifest.get("state")})
            continue
        result = validate_round(path, config, output, dry_run=dry_run, workers=workers)
        results.append(result)
        provider_halt = result["run"].get("terminal_provider_error")
        if result["metrics"]:
            _, _, round_truth = load_round(path)
            round_records = load_decisions(output / "runs" / result["run"]["run_id"])
            # the same trial can show up in several rounds, so key by round
            for row in round_records:
                records.append({**row, "nct_id": path.stem + ":" + row["nct_id"]})
            truth.extend({**row, "nct_id": path.stem + ":" + row["nct_id"]} for row in round_truth)
    summary = {
        "rounds": results,
        "unavailable_rounds": unavailable,
        "complete": bool(results) and not unavailable,
        "expert_validation_complete": bool(results)
        and not unavailable
        and all(r["metrics"] is not None for r in results),
        "aggregate_metrics": calculate_metrics(records, truth) if records else None,
        "aggregate_note": "Repeated NCT records count once per round; inspect role before pooling.",
    }
    write_json(output / "validation" / f"aggregate_{uuid.uuid4().hex}.json", summary)
    return summary


def compare_models(
    manifest: Path, config, output: Path, models: list[str], dry_run=False, workers=1
) -> dict:
    variants = []
    for model in models:
        variant = config.model_copy(deep=True)
        parts = model.split(":", 1)
        if len(parts) == 2 and parts[0] in (
            "google",
            "openai",
            "anthropic",
            "openai-compatible",
            "ollama",
        ):
            if variant.model.provider != parts[0]:
                # don't carry one provider's endpoint/key/pricing over to another (use --configs)
                variant.model.base_url = None
                variant.model.api_key_env = None
                variant.model.model_revision = None
                variant.model.input_usd_per_million = None
                variant.model.output_usd_per_million = None
            variant.model.provider, variant.model.model_id = parts
        else:
            variant.model.model_id = model
        variant = type(config).model_validate(variant.model_dump())
        variants.append((model, variant))
    return compare_variants(manifest, output, variants, dry_run, workers)


def compare_configurations(
    manifest: Path, output: Path, configs: list[Path], dry_run=False, workers=1
) -> dict:
    return compare_variants(
        manifest, output, [(str(path), load_config(path)) for path in configs], dry_run, workers
    )


def compare_variants(
    manifest: Path, output: Path, variants: list, dry_run=False, workers=1
) -> dict:
    if not variants:
        raise ValueError("At least one model/configuration is required")
    rows = []
    for label, variant in variants:
        # force stage 2 so the comparison is actually about the models
        result = validate_round(
            manifest,
            variant,
            output,
            force_model=True,
            use_cache=False,
            dry_run=dry_run,
            workers=workers,
        )
        rows.append(
            {
                "configuration": label,
                "model": variant.model.model_id,
                "provider": variant.model.provider,
                "settings": variant.model.model_dump(),
                "metrics": result["metrics"],
                "performance": result["run"]["performance"],
                "run_id": result["run"]["run_id"],
                "state": result["run"]["state"],
            }
        )
    report = {
        "kind": "model_comparison",
        "manifest": str(manifest),
        "results": rows,
        "note": "Matched inputs, forced Stage 2, no cache. Without independent expert "
        "adjudications this compares execution, not clinical accuracy.",
    }
    write_json(output / "comparisons" / f"{uuid.uuid4().hex}.json", report)
    return report
