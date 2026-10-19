import importlib.util
from pathlib import Path

import pytest
from conftest import FakeModel, response, trial

from leptotrials_harness.decision_pipeline import Pipeline
from leptotrials_harness.logging_utils import now, read_json, write_json


@pytest.mark.parametrize("unresolved", [False, True])
def test_offline_post_inspection_checks_actual_decisions_without_manufacturing_parity(
    config, tmp_path, unresolved
):
    script = Path(__file__).resolve().parents[1] / "scripts/inspect_review_cycle.py"
    spec = importlib.util.spec_from_file_location("inspect_review_cycle", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    item = trial()
    live = {
        "url": "https://leptotrials.com/",
        "captured_at": now(),
        "count": 1,
        "nct_ids": [item.nct_id],
        "filters": {
            "age": None,
            "location": "Anywhere",
            "study_type": "any",
            "phases": [],
            "statuses": ["RECRUITING"],
            "tumor_type": "any",
        },
    }
    write_json(tmp_path / "frozen-harness/validation/baseline.json", live)
    write_json(
        tmp_path / "selected-inputs/rounds/round_11/inputs.json",
        {
            "complete": True,
            "captured_at": now(),
            "statuses": ["RECRUITING"],
            "count": 1,
            "trials": [item.model_dump(mode="json")],
        },
    )
    write_json(
        tmp_path / "selected-inputs/manifests/round_11.json",
        {
            "round_id": "round_11",
            "role": "current_api_compatibility_development",
            "inputs": "../rounds/round_11/inputs.json",
            "production_baseline_relative_to_harness": "validation/baseline.json",
        },
    )
    category = "INSUFFICIENT_INFORMATION" if unresolved else "LM_INCLUSIVE_GENERAL"
    pipeline = Pipeline(
        config,
        tmp_path / "harness-output",
        client=FakeModel(config, response(item, category)),
        source={"round": "round_11"},
    )
    pipeline.classify_many([item])
    pipeline.finish()
    result = module.inspect_job(tmp_path)
    assert result["all_checks_clear"] is (not unresolved)
    assert result["expert_validation_complete"] is False
    assert result["totals"]["record_round_decisions"] == 1
    comparison = read_json(tmp_path / "production-comparison-round_11.json")
    assert comparison["accepted_membership_equals_live"] is (not unresolved)
    assert comparison["unresolved_nct_ids"] == ([item.nct_id] if unresolved else [])
