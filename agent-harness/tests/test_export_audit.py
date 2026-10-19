import json

import pytest
from conftest import FakeModel, response, trial

from leptotrials_harness.audit import adjudicate
from leptotrials_harness.decision_pipeline import Pipeline
from leptotrials_harness.export import export_approved


def test_expert_export_revision_binding_and_raw_output_preservation(config, tmp_path):
    t = trial()
    pipeline = Pipeline(config, tmp_path, client=FakeModel(config, response(t)))
    record = pipeline.classify(t)
    pipeline.finish()
    original = (pipeline.run_dir / "decisions" / f"{t.nct_id}.json").read_bytes()
    expert = {
        "nct_id": t.nct_id,
        "run_id": pipeline.run_id,
        "input_hash": record["input_hash"],
        "decision_hash": record["decision_hash"],
        "expert_classification": "LM_INCLUSIVE_GENERAL",
        "is_lm_inclusive": True,
        "reviewer_id": "reviewer_01",
        "review_date": "2026-10-17",
        "source_checked": True,
        "disposition": "approve",
        "tumor_labels": ["BREAST"],
        "notes": "",
    }
    source = tmp_path / "expert.json"
    source.write_text(json.dumps(expert))
    adjudicate(pipeline.run_dir, source, tmp_path / "adjudications")
    artifact = export_approved(pipeline.run_dir, source, tmp_path / "export.json", "json")
    assert artifact["overrides"][t.nct_id] == {"siteEligible": True, "tumorLabels": ["BREAST"]}
    assert (pipeline.run_dir / "decisions" / f"{t.nct_id}.json").read_bytes() == original
    expert["input_hash"] = "a" * 64
    source.write_text(json.dumps(expert))
    with pytest.raises(ValueError, match="different record revision"):
        export_approved(pipeline.run_dir, source, tmp_path / "bad.json", "json")


def test_dry_runs_cannot_export(config, tmp_path):
    pipeline = Pipeline(config, tmp_path, dry_run=True)
    pipeline.classify(trial())
    pipeline.finish()
    with pytest.raises(ValueError, match="non-dry-run"):
        export_approved(pipeline.run_dir, tmp_path / "absent", tmp_path / "bad.json", "json")


def test_expert_can_resolve_model_failure_without_overwriting_it(config, tmp_path):
    item = trial()
    pipeline = Pipeline(config, tmp_path, client=FakeModel(config, "invalid JSON"))
    row = pipeline.classify(item)
    assert pipeline.finish()["state"] == "failed"
    expert = {
        "nct_id": item.nct_id,
        "run_id": pipeline.run_id,
        "input_hash": row["input_hash"],
        "decision_hash": row["decision_hash"],
        "expert_classification": "LM_INCLUSIVE_GENERAL",
        "is_lm_inclusive": True,
        "reviewer_id": "expert_01",
        "review_date": "2026-10-18",
        "source_checked": True,
        "disposition": "change",
        "tumor_labels": [],
        "notes": "Reviewed synthetic test input",
    }
    source = tmp_path / "expert.json"
    source.write_text(json.dumps(expert))
    artifact = export_approved(pipeline.run_dir, source, tmp_path / "reviewed.json", "json")
    assert artifact["overrides"][item.nct_id]["siteEligible"] is True
    assert artifact["provenance"][0]["model_decision"] is None
    assert row["error"] == "MODEL_FAILURE"
    expert["disposition"] = "approve"  # No model decision exists to approve unchanged.
    source.write_text(json.dumps(expert))
    with pytest.raises(ValueError, match="use change"):
        export_approved(pipeline.run_dir, source, tmp_path / "bad.json", "json")


def test_typescript_export_uses_explicit_app_root_and_preserves_sidecar(config, tmp_path):
    item = trial()
    pipeline = Pipeline(config, tmp_path, client=FakeModel(config, response(item)))
    row = pipeline.classify(item)
    pipeline.finish()
    expert = {
        "nct_id": item.nct_id,
        "run_id": pipeline.run_id,
        "input_hash": row["input_hash"],
        "decision_hash": row["decision_hash"],
        "expert_classification": "LM_INCLUSIVE_GENERAL",
        "is_lm_inclusive": True,
        "reviewer_id": "expert_01",
        "review_date": "2026-10-18",
        "source_checked": True,
        "disposition": "approve",
        "tumor_labels": [],
        "notes": "",
    }
    source = tmp_path / "expert.json"
    source.write_text(json.dumps(expert))
    app = tmp_path / "application"
    type_file = app / "src/utils/manualAuditOverrides.ts"
    type_file.parent.mkdir(parents=True)
    type_file.write_text("export interface ManualAuditOverride {}")
    output = tmp_path / "generated.ts"
    output.with_suffix(".provenance.json").write_text("Existing provenance")
    with pytest.raises(FileExistsError):
        export_approved(pipeline.run_dir, source, output, "typescript", app)
    assert not output.exists()
    fresh = tmp_path / "fresh.ts"
    export_approved(pipeline.run_dir, source, fresh, "typescript", app)
    assert "./application/src/utils/manualAuditOverrides" in fresh.read_text()
