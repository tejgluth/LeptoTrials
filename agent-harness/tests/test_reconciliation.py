import pytest
from conftest import FakeModel, response, trial

from leptotrials_harness.decision_pipeline import Pipeline
from leptotrials_harness.logging_utils import now, write_json
from leptotrials_harness.reconciliation import reconcile_production


def setup_case(tmp_path, config, *, complete=True):
    a = trial("LM inclusion conflicts with LM exclusion in this cancer trial.")
    b = trial("", conditions=["Leptomeningeal Metastasis"])
    b.nct_id = "NCT11111111"
    baseline = tmp_path / "live.json"
    candidates = tmp_path / "candidates.json"
    live = {
        "url": "https://leptotrials.com/",
        "captured_at": now(),
        "count": 1,
        "nct_ids": [a.nct_id],
        "filters": {
            "age": None,
            "location": "Anywhere",
            "study_type": "any",
            "phases": [],
            "statuses": ["RECRUITING"],
            "tumor_type": "any",
        },
    }
    capture = {
        "complete": complete,
        "captured_at": now(),
        "statuses": ["RECRUITING"],
        "count": 2,
        "trials": [a.model_dump(mode="json"), b.model_dump(mode="json")],
    }
    write_json(baseline, live)
    write_json(candidates, capture)
    model = FakeModel(config, response(a, "AMBIGUOUS_REQUIRES_REVIEW"))
    pipeline = Pipeline(config, tmp_path / "output", client=model)
    pipeline.classify(a)
    return baseline, candidates, pipeline, b, live, capture


def test_membership_disagreement_is_explicit_and_does_not_change_decisions(tmp_path, config):
    baseline, candidates, pipeline, b, _, _ = setup_case(tmp_path, config)
    pipeline.classify(b)
    pipeline.finish()
    report = reconcile_production(baseline, candidates, pipeline.run_dir)
    assert report["execution_complete"]
    assert not report["proposed_membership_equals_live"]
    assert report["live_not_proposed_inclusive"] == ["NCT01234567"]
    assert report["proposed_inclusive_not_live"] == [b.nct_id]
    assert report["unresolved_nct_ids"] == ["NCT01234567"]
    assert report["expert_validation_complete"] is False


def test_pending_records_are_not_called_complete(tmp_path, config):
    baseline, candidates, pipeline, b, _, _ = setup_case(tmp_path, config)
    pipeline.finish()
    report = reconcile_production(baseline, candidates, pipeline.run_dir)
    assert report["pending_nct_ids"] == [b.nct_id]
    assert not report["execution_complete"]


def test_incomplete_retrieval_duplicate_baseline_and_changed_input_fail_closed(tmp_path, config):
    baseline, candidates, pipeline, _, live, capture = setup_case(tmp_path, config, complete=False)
    with pytest.raises(ValueError, match="incomplete"):
        reconcile_production(baseline, candidates, pipeline.run_dir)
    capture["complete"] = True
    candidates = tmp_path / "complete-candidates.json"
    write_json(candidates, capture)
    live["nct_ids"] *= 2
    live["count"] = 2
    baseline = tmp_path / "duplicate-baseline.json"
    write_json(baseline, live)
    with pytest.raises(ValueError, match="duplicated"):
        reconcile_production(baseline, candidates, pipeline.run_dir)
    live["nct_ids"] = ["NCT01234567"]
    live["count"] = 1
    baseline = tmp_path / "restored-baseline.json"
    write_json(baseline, live)
    capture["trials"][0]["brief_title"] += " Changed"
    candidates = tmp_path / "changed-candidates.json"
    write_json(candidates, capture)
    with pytest.raises(ValueError, match="revision mismatch"):
        reconcile_production(baseline, candidates, pipeline.run_dir)
