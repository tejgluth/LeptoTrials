"""JSON helpers, hashing and write-once files."""

import gzip
import hashlib
import json
import subprocess
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def now() -> str:
    return datetime.now(UTC).isoformat()


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(value: Any) -> str:
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def read_json(path: Path) -> Any:
    return (
        json.loads(gzip.decompress(path.read_bytes()))
        if path.suffix == ".gz"
        else json.loads(path.read_text())
    )


def write_json(path: Path, value: Any) -> None:
    """Write a new file, fail if it already exists."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as file:
        json.dump(value, file, indent=2, ensure_ascii=False)
        file.write("\n")


def git_state() -> dict:
    def git(*args):
        try:
            return subprocess.check_output(
                ["git", *args], stderr=subprocess.DEVNULL, text=True, timeout=5
            ).strip()
        except (OSError, subprocess.SubprocessError):
            return None

    return {"commit": git("rev-parse", "HEAD"), "dirty": bool(git("status", "--porcelain"))}


def new_run_id() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ_") + uuid.uuid4().hex[:12]
