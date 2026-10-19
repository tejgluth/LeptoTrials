"""Explicit cache compatibility migration after transport-only code changes.

This revalidates prior responses against the exact same prompts/config/schema and source
text. Use only when classification policy is unchanged; the reason and both implementation
hashes are retained. It never creates an expert approval or an application export.
"""

import argparse
import json
from pathlib import Path

from leptotrials_harness.audit import load_decisions
from leptotrials_harness.config import ModelConfig, load_config
from leptotrials_harness.decision_pipeline import classification_cache_key, implementation_hash
from leptotrials_harness.evidence import verify_evidence
from leptotrials_harness.logging_utils import digest, read_json, write_json
from leptotrials_harness.models import ClassificationOutput, TrialInput
from leptotrials_harness.structured_input import content_hash, prompts
from leptotrials_harness.trial_normalizer import extract_signals


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=Path, required=True)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--reason", required=True)
    args = parser.parse_args()
    config = load_config(args.config)
    code_hash = implementation_hash()
    count, existing = 0, 0
    for manifest_file in sorted(args.runs.glob("*/manifest.json")):
        manifest = read_json(manifest_file)
        if (
            manifest["dry_run"]
            or manifest["force_model"]
            or ModelConfig.model_validate(manifest["model"]).model_dump()
            != config.model.model_dump()
            or manifest["prompt_hash"] != digest(prompts())
        ):
            continue
        for record in load_decisions(manifest_file.parent):
            if record["pipeline_stage"] != "agent" or not record["result"] or record["error"]:
                continue
            trial = TrialInput.model_validate_json(
                (manifest_file.parent / "inputs" / f"{record['nct_id']}.json").read_text()
            )
            trial.deterministic_signals = extract_signals(trial)
            if content_hash(trial) != record["input_hash"]:
                continue
            result = ClassificationOutput.model_validate_json(json.dumps(record["result"]))
            if (
                result.model_version != config.model.model_id
                or result.prompt_version != prompts()["version"]
            ):
                continue
            verify_evidence(result, trial)
            key = classification_cache_key(trial, config, code_hash)
            target = args.output_root / "cache" / f"{key}.json"
            if target.exists():
                existing += 1
                continue
            write_json(
                target,
                {
                    "run_id": record["run_id"],
                    "result": result.model_dump(mode="json"),
                    "compatibility_migration": {
                        "reason": args.reason,
                        "source_implementation": manifest["implementation_hash"],
                        "target_implementation": code_hash,
                        "source_decision_hash": record["decision_hash"],
                    },
                },
            )
            count += 1
    print(
        {
            "imported": count,
            "existing": existing,
            "note": "Verified model outputs only; no expert approval implied",
        }
    )


if __name__ == "__main__":
    main()
