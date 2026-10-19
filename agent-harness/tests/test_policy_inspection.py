from conftest import FakeModel, response, trial

from leptotrials_harness.decision_pipeline import Pipeline
from leptotrials_harness.evidence import verify_evidence
from leptotrials_harness.execution import inspect_execution


def test_new_policy_warning_does_not_erase_historical_records_or_fake_corruption(
    config, tmp_path, monkeypatch
):
    import leptotrials_harness.agent_classifier as agent

    item = trial("Exclusion Criteria: Brain metastases.")
    monkeypatch.setattr(
        agent,
        "verify_evidence",
        lambda result, source: verify_evidence(result, source, semantic_support=False),
    )
    pipeline = Pipeline(config, tmp_path, client=FakeModel(config, response(item, "LM_EXCLUDED")))
    pipeline.classify(item)
    pipeline.finish()
    report = inspect_execution(tmp_path)
    assert report["totals"]["record_round_decisions"] == 1
    assert report["totals"]["source_verified_result_records"] == 1
    assert report["integrity_issues"] == []
    assert len(report["current_policy_review_warnings"]) == 1
    assert "LM-specific exclusion" in report["current_policy_review_warnings"][0]["message"]
