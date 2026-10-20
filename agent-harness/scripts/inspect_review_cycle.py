"""Summarize a finished offline review cycle."""

import json
import sys
from pathlib import Path

from leptotrials_harness.execution import inspect_execution, publish_execution
from leptotrials_harness.logging_utils import read_json, write_json
from leptotrials_harness.reconciliation import reconcile_production


def inspect_job(job: Path) -> dict:
    output = job / "harness-output"
    inspection = inspect_execution(output)
    publish_execution(inspection, job / "execution-inspection.json")
    comparisons = []
    expected_rounds = {p.stem for p in (job / "selected-inputs/manifests").glob("round_*.json")}
    observed_rounds = {r["round"] for r in inspection["runs"]}
    unstarted = sorted(expected_rounds - observed_rounds)
    frozen = job / "frozen-harness"
    for path in sorted((job / "selected-inputs/manifests").glob("round_*.json")):
        manifest = read_json(path)
        if manifest.get("role") != "current_api_compatibility_development":
            continue
        baseline = (frozen / manifest["production_baseline_relative_to_harness"]).resolve()
        if not baseline.is_relative_to(frozen.resolve()):
            raise ValueError("Baseline must be inside the frozen public harness snapshot")
        matches = []
        for folder in (output / "runs").iterdir():
            if not folder.is_dir():
                continue
            meta_path = folder / "manifest.json"
            if not meta_path.exists():
                meta_path = folder / "started.json"
            meta = read_json(meta_path)
            if (meta.get("source") or {}).get("round") == manifest["round_id"]:
                matches.append(folder)
        if len(matches) != 1:
            comparisons.append({"round": manifest["round_id"], "state": "missing_or_duplicate_run"})
            continue
        report = reconcile_production(baseline, path.parent / manifest["inputs"], matches[0])
        target = job / f"production-comparison-{manifest['round_id']}.json"
        write_json(target, report)
        comparisons.append({k: v for k, v in report.items() if k != "records"})
    result = {
        "kind": "offline_execution_and_membership_checks_not_expert_validation",
        "totals": inspection["totals"],
        "integrity_issues": inspection["integrity_issues"],
        "current_policy_review_warnings": inspection["current_policy_review_warnings"],
        "production_comparisons": comparisons,
        "unstarted_rounds": unstarted,
        "all_checks_clear": bool(inspection["runs"])
        and not inspection["integrity_issues"]
        and not inspection["current_policy_review_warnings"]
        and not inspection["totals"]["model_failure_records"]
        and not unstarted
        and all(r["pending_count"] == 0 and r["sealed"] for r in inspection["runs"])
        and all(c.get("accepted_membership_equals_live") for c in comparisons),
        "expert_validation_complete": False,
    }
    write_json(job / "post-inspection-summary.json", result)
    return result


if __name__ == "__main__":
    result = inspect_job(Path(sys.argv[1]).resolve())
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["all_checks_clear"] else 2)
