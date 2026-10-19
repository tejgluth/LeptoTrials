import json
from datetime import date

import httpx
import pytest
from conftest import raw_trial

from leptotrials_harness.clinicaltrials_api import RegistryClient, RegistryError
from leptotrials_harness.config import RESOURCES
from leptotrials_harness.historical import capture_unchanged_round, import_snapshot
from leptotrials_harness.logging_utils import read_json
from leptotrials_harness.validation import load_round


def test_checked_in_ten_rounds_are_exact_reproducible_frozen_inputs():
    expected = [400, 467, 530, 617, 720, 811, 934, 1098, 1339, 1928]
    paths = sorted((RESOURCES / "validation/manifests").glob("round_*.json"))
    assert len(paths) == 10
    for path, count in zip(paths, expected, strict=True):
        manifest, trials, truth = load_round(path)
        assert len(trials) == count
        assert truth == []
        assert manifest["not_original_paper_validation"]


def test_date_filter_is_verified_not_trusted(config, tmp_path):
    record = raw_trial()
    record["protocolSection"]["statusModule"] = {
        "studyFirstPostDateStruct": {"date": "2017-01-01"},
        "lastUpdatePostDateStruct": {"date": "2026-01-01"},
    }
    client = RegistryClient(
        config.registry,
        httpx.Client(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"studies": [record]}))
        ),
    )
    with pytest.raises(RegistryError, match="date bounds"):
        capture_unchanged_round(client, date(2018, 1, 1), "round_01", tmp_path)
    assert not list(tmp_path.rglob("*.json"))


def test_snapshot_import_and_checksum_failure(tmp_path):
    source = tmp_path / "source.json"
    source.write_text(json.dumps({"snapshot_date": "2017-10-17", "studies": [raw_trial()]}))
    import_snapshot(
        source,
        date(2017, 10, 17),
        "round_01",
        tmp_path / "archive",
        "Public test snapshot, not historical truth",
        "unspecified",
    )
    path = tmp_path / "archive/manifests/round_01.json"
    assert len(load_round(path)[1]) == 1
    inputs = path.parent / read_json(path)["inputs"]
    inputs.write_text("{}")
    with pytest.raises(ValueError, match="checksum"):
        load_round(path)


def test_malformed_snapshot_does_not_fetch_today(tmp_path):
    source = tmp_path / "source.json"
    source.write_text(json.dumps({"snapshot_date": "2026-10-17", "studies": [raw_trial()]}))
    with pytest.raises(ValueError, match="matching snapshot_date"):
        import_snapshot(source, date(2017, 10, 17), "round_01", tmp_path, "test", "unspecified")
