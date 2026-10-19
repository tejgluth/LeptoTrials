import copy
import json
import plistlib
import re
from pathlib import Path

import pytest
from conftest import FakeModel, raw_trial, response

from leptotrials_harness import cli
from leptotrials_harness.clinicaltrials_api import RegistryError
from leptotrials_harness.models import TrialInput


def test_repeated_polls_classify_new_and_changed_trials_not_metadata_only_changes(
    config, tmp_path, monkeypatch
):
    first = raw_trial("Patients with leptomeningeal disease may enroll.")
    added = copy.deepcopy(first)
    added["protocolSection"]["identificationModule"]["nctId"] = "NCT01234568"
    changed = copy.deepcopy(first)
    changed["protocolSection"]["eligibilityModule"]["eligibilityCriteria"] = (
        "Patients with stable leptomeningeal disease may enroll."
    )
    metadata_only = copy.deepcopy(added)
    metadata_only["protocolSection"]["statusModule"] = {
        "lastUpdatePostDateStruct": {"date": "2026-10-18"}
    }
    snapshots = [[first], [first, added], [changed, metadata_only], [changed]]
    registries = []

    class Registry:
        def __init__(self, settings):
            self.config = settings
            self.snapshot = snapshots[len(registries)]
            self.closed = False
            registries.append(self)

        def search(self, kind, value, statuses):
            assert statuses == config.registry.statuses
            # Complementary queries overlap. The real fetcher must deduplicate.
            return self.snapshot

        def close(self):
            self.closed = True

    class Model(FakeModel):
        def generate(self, system, task, payload):
            item = TrialInput.model_validate_json(json.dumps(payload["trial"]))
            self.output = response(item)
            return super().generate(system, task, payload)

    model = Model(config, {})
    monkeypatch.setattr(cli, "load_config", lambda path: config)
    monkeypatch.setattr(cli, "RegistryClient", Registry)
    monkeypatch.setattr(
        "leptotrials_harness.decision_pipeline.create_model_client", lambda _: model
    )
    runs = [
        cli.execute(cli.parser().parse_args(["--output-root", str(tmp_path), "maintain"]))
        for _ in snapshots
    ]
    assert [r["count"] for r in runs] == [1, 2, 2, 1]
    assert [r["performance"]["model_calls"] for r in runs] == [1, 1, 1, 0]
    assert [r["performance"]["cache_hits"] for r in runs] == [0, 1, 1, 1]
    assert model.calls == 3
    assert all(r.closed for r in registries)
    assert len(list((tmp_path / "candidates").glob("*.json"))) == 4
    assert all((tmp_path / "runs" / r["run_id"] / "review.md").exists() for r in runs)
    # A disappearing candidate does not erase its historical decision or cache.
    assert (tmp_path / "runs" / runs[1]["run_id"] / "decisions/NCT01234568.json").exists()


def test_failed_later_query_never_classifies_a_partial_candidate_set(config, tmp_path, monkeypatch):
    registries = []

    class Registry:
        def __init__(self, settings):
            self.config, self.calls, self.closed = settings, 0, False
            registries.append(self)

        def search(self, *args):
            self.calls += 1
            if self.calls > 1:
                raise RegistryError("Synthetic later-query failure")
            return [raw_trial("Patients with leptomeningeal disease may enroll.")]

        def close(self):
            self.closed = True

    monkeypatch.setattr(cli, "load_config", lambda path: config)
    monkeypatch.setattr(cli, "RegistryClient", Registry)
    with pytest.raises(RegistryError):
        cli.execute(cli.parser().parse_args(["--output-root", str(tmp_path), "maintain"]))
    assert registries[0].closed
    assert not (tmp_path / "runs").exists()
    assert not (tmp_path / "candidates").exists()
    failure = json.loads(next((tmp_path / "failures").glob("*.json")).read_text())
    assert failure["complete"] is False


def test_documented_launchagent_is_parseable_and_invokes_real_cli():
    docs = Path(__file__).resolve().parents[1] / "docs/scheduling.md"
    template = re.search(r"```xml\n(.*?)\n```", docs.read_text(), re.S)[1]
    job = plistlib.loads(template.encode())
    assert job["StartInterval"] == 900
    assert job["RunAtLoad"] is False
    assert not job.get("KeepAlive")
    args = job["ProgramArguments"]
    assert args[1:3] == ["-m", "leptotrials_harness"]
    parsed = cli.parser().parse_args(args[3:])
    assert parsed.command == "maintain"
    assert parsed.workers == 1 and not parsed.dry_run
    assert parsed.output_root == Path("output/maintenance")
