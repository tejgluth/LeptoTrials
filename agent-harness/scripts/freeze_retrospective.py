"""Freeze retrospective API inputs into one deduplicated archive."""

import argparse
import gzip
import hashlib
from pathlib import Path

from leptotrials_harness.logging_utils import canonical, digest, read_json, write_json


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    records, rounds = {}, []
    for path in sorted((args.source / "manifests").glob("round_*.json")):
        manifest = read_json(path)
        inputs = read_json(path.parent / manifest["inputs"])
        keys = []
        for trial in inputs["trials"]:
            key = digest(trial)
            records[key] = trial
            keys.append(key)
        rounds.append(
            {**manifest, "input_keys": keys, "inputs": "../records/registry-inputs.json.gz"}
        )
    archive = args.destination / "records/registry-inputs.json.gz"
    archive.parent.mkdir(parents=True, exist_ok=True)
    with archive.open("xb") as file:
        file.write(gzip.compress(canonical({"records": records}).encode(), mtime=0))
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    for manifest in rounds:
        manifest["inputs_sha256"] = checksum
        write_json(args.destination / "manifests" / f"{manifest['round_id']}.json", manifest)
        write_json(
            args.destination / "rounds" / manifest["round_id"] / "metadata.json",
            {k: v for k, v in manifest.items() if k not in ("input_keys", "candidate_ids")},
        )
    print(
        {
            "rounds": len(rounds),
            "unique_normalized_records": len(records),
            "record_round_pairs": sum(len(r["candidate_ids"]) for r in rounds),
            "archive_bytes": archive.stat().st_size,
            "sha256": checksum,
        }
    )


if __name__ == "__main__":
    main()
