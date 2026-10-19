"""Separate immutable expert decisions and reviewer-friendly CSV/Markdown packets."""

import csv
import io
import json
from pathlib import Path

from .logging_utils import digest, read_json, write_json
from .models import Adjudication


def load_decisions(run_dir: Path) -> list[dict]:
    manifest = read_json(run_dir / "manifest.json")
    records = [read_json(run_dir / "decisions" / f"{nct}.json") for nct in manifest["record_ids"]]
    if manifest["count"] != len(records) or manifest["records_hash"] != digest(records):
        raise ValueError("Run integrity check failed")
    return records


def load_adjudications(path: Path) -> list[Adjudication]:
    files = sorted(path.glob("*.json")) if path.is_dir() else [path]
    rows = []
    for file in files:
        data = read_json(file)
        for row in data if isinstance(data, list) else [data]:
            rows.append(Adjudication.model_validate_json(json.dumps(row)))
    keys = [(r.run_id, r.nct_id) for r in rows]
    if len(keys) != len(set(keys)):
        raise ValueError("Conflicting/duplicate adjudications; select a resolved adjudication file")
    return rows


def check_adjudication(record: dict, expert: Adjudication) -> None:
    if (record["nct_id"], record["run_id"], record["input_hash"], record["decision_hash"]) != (
        expert.nct_id,
        expert.run_id,
        expert.input_hash,
        expert.decision_hash,
    ):
        raise ValueError("Expert decision refers to a different record revision or model decision")
    if not expert.source_checked:
        raise ValueError("Expert must check underlying source record")
    result = record.get("result")
    if expert.disposition == "approve" and (
        not result or result["classification"] != expert.expert_classification.value
    ):
        raise ValueError("Approval must match original classification; use change for corrections")


def adjudicate(run_dir: Path, path: Path, store: Path) -> list[dict]:
    records = {r["nct_id"]: r for r in load_decisions(run_dir)}
    experts = load_adjudications(path)
    for expert in experts:
        check_adjudication(records[expert.nct_id], expert)
    # Validate the whole import before creating any files. Original model output is untouched.
    for expert in experts:
        write_json(
            store
            / f"{expert.run_id}_{expert.nct_id}_{digest(expert.model_dump(mode='json'))[:12]}.json",
            expert.model_dump(mode="json"),
        )
    return [e.model_dump(mode="json") for e in experts]


def csv_safe(value) -> str:
    text = str(value) if value is not None else ""
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


def create_audit_batch(output_root: Path, since: str, output: Path) -> int:
    records = []
    for manifest in sorted((output_root / "runs").glob("*/manifest.json")):
        records.extend(r for r in load_decisions(manifest.parent) if r["timestamp"][:10] >= since)
    stream = io.StringIO()
    writer = csv.writer(stream)
    writer.writerow(
        [
            "NCT ID",
            "title",
            "classification",
            "classification pathway",
            "review status",
            "review reason / failure",
            "evidence",
            "conflicting evidence",
            "source",
            "model",
            "prompt version",
            "date classified",
            "run_id",
            "input_hash",
            "decision_hash",
            "expert decision",
            "agreement",
            "notes",
        ]
    )
    for r in records:
        result = r["result"] or {}
        evidence = lambda key, result=result: " | ".join(  # noqa: E731
            f"{e['field']} [{e['cohort'] or 'study'}]: {e['quote']}" for e in result.get(key, [])
        )
        writer.writerow(
            [
                csv_safe(v)
                for v in [
                    r["nct_id"],
                    r["title"],
                    r["classification"],
                    r["pipeline_stage"],
                    r["status"],
                    r.get("safety_review_reason") or r.get("error") or "",
                    evidence("evidence"),
                    evidence("conflicting_evidence"),
                    r["source_url"],
                    r["model_id"],
                    r["prompt_version"],
                    r["timestamp"],
                    r["run_id"],
                    r["input_hash"],
                    r["decision_hash"],
                    "",
                    "",
                    "",
                ]
            ]
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as file:
        file.write(stream.getvalue())
    return len(records)


def review_packet(run_dir: Path, output: Path) -> None:
    lines = [
        "# Registry-level LM review packet",
        "",
        "Research candidate decisions; not deployed.",
        "",
    ]
    for r in load_decisions(run_dir):
        lines += [
            f"## {r['nct_id']}: {r['title']}",
            "",
            f"Source: {r['source_url']}",
            f"Proposed: {r['classification'] or r['status']} ({r['pipeline_stage']})",
            f"Review status: {r['status']}",
            f"Run ID: `{r['run_id']}`",
            "",
        ]
        if r.get("safety_review_reason") or r.get("error"):
            lines += [f"Review warning: {r.get('safety_review_reason') or r['error']}", ""]
        if r.get("result"):
            lines += [r["result"]["primary_reason"], ""]
        else:
            for attempt in r.get("attempts", []):
                error = attempt.get("error") or {}
                lines += [
                    f"Attempt {attempt['attempt']}: {error.get('message', 'No final decision')}"
                ]
                for violation in error.get("violations", []):
                    lines += [f"- {violation['field']}: {violation['message']}"]
            lines += [""]
        for key in ("evidence", "conflicting_evidence"):
            for e in (r["result"] or {}).get(key, []):
                lines += [
                    f"{key} / {e['field']} / cohort: {e['cohort'] or 'unspecified'}",
                    "",
                    "> " + e["quote"].replace("\n", "\n> "),
                    "",
                    e["interpretation"],
                    "",
                ]
        lines += [f"Input hash: `{r['input_hash']}`", f"Decision hash: `{r['decision_hash']}`", ""]
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as file:
        file.write("\n".join(lines))
