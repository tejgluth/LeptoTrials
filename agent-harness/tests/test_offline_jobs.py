"""Detached verification safeguards do not require launchd or a model in unit tests."""

import importlib.util
import json
import sys
import time
from datetime import date
from pathlib import Path

import pytest
from conftest import raw_trial

from leptotrials_harness.historical import import_snapshot
from leptotrials_harness.validation import load_round


def runner():
    path = Path(__file__).resolve().parents[1] / "scripts/offline_verify.py"
    spec = importlib.util.spec_from_file_location("offline_verify", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_snapshot_excludes_credentials_and_private_outputs(tmp_path):
    source, destination = tmp_path / "source", tmp_path / "snapshot"
    source.mkdir()
    destination.mkdir()
    (source / ".env").write_text("NOT_A_REAL_KEY=private")
    (source / "output").mkdir()
    (source / "output/private.txt").write_text("private")
    (source / "src").mkdir()
    (source / "src/model.py").write_text("# public source")
    runner().snapshot(source, destination)
    assert (destination / "src/model.py").exists()
    assert not (destination / ".env").exists()
    assert not (destination / "output").exists()
    assert "src/model.py" in json.loads((tmp_path / "snapshot-hashes.json").read_text())


def test_expired_job_never_launches_work(tmp_path):
    (tmp_path / "job.json").write_text(
        json.dumps(
            {
                "deadline_epoch": 1,
                "deadline": "1970-01-01T00:00:01Z",
                "python": "/does/not/exist",
                "path": "/usr/bin",
                "npm": "/not/npm",
                "repo": str(tmp_path),
            }
        )
    )
    assert runner().run(tmp_path) == 0
    result = json.loads((tmp_path / "summary.json").read_text())
    assert result["state"] == "time_limit"
    assert result["phases"] == []
    # Re-running an expired/completed LaunchAgent is an inert operation.
    assert runner().run(tmp_path) == 0


def test_selected_frozen_rounds_preserve_exact_inputs_and_do_not_copy_unrelated_files(tmp_path):
    source = tmp_path / "archive.json"
    source.write_text(json.dumps({"snapshot_date": "2017-10-17", "studies": [raw_trial()]}))
    original = tmp_path / "original"
    import_snapshot(source, date(2017, 10, 17), "round_01", original, "Synthetic", "unspecified")
    (original / ".env").write_text("DO_NOT_COPY=not-a-real-key")
    destination = tmp_path / "frozen"
    lineage = runner().freeze_selected_rounds(original / "manifests", destination)
    manifest, inputs, truth = load_round(destination / "manifests/round_01.json")
    assert len(inputs) == 1 and truth == []
    assert manifest["frozen_from"]["manifest_hash"] == lineage[0]["source_manifest_hash"]
    assert not (destination / ".env").exists()
    with pytest.raises(ValueError, match="No frozen"):
        runner().freeze_selected_rounds(tmp_path / "missing", tmp_path / "other")


@pytest.mark.parametrize("post_inspection", [False, True])
def test_selected_classification_job_never_runs_legacy_sweep_or_inherits_cloud_keys(
    tmp_path, monkeypatch, post_inspection
):
    module = runner()
    (tmp_path / "job.json").write_text(
        json.dumps(
            {
                "deadline_epoch": time.time() + 3600,
                "deadline": "future test deadline",
                "python": sys.executable,
                "path": "/usr/bin",
                "repo": str(tmp_path),
                "npm": "not-used",
                "selected_rounds": [{"round": "round_01"}],
                "classification_only": True,
                "post_inspection": post_inspection,
            }
        )
    )
    calls = []

    class Process:
        pid = 123
        returncode = 0

        def poll(self):
            return 0

    def popen(command, **kwargs):
        calls.append((command, kwargs))
        return Process()

    monkeypatch.setattr(module.subprocess, "Popen", popen)
    monkeypatch.setenv("OPENAI_API_KEY", "not-a-real-key-do-not-inherit")
    assert module.run(tmp_path) == 0
    assert len(calls) == 1 + post_inspection
    command, kwargs = calls[0]
    assert "validate-all" in command
    assert command[command.index("--manifests") + 1] == str(tmp_path / "selected-inputs/manifests")
    assert "config/ollama.yaml" in command
    assert "OPENAI_API_KEY" not in kwargs["env"]
    assert "HARNESS_PROVIDER" not in kwargs["env"]
    if post_inspection:
        assert "scripts/inspect_review_cycle.py" in calls[1][0]
        assert "OPENAI_API_KEY" not in calls[1][1]["env"]


def test_classification_only_requires_explicit_manifests():
    with pytest.raises(ValueError, match="requires explicit"):
        runner().schedule(1, classification_only=True)
