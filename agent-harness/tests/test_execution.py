import json
from datetime import date

import pytest
from conftest import FakeModel, raw_trial, response, trial

from leptotrials_harness.audit import create_audit_batch, review_packet
from leptotrials_harness.decision_pipeline import Pipeline
from leptotrials_harness.execution import inspect_execution, prepare_retry, publish_execution
from leptotrials_harness.historical import import_snapshot
from leptotrials_harness.trial_normalizer import normalize


def test_report_reads_running_checkpoint(config, tmp_path):
    item = trial()
    pipeline = Pipeline(config, tmp_path, client=FakeModel(config, response(item)))
    pipeline.classify(item)
    report = inspect_execution(tmp_path)
    assert report["totals"]["source_verified_result_records"] == 1
    assert report["runs"][0]["sealed"] is False
    assert report["expert_metrics"] is None
    assert report["integrity_issues"] == []
    assert not (pipeline.run_dir / "manifest.json").exists()
    publish_execution(report, tmp_path / "inspection.json")
    assert (tmp_path / "inspection.md").exists()
    with pytest.raises(FileExistsError):
        publish_execution(report, tmp_path / "inspection.json")


def test_report_discloses_modified_decision_instead_of_counting_success(config, tmp_path):
    item = trial()
    pipeline = Pipeline(config, tmp_path, client=FakeModel(config, response(item)))
    row = pipeline.classify(item)
    pipeline.finish()
    row["result"]["primary_reason"] = "modified after the run"
    path = pipeline.run_dir / "decisions" / f"{item.nct_id}.json"
    path.write_text(json.dumps(row))
    report = inspect_execution(tmp_path)
    assert report["integrity_issues"]
    assert report["totals"]["record_round_decisions"] == 0


def test_retry_selects_only_failures_and_preserves_original(config, tmp_path):
    item = trial()
    pipeline = Pipeline(config, tmp_path, client=FakeModel(config, "not JSON"))
    pipeline.classify(item)
    pipeline.finish()
    original = (pipeline.run_dir / "decisions" / f"{item.nct_id}.json").read_bytes()
    target = tmp_path / "retry.json"
    result = prepare_retry(pipeline.run_dir, target)
    assert result["count"] == 1
    batch = json.loads(target.read_text())
    assert batch["trials"][0]["nct_id"] == item.nct_id
    assert batch["lineage"][0]["input_hash"]
    assert (pipeline.run_dir / "decisions" / f"{item.nct_id}.json").read_bytes() == original
    report = inspect_execution(tmp_path)
    assert report["totals"]["model_failure_records"] == 1
    assert report["schema_violation_reasons"]


def test_unreadable_live_artifact_is_disclosed(config, tmp_path):
    pipeline = Pipeline(config, tmp_path, dry_run=True)
    folder = pipeline.run_dir / "decisions"
    folder.mkdir()
    (folder / "NCT01234567.json").write_text("{")
    report = inspect_execution(tmp_path)
    assert report["runs"][0]["excluded_unreadable_nct_ids"] == ["NCT01234567"]
    assert len(report["integrity_issues"]) == 1


def test_review_packet_exposes_safety_status_and_binding_fields(config, tmp_path):
    item = trial("Exclusion Criteria:\nPatients with leptomeningeal disease are excluded.")
    data = response(item)  # Deliberately inclusive proposal; independent gate must remain visible.
    pipeline = Pipeline(config, tmp_path, client=FakeModel(config, data))
    pipeline.classify(item)
    pipeline.finish()
    review_packet(pipeline.run_dir, tmp_path / "review.md")
    text = (tmp_path / "review.md").read_text()
    assert pipeline.run_id in text
    assert "REQUIRES_EXPERT_REVIEW" in text
    assert "Inclusion evidence is from an exclusion section" in text
    create_audit_batch(tmp_path, "2000-01-01", tmp_path / "audit.csv")
    assert "REQUIRES_EXPERT_REVIEW" in (tmp_path / "audit.csv").read_text()


def test_resume_batch_includes_unprocessed_frozen_inputs_without_dropping_success(config, tmp_path):
    first = raw_trial(conditions=["Leptomeningeal Metastasis"])
    second = raw_trial("Patients with leptomeningeal disease may enroll.")
    second["protocolSection"]["identificationModule"]["nctId"] = "NCT01234568"
    source = tmp_path / "snapshot.json"
    source.write_text(json.dumps({"snapshot_date": "2026-10-18", "studies": [first, second]}))
    archive = tmp_path / "archive"
    import_snapshot(
        source, date(2026, 10, 18), "round_01", archive, "Synthetic fixture", "unspecified"
    )

    class Interrupted(FakeModel):
        def generate(self, *args):
            raise KeyboardInterrupt

    pipeline = Pipeline(config, tmp_path / "outputs", client=Interrupted(config, {}))
    with pytest.raises(KeyboardInterrupt):
        pipeline.classify_many([normalize(first), normalize(second)])
    pipeline.finish(error="KeyboardInterrupt")
    inspection = inspect_execution(tmp_path / "outputs")
    assert inspection["runs"][0]["planned_count"] == 2
    assert inspection["runs"][0]["pending_count"] == 1
    assert inspection["totals"]["source_verified_result_records"] == 1
    target = tmp_path / "resume.json"
    prepare_retry(
        pipeline.run_dir, target, manifest_path=archive / "manifests/round_01.json", limit=1
    )
    batch = json.loads(target.read_text())
    assert [t["nct_id"] for t in batch["trials"]] == ["NCT01234568"]
    assert batch["lineage"][0]["prior_status"] == "unprocessed"
    assert batch["is_complete_round_reproduction"] is False


def test_retry_refuses_mismatched_source_and_invalid_limit(config, tmp_path):
    pipeline = Pipeline(config, tmp_path / "outputs", client=FakeModel(config, "not JSON"))
    row = pipeline.classify(trial())
    pipeline.finish()
    with pytest.raises(ValueError, match="positive"):
        prepare_retry(pipeline.run_dir, tmp_path / "bad-limit.json", limit=0)
    source = tmp_path / "snapshot.json"
    source.write_text(
        json.dumps({"snapshot_date": "2026-10-18", "studies": [raw_trial("changed")]})
    )
    archive = tmp_path / "archive"
    import_snapshot(
        source, date(2026, 10, 18), "round_01", archive, "Synthetic fixture", "unspecified"
    )
    with pytest.raises(ValueError, match="source input revisions"):
        prepare_retry(
            pipeline.run_dir,
            tmp_path / "bad.json",
            manifest_path=archive / "manifests/round_01.json",
        )
    assert row["error"] == "MODEL_FAILURE"


def test_resume_refuses_extra_unprocessed_ids_outside_original_plan(config, tmp_path):
    item = trial()
    pipeline = Pipeline(config, tmp_path / "outputs", client=FakeModel(config, "not JSON"))
    pipeline.classify_many([item])
    pipeline.finish()
    first = raw_trial(item.eligibility.raw_text)
    extra = raw_trial()
    extra["protocolSection"]["identificationModule"]["nctId"] = "NCT01234568"
    source = tmp_path / "snapshot.json"
    source.write_text(json.dumps({"snapshot_date": "2026-10-18", "studies": [first, extra]}))
    archive = tmp_path / "archive"
    import_snapshot(source, date(2026, 10, 18), "round_01", archive, "Synthetic", "unspecified")
    with pytest.raises(ValueError, match="complete planned"):
        prepare_retry(
            pipeline.run_dir,
            tmp_path / "bad.json",
            manifest_path=archive / "manifests/round_01.json",
        )
