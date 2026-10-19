"""Download/import dated public AACT protocol tables and verify routing, never call models.

Run from agent-harness. Downloads require internet; once imported, dry runs are offline.
Each subprocess has a finite timeout. Failed stages stop the workflow, retaining logs.
"""

import argparse
import hashlib
import json
import subprocess
import sys
import uuid
from pathlib import Path

from leptotrials_harness.aact import TABLES
from leptotrials_harness.logging_utils import now


def save_status(path: Path, summary: dict) -> None:
    """Replace only this workflow's mutable progress pointer, not research artifacts."""
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    with temporary.open("x") as stream:
        json.dump(summary, stream, indent=2)
        stream.write("\n")
    temporary.replace(path)


def verify_transfer(folder: Path, url: str) -> None:
    receipt = json.loads((folder / "aact-transfer.json").read_text())
    expected = {f"{table}.txt" for table in TABLES}
    if not receipt.get("complete") or receipt.get("source") != url:
        raise ValueError("Incomplete or mismatched transfer receipt")
    if set(receipt["table_sha256"]) != expected:
        raise ValueError("Incomplete source table set")
    for name in sorted(expected):
        with (folder / name).open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != receipt["table_sha256"][name]:
            raise ValueError(f"Source table checksum changed: {name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--rounds", nargs="+", required=True)
    parser.add_argument("--source-root", type=Path, default=Path("output/aact-source"))
    parser.add_argument("--destination", type=Path, default=Path("output/aact-historical"))
    parser.add_argument("--verification-root", type=Path, required=True)
    args = parser.parse_args()
    plan = json.loads(args.plan.read_text())
    rounds = {r["round_id"]: r for r in plan["rounds"]}
    if len(rounds) != len(plan["rounds"]) or set(args.rounds) - set(rounds):
        raise ValueError("Unknown or duplicated source round")
    args.verification_root.mkdir(parents=True, exist_ok=False)
    summary = {"started_at": now(), "state": "running", "model_calls": 0, "rounds": []}

    def stage(command, log):
        with log.open("x") as stream:
            subprocess.run(
                command, stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=7200
            )

    try:
        for round_id in args.rounds:
            item = rounds[round_id]
            folder = args.source_root / item["date"]
            current = {"round_id": round_id, "date": item["date"], "state": "started"}
            summary["rounds"].append(current)
            save_status(args.verification_root / "status.json", summary)
            if not (folder / "aact-transfer.json").exists():
                stage(
                    [
                        sys.executable,
                        "scripts/inspect_aact_archive.py",
                        item["public_archive"],
                        "--download-protocol-tables",
                        str(folder),
                    ],
                    args.verification_root / f"{round_id}-download.log",
                )
            verify_transfer(folder, item["public_archive"])
            current["state"] = "source_verified"
            save_status(args.verification_root / "status.json", summary)
            manifest = args.destination / "manifests" / f"{round_id}.json"
            # A fresh acquisition run never trusts a pre-existing imported manifest.
            # Import into another destination instead of silently reusing it.
            if manifest.exists():
                raise FileExistsError(f"Existing round: {manifest}; choose a new destination")
            stage(
                [
                    sys.executable,
                    "-m",
                    "leptotrials_harness",
                    "import-aact",
                    str(folder),
                    "--date",
                    item["date"],
                    "--round",
                    round_id,
                    "--destination",
                    str(args.destination),
                    "--provenance",
                    f"AACT snapshot {item['date']}; {item['download']}; public archive "
                    f"{item['public_archive']}; source plan accessed {plan['accessed']}",
                ],
                args.verification_root / f"{round_id}-import.log",
            )
            current["state"] = "imported"
            save_status(args.verification_root / "status.json", summary)
            stage(
                [
                    sys.executable,
                    "-m",
                    "leptotrials_harness",
                    "--output-root",
                    str(args.verification_root / "harness-output"),
                    "validate",
                    str(manifest),
                    "--dry-run",
                ],
                args.verification_root / f"{round_id}-dry-run.log",
            )
            current["state"] = "dry_run_passed"
            current["finished_at"] = now()
            save_status(args.verification_root / "status.json", summary)
        summary["state"] = "complete"
    except Exception as exc:
        summary["state"] = "failed"
        summary["error_type"] = type(exc).__name__
        raise
    finally:
        summary["finished_at"] = now()
        save_status(args.verification_root / "status.json", summary)


if __name__ == "__main__":
    main()
