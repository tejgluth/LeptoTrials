import hashlib
import importlib.util
import io
import json
import re
import sys
import zipfile
from pathlib import Path

import httpx
import pytest

from leptotrials_harness.aact import TABLES


def helper():
    path = Path(__file__).resolve().parents[1] / "scripts/inspect_aact_archive.py"
    spec = importlib.util.spec_from_file_location("archive_helper", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_range_reader_reads_zip_members_without_full_download(monkeypatch):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("studies.txt", "nct_id|brief_title\nNCT01234567|LM study\n")
        archive.writestr("unneeded-results.bin", bytes(range(256)) * 8192)
    payload = buffer.getvalue()
    factory = httpx.Client

    def respond(request):
        match = re.fullmatch(r"bytes=(\d+)-(\d+)", request.headers["range"])
        start, end = map(int, match.groups())
        return httpx.Response(
            206,
            headers={"Content-Range": f"bytes {start}-{end}/{len(payload)}"},
            content=payload[start : end + 1],
        )

    module = helper()
    monkeypatch.setattr(
        module.httpx,
        "Client",
        lambda **kwargs: factory(transport=httpx.MockTransport(respond), **kwargs),
    )
    with module.RemoteArchive("https://archive.example.org/public.zip", block_size=256) as reader:
        with zipfile.ZipFile(reader) as archive:
            assert archive.read("studies.txt").startswith(b"nct_id")
        assert reader.transferred < 2048


def test_range_reader_rejects_servers_that_ignore_range(monkeypatch):
    module = helper()
    factory = httpx.Client
    monkeypatch.setattr(
        module.httpx,
        "Client",
        lambda **kwargs: factory(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, content=b"not a range")),
            **kwargs,
        ),
    )
    with pytest.raises(ValueError, match="range requests"):
        module.RemoteArchive("https://archive.example.org/public.zip")


def test_protocol_transfer_uses_basenames_and_writes_verified_completion(tmp_path, monkeypatch):
    archive = tmp_path / "source.zip"
    with zipfile.ZipFile(archive, "w") as file:
        for table, fields in TABLES.items():
            file.writestr(f"nested/{table}.txt", "|".join(sorted(fields)) + "\n")
        file.writestr("central_contacts.txt", "Not needed by the classifier")
    destination = tmp_path / "tables"
    module = helper()
    monkeypatch.setattr(
        sys, "argv", ["helper", str(archive), "--download-protocol-tables", str(destination)]
    )
    module.main()
    metadata = json.loads((destination / "aact-transfer.json").read_text())
    assert metadata["complete"] is True
    assert set(metadata["table_sha256"]) == {name + ".txt" for name in TABLES}
    assert not (destination / "central_contacts.txt").exists()
    assert not list(destination.glob("*.part"))
    with pytest.raises(FileExistsError):
        module.main()


def test_history_preparation_rejects_changed_or_incomplete_source_tables(tmp_path):
    path = Path(__file__).resolve().parents[1] / "scripts/prepare_aact_history.py"
    spec = importlib.util.spec_from_file_location("history_helper", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    url = "https://archive.example.org/public.zip"
    hashes = {}
    for table in TABLES:
        name = f"{table}.txt"
        payload = b"synthetic fixture\n"
        (tmp_path / name).write_bytes(payload)
        hashes[name] = hashlib.sha256(payload).hexdigest()
    receipt = {"complete": True, "source": url, "table_sha256": hashes}
    (tmp_path / "aact-transfer.json").write_text(json.dumps(receipt))
    module.verify_transfer(tmp_path, url)
    (tmp_path / "studies.txt").write_text("changed")
    with pytest.raises(ValueError, match="checksum changed"):
        module.verify_transfer(tmp_path, url)
    receipt["complete"] = False
    (tmp_path / "aact-transfer.json").write_text(json.dumps(receipt))
    with pytest.raises(ValueError, match="Incomplete"):
        module.verify_transfer(tmp_path, url)


def test_local_zip_origin_check_binds_receipt_and_rejects_mismatches(tmp_path, monkeypatch):
    path = tmp_path / "download.zip"
    with zipfile.ZipFile(path, "w") as file:
        for table, fields in TABLES.items():
            file.writestr(f"{table}.txt", "|".join(sorted(fields)) + "\n")
    module = helper()
    payload = path.read_bytes()

    def reader(url):
        result = io.BytesIO(payload)
        result.size, result.transferred = len(payload), 123
        return result

    monkeypatch.setattr(module, "RemoteArchive", reader)
    url = "https://archive.example.org/public.zip"
    destination = tmp_path / "tables"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "helper",
            str(path),
            "--verify-public-origin",
            url,
            "--download-protocol-tables",
            str(destination),
        ],
    )
    module.main()
    receipt = json.loads((destination / "aact-transfer.json").read_text())
    assert receipt["source"] == url
    assert receipt["local_archive"]["sha256"] == hashlib.sha256(payload).hexdigest()
    assert receipt["network_bytes"] == 123
    with zipfile.ZipFile(path, "a") as file:
        file.writestr("unexpected.txt", "Mismatch")
    with zipfile.ZipFile(path) as file, pytest.raises(ValueError, match="does not match"):
        module.verify_local_origin(path, file, url)


def test_history_preparation_updates_progress_without_model_calls(tmp_path, monkeypatch):
    path = Path(__file__).resolve().parents[1] / "scripts/prepare_aact_history.py"
    spec = importlib.util.spec_from_file_location("history_helper", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    plan = tmp_path / "plan.json"
    plan.write_text(
        json.dumps(
            {
                "accessed": "2026-10-18",
                "rounds": [
                    {
                        "round_id": "round_01",
                        "date": "2017-10-17",
                        "download": "https://example.org/archive",
                        "public_archive": "https://example.org/file.zip",
                    }
                ],
            }
        )
    )
    source = tmp_path / "sources/2017-10-17"
    source.mkdir(parents=True)
    (source / "aact-transfer.json").write_text("{}")
    monkeypatch.setattr(module, "verify_transfer", lambda *args: None)
    commands = []
    monkeypatch.setattr(
        module.subprocess, "run", lambda command, **kwargs: commands.append(command)
    )
    output = tmp_path / "verification"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "prepare",
            "--plan",
            str(plan),
            "--rounds",
            "round_01",
            "--source-root",
            str(tmp_path / "sources"),
            "--destination",
            str(tmp_path / "imported"),
            "--verification-root",
            str(output),
        ],
    )
    module.main()
    status = json.loads((output / "status.json").read_text())
    assert status["state"] == "complete"
    assert status["rounds"][0]["state"] == "dry_run_passed"
    assert status["model_calls"] == 0
    assert len(commands) == 2
    assert "import-aact" in commands[0]
    assert "validate" in commands[1] and "--dry-run" in commands[1]
    with pytest.raises(FileExistsError):
        module.main()
