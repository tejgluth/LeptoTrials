"""Publish observed model examples without manufacturing expert labels."""

import argparse
from pathlib import Path

from leptotrials_harness.audit import load_decisions
from leptotrials_harness.logging_utils import read_json, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    manifest = read_json(args.run / "manifest.json")
    rows = load_decisions(args.run)
    wanted = [
        "LM_SPECIFIC",
        "LM_EXCLUDED",
        "LM_INCLUSIVE_COHORT_SPECIFIC",
        "AMBIGUOUS_REQUIRES_REVIEW",
    ]
    examples = []
    for category in wanted:
        candidates = [r for r in rows if r["classification"] == category and r["model_called"]]
        if not candidates:
            candidates = [r for r in rows if r["classification"] == category]
        if not candidates:
            continue
        r = candidates[0]
        examples.append(
            {
                "nct_id": r["nct_id"],
                "title": r["title"],
                "source": r["source_url"],
                "input_hash": r["input_hash"],
                "decision_hash": r["decision_hash"],
                "raw_relevant_fields": [
                    {"field": e["field"], "passage": e["quote"]}
                    for e in r["result"]["evidence"] + r["result"]["conflicting_evidence"]
                ],
                "observed_model_output": r["result"],
                "original_model_attempts": r["attempts"],
                "pipeline_status": r["status"],
                "requires_expert_review": r["requires_review"],
                "expert_decision": None,
                "final_approved_classification": None,
            }
        )
    write_json(
        args.output,
        {
            "kind": "observed_public_registry_classifications_not_expert_truth",
            "run_id": manifest["run_id"],
            "model": manifest["model"],
            "prompt_hash": manifest["prompt_hash"],
            "examples": examples,
        },
    )
    print({"examples": len(examples), "output": str(args.output)})


if __name__ == "__main__":
    main()
