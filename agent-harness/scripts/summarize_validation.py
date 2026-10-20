"""Summarize completed validation runs (counts, failures, tokens)."""

import argparse
from pathlib import Path

from leptotrials_harness.logging_utils import read_json, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("aggregate", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--input-rate", type=float)
    parser.add_argument("--output-rate", type=float)
    parser.add_argument("--price-source")
    args = parser.parse_args()
    aggregate = read_json(args.aggregate)
    report = {
        "kind": "executed_retrospective_subset_classification_not_expert_validation",
        "source_aggregate": args.aggregate.name,
        "complete": aggregate["complete"],
        "expert_validation_complete": aggregate.get("expert_validation_complete", False),
        "limitation": "Unchanged-record survivor subsets, not complete historical populations. "
        "Expert ground truth unavailable; no FP/FN or accuracy assertion.",
        "rounds": [],
    }
    for result in aggregate["rounds"]:
        run = result["run"]
        report["rounds"].append(
            {
                "round_id": result["round"],
                "role": result["role"],
                "validation_state": result["validation_state"],
                "run_id": run["run_id"],
                "state": run["state"],
                "started_at": run["started_at"],
                "finished_at": run["finished_at"],
                "count": run["count"],
                "model": run["model"],
                "implementation_hash": run["implementation_hash"],
                "prompt_hash": run["prompt_hash"],
                "records_hash": run["records_hash"],
                "performance": run["performance"],
                "elapsed_ms": run["elapsed_ms"],
                "metrics": result["metrics"],
            }
        )
    if args.input_rate is not None and args.output_rate is not None:
        usage_complete = all(
            not r["performance"]["model_calls"]
            or r["performance"].get(
                "token_usage_complete",
                (
                    r["performance"]["input_tokens"] is not None
                    and r["performance"]["output_tokens"] is not None
                    and not r["performance"]["api_model_failures"]
                ),
            )
            for r in report["rounds"]
        )
        tokens_in = sum(r["performance"]["input_tokens"] or 0 for r in report["rounds"])
        tokens_out = sum(r["performance"]["output_tokens"] or 0 for r in report["rounds"])
        report["posthoc_standard_rate_estimate"] = {
            "input_tokens": tokens_in,
            "output_tokens": tokens_out,
            "input_usd_per_million": args.input_rate,
            "output_usd_per_million": args.output_rate,
            "estimated_usd": (tokens_in * args.input_rate + tokens_out * args.output_rate) / 1e6
            if usage_complete
            else None,
            "token_usage_complete": usage_complete,
            "source": args.price_source,
            "note": "Base standard token rates, not an invoice. Does not apply cache discounts, "
            "regional premiums, cache-write pricing or development/smoke-test calls.",
        }
    write_json(args.output, report)
    print(
        {
            "output": str(args.output),
            "rounds": len(report["rounds"]),
            "record_round_pairs": sum(r["count"] for r in report["rounds"]),
            "model_calls": sum(r["performance"]["model_calls"] for r in report["rounds"]),
        }
    )


if __name__ == "__main__":
    main()
