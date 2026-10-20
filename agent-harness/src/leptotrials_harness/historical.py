"""Retrospective subsets from the public API, and importing archived snapshots."""

import hashlib
from datetime import date
from pathlib import Path

from .clinicaltrials_api import RegistryClient, RegistryError
from .logging_utils import now, read_json, write_json
from .trial_normalizer import normalize


def capture_unchanged_round(
    client: RegistryClient, cutoff: date, round_id: str, destination: Path
) -> dict:
    """Records that haven't changed since the cutoff. Anything updated later is missing.

    Searches every status, since filtering on today's status would skew the old set.
    """
    advanced = (
        f"AREA[LastUpdatePostDate]RANGE[MIN,{cutoff.isoformat()}] AND "
        f"AREA[StudyFirstPostDate]RANGE[MIN,{cutoff.isoformat()}]"
    )
    by_id, searches = {}, []
    for query in client.config.searches:
        records = client.search(query.kind, query.value, [], advanced)
        reason = f"{query.kind}:{query.value}"
        searches.append({"query": reason, "advanced": advanced, "count": len(records)})
        for record in records:
            status = record.get("protocolSection", {}).get("statusModule", {})
            posted = (status.get("studyFirstPostDateStruct") or {}).get("date", "")
            updated = (status.get("lastUpdatePostDateStruct") or {}).get("date", "")
            if (
                not posted
                or not updated
                or date.fromisoformat(posted) > cutoff
                or date.fromisoformat(updated) > cutoff
            ):
                raise RegistryError("Registry record violates retrospective date bounds")
            trial = normalize(record, [reason])
            if trial.nct_id in by_id:
                by_id[trial.nct_id]["reasons"].append(reason)
            else:
                by_id[trial.nct_id] = {"raw": record, "reasons": [reason]}
    raw_records = [v["raw"] for v in by_id.values()]
    trials = [normalize(v["raw"], v["reasons"]).model_dump(mode="json") for v in by_id.values()]
    source = {
        "kind": "retrospective_unchanged_subset_not_full_historical_snapshot",
        "captured_at": now(),
        "cutoff": cutoff.isoformat(),
        "searches": searches,
        "source": "https://clinicaltrials.gov/api/v2/studies",
        "limitation": (
            "Excludes trials updated after cutoff; no historic candidate-retrieval recall claim."
        ),
    }
    folder = destination / "rounds" / round_id
    write_json(folder / "raw_records.json", {"source": source, "studies": raw_records})
    inputs = folder / "inputs.json"
    write_json(inputs, {"source": source, "trials": trials})
    manifest = {
        "round_id": round_id,
        "state": "ready",
        "role": "new_retrospective_subset_evaluation",
        "snapshot_date": cutoff.isoformat(),
        "snapshot_source": source,
        "inputs": f"../rounds/{round_id}/inputs.json",
        "inputs_sha256": hashlib.sha256(inputs.read_bytes()).hexdigest(),
        "candidate_ids": list(by_id),
        "adjudications": None,
        "not_original_paper_validation": True,
    }
    write_json(destination / "manifests" / f"{round_id}.json", manifest)
    return manifest


def import_snapshot(
    source: Path, cutoff: date, round_id: str, destination: Path, provenance: str, role: str
) -> dict:
    """Import an archived API v2 snapshot as-is."""
    data = read_json(source)
    if data.get("snapshot_date") != cutoff.isoformat() or not isinstance(data.get("studies"), list):
        raise ValueError(
            "Snapshot needs matching snapshot_date and a studies array of archived API-v2 records"
        )
    trials = [normalize(s, ["archived_snapshot"]).model_dump(mode="json") for s in data["studies"]]
    ids = [t["nct_id"] for t in trials]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate historical NCT IDs")
    folder = destination / "rounds" / round_id
    inputs = folder / "inputs.json"
    write_json(folder / "raw_records.json", data)
    write_json(inputs, {"trials": trials})
    manifest = {
        "round_id": round_id,
        "state": "ready",
        "role": role,
        "snapshot_date": cutoff.isoformat(),
        "snapshot_source": provenance,
        "raw_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "inputs": f"../rounds/{round_id}/inputs.json",
        "inputs_sha256": hashlib.sha256(inputs.read_bytes()).hexdigest(),
        "candidate_ids": ids,
        "adjudications": None,
    }
    write_json(destination / "manifests" / f"{round_id}.json", manifest)
    return manifest
