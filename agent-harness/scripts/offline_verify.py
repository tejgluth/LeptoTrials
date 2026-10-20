"""One-off overnight verification run on macOS with a local Ollama model.

Schedule with ``.venv/bin/python scripts/offline_verify.py schedule --hours 8``.
The launch agent runs on its own and removes itself when done.
"""

import argparse
import hashlib
import json
import os
import plistlib
import shutil
import signal
import subprocess
import sys
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path


def timestamp():
    return datetime.now(UTC).isoformat()


def save(path, value):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def snapshot(source, destination):
    """Files that get copied into the job (no .env, output or credentials)."""
    names = (
        "src",
        "config",
        "prompts",
        "schemas",
        "tests",
        "scripts",
        "examples",
        "validation",
        "pyproject.toml",
        "requirements.lock",
        "README.md",
    )
    for name in names:
        item = source / name
        if item.is_dir():
            shutil.copytree(
                item,
                destination / name,
                ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", ".env", ".env.*"),
            )
        elif item.is_file():
            shutil.copy2(item, destination / name)
    hashes = {
        str(p.relative_to(destination)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(destination.rglob("*"))
        if p.is_file()
    }
    save(destination.parent / "snapshot-hashes.json", hashes)


def progress(output):
    counts, classes, unique = Counter(), Counter(), set()
    for path in output.glob("runs/*/decisions/*.json"):
        try:
            row = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        counts["record_round_decisions"] += 1
        counts[row.get("status", "unknown")] += 1
        counts["cache_hits"] += bool(row.get("cached"))
        counts["model_called_records"] += bool(row.get("model_called"))
        counts["review_required"] += bool(row.get("requires_review"))
        if row.get("result"):
            classes[row["result"]["classification"]] += 1
        unique.add(row["nct_id"])
    return {
        "counts": dict(counts),
        "classifications": dict(classes),
        "unique_nct_ids": len(unique),
        "completed_round_reports": len(list(output.glob("runs/*/validation.json"))),
        "expert_accuracy": None,
        "note": "Execution checks only; no independent expert ground truth is supplied.",
    }


def freeze_selected_rounds(manifests, destination):
    """Copy the selected manifests and their inputs into the job folder."""
    from leptotrials_harness.logging_utils import digest
    from leptotrials_harness.validation import load_round

    paths = sorted(manifests.glob("round_*.json"))
    if not paths:
        raise ValueError("No frozen round manifests were found")
    lineage = []
    for path in paths:
        manifest, _, truth = load_round(path)
        identifier = manifest["round_id"]
        if identifier != path.stem:
            raise ValueError("Manifest filename/round identity differs")
        if truth or manifest.get("adjudications"):
            raise ValueError("Local execution job does not copy private expert adjudications")
        inputs = (path.parent / manifest["inputs"]).resolve()
        folder = destination / "rounds" / identifier
        folder.mkdir(parents=True, exist_ok=False)
        input_name = "inputs.json.gz" if inputs.suffix == ".gz" else "inputs.json"
        shutil.copy2(inputs, folder / input_name)
        cloned = {
            **manifest,
            "inputs": f"../rounds/{identifier}/{input_name}",
            "frozen_from": {"path": str(path.resolve()), "manifest_hash": digest(manifest)},
        }
        target = destination / "manifests" / path.name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("x") as stream:
            json.dump(cloned, stream, indent=2)
        load_round(target)
        lineage.append(
            {
                "round": identifier,
                "source_manifest_hash": digest(manifest),
                "input_sha256": cloned["inputs_sha256"],
                "count": len(cloned["candidate_ids"]),
            }
        )
    return lineage


def stop_child(process):
    for sig, grace in ((signal.SIGINT, 15), (signal.SIGTERM, 5), (signal.SIGKILL, 2)):
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            process.wait()
            return
        try:
            process.wait(timeout=grace)
        except subprocess.TimeoutExpired:
            continue


def run(job):
    settings = json.loads((job / "job.json").read_text())
    if (job / "summary.json").exists():
        return 0
    deadline = settings["deadline_epoch"]
    frozen = job / "frozen-harness"
    output = job / "harness-output"
    python = settings["python"]
    # clean env: no API keys, proxies or .env
    env = {
        "PATH": settings["path"],
        "HOME": str(Path.home()),
        "TMPDIR": os.getenv("TMPDIR", "/tmp"),
        "LANG": "en_US.UTF-8",
        "PYTHONPATH": str(frozen / "src"),
        "PYTHONUNBUFFERED": "1",
        "HF_HUB_OFFLINE": "1",
        "PIP_NO_INDEX": "1",
        "NPM_CONFIG_OFFLINE": "true",
        "OTEL_SDK_DISABLED": "true",
        "DO_NOT_TRACK": "1",
    }
    cli = [python, "-m", "leptotrials_harness", "--config", "config/ollama.yaml"]
    model_cli = cli + ["--output-root", str(output)]
    phases = [
        ("python-tests", [python, "-m", "pytest", "-q"], frozen, 300),
        ("python-lint", [python, "-m", "ruff", "check", "."], frozen, 120),
        ("schema-contracts", cli + ["schemas", "--check"], frozen, 120),
        ("wheel-offline", [python, "-m", "build", "--wheel", "--no-isolation"], frozen, 180),
        ("application-check", [settings["npm"], "run", "check"], Path(settings["repo"]), 600),
        (
            "ten-round-dry-run",
            cli + ["--output-root", str(job / "dry-run-output"), "validate-all", "--dry-run"],
            frozen,
            600,
        ),
        (
            "local-smoke",
            model_cli + ["run-batch", "examples/local-smoke-inputs.json", "--workers", "1"],
            frozen,
            1200,
        ),
        (
            "ten-round-local-classification",
            model_cli + ["validate-all", "--workers", "1"],
            frozen,
            24 * 3600,
        ),
    ]
    if settings.get("selected_rounds"):
        selected = str(job / "selected-inputs/manifests")
        if settings.get("classification_only"):
            phases = [
                (
                    "selected-round-local-classification",
                    model_cli + ["validate-all", "--manifests", selected, "--workers", "1"],
                    frozen,
                    24 * 3600,
                )
            ]
        else:
            phases = [
                (
                    name,
                    command + ["--manifests", selected] if "validate-all" in command else command,
                    cwd,
                    allowance,
                )
                for name, command, cwd, allowance in phases
            ]
    if settings.get("post_inspection"):
        phases.append(
            ("post-inspection", [python, "scripts/inspect_review_cycle.py", str(job)], frozen, 120)
        )
    state = {
        "started_at": timestamp(),
        "pid": os.getpid(),
        "job": str(job),
        "deadline": settings["deadline"],
        "state": "running",
        "phases": [],
        "provider": "ollama",
        "cloud_api_calls_allowed": False,
    }
    interrupted = False

    def interrupted_signal(_signum, _frame):
        nonlocal interrupted
        interrupted = True

    signal.signal(signal.SIGTERM, interrupted_signal)
    signal.signal(signal.SIGINT, interrupted_signal)
    for name, command, cwd, allowance in phases:
        if interrupted or time.time() >= deadline - 25:
            break
        phase = {"name": name, "command": command, "started_at": timestamp()}
        state["phases"].append(phase)
        state["current_phase"] = name
        save(job / "status.json", state)
        # leave time to kill the child process before the deadline
        reserve = 120 if settings.get("post_inspection") and name != "post-inspection" else 0
        end = min(deadline - 25 - reserve, time.time() + allowance)
        with (job / f"{name}.log").open("a") as log:
            process = subprocess.Popen(
                command,
                cwd=cwd,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            phase["pid"] = process.pid
            while process.poll() is None and time.time() < end and not interrupted:
                state["heartbeat"] = timestamp()
                state["progress"] = progress(output)
                save(job / "status.json", state)
                time.sleep(min(15, max(0.1, end - time.time())))
            timed_out = process.poll() is None
            if timed_out:
                stop_child(process)
        phase.update(
            finished_at=timestamp(),
            exit_code=process.returncode,
            state="interrupted"
            if interrupted
            else "time_limit"
            if timed_out
            else "passed"
            if process.returncode == 0
            else "failed",
        )
        save(job / "status.json", state)
    state.update(finished_at=timestamp(), progress=progress(output))
    state["state"] = (
        "interrupted"
        if interrupted
        else "time_limit"
        if time.time() >= deadline - 25
        else "finished_with_failures"
        if any(p["state"] != "passed" for p in state["phases"])
        else "completed"
    )
    state["remaining_work"] = (
        "Inspect pending records and failed classifications separately; a failed phase "
        "does not mean its records were unprocessed. Expert review remains separate."
        if state["state"] != "completed"
        else "Independent expert adjudication remains required."
    )
    save(job / "status.json", state)
    save(job / "summary.json", state)
    return 0


def schedule(hours, until=None, manifests=None, classification_only=False, post_inspection=False):
    if classification_only and manifests is None:
        raise ValueError("--classification-only requires explicit --manifests")
    if until:
        target = datetime.fromisoformat(until)
        if target.tzinfo is None:
            raise ValueError("--until must include a timezone offset")
        deadline = target.timestamp()
        hours = (deadline - time.time()) / 3600
        if not 0 < hours <= 24:
            raise ValueError("Explicit deadline must be within the next 24 hours")
    else:
        if not 0 < hours <= 10:
            raise ValueError("Duration must be positive and at most ten hours")
        deadline = time.time() + hours * 3600
    source = Path(__file__).resolve().parents[1]
    identifier = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    job = source / "output" / "offline-jobs" / identifier
    job.mkdir(parents=True, exist_ok=False)
    frozen = job / "frozen-harness"
    frozen.mkdir()
    snapshot(source, frozen)
    selected_rounds = (
        freeze_selected_rounds(manifests.resolve(), job / "selected-inputs")
        if manifests is not None
        else None
    )
    label = f"com.leptotrials.offline-verification.{identifier.lower()}"
    plist = Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"
    if plist.exists():
        raise FileExistsError(plist)
    settings = {
        "created_at": timestamp(),
        "deadline_epoch": deadline,
        "deadline": datetime.fromtimestamp(deadline, UTC).isoformat(),
        "hours": hours,
        "label": label,
        "plist": str(plist),
        "repo": str(source.parent),
        "python": str(source / ".venv/bin/python"),
        "npm": shutil.which("npm"),
        "path": os.environ["PATH"],
        "snapshot": str(frozen),
        "no_credentials_copied": True,
        "network_policy": "Frozen files and local Ollama only; no downloads or registry retrieval.",
        "selected_rounds": selected_rounds,
        "classification_only": classification_only,
        "post_inspection": post_inspection,
    }
    if not settings["npm"]:
        raise RuntimeError("Existing local npm executable required")
    save(job / "job.json", settings)
    plist.parent.mkdir(parents=True, exist_ok=True)
    with plist.open("xb") as file:
        plistlib.dump(
            {
                "Label": label,
                "RunAtLoad": True,
                "KeepAlive": False,
                "WorkingDirectory": str(frozen),
                "ProcessType": "Background",
                "ProgramArguments": [
                    "/usr/bin/caffeinate",
                    "-ims",
                    "-t",
                    str(int(hours * 3600 + 45)),
                    settings["python"],
                    str(frozen / "scripts/offline_verify.py"),
                    "run",
                    "--job",
                    str(job),
                ],
                "StandardOutPath": str(job / "launchd.stdout.log"),
                "StandardErrorPath": str(job / "launchd.stderr.log"),
            },
            file,
        )
    subprocess.run(["/bin/launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)], check=True)
    print(
        json.dumps(
            {
                "job": str(job),
                "label": label,
                "deadline": settings["deadline"],
                "status": str(job / "status.json"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("schedule")
    duration = create.add_mutually_exclusive_group()
    duration.add_argument("--hours", type=float, default=8)
    duration.add_argument(
        "--until", help="Absolute deadline with timezone, e.g. 2026-10-18T11:00:00-07:00"
    )
    execute = commands.add_parser("run")
    create.add_argument("--manifests", type=Path, help="Freeze these explicitly selected rounds")
    create.add_argument(
        "--classification-only",
        action="store_true",
        help="Only classify supplied rounds, not the legacy verification sweep",
    )
    create.add_argument(
        "--post-inspection",
        action="store_true",
        help="Also inspect artifacts and compare any supplied live baseline",
    )
    execute.add_argument("--job", type=Path, required=True)
    args = parser.parse_args()
    sys.exit(
        run(args.job.resolve())
        if args.command == "run"
        else schedule(
            args.hours, args.until, args.manifests, args.classification_only, args.post_inspection
        )
    )
