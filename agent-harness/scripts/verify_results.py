"""Verify a consolidated results bundle without registry or model requests."""

import argparse
import hashlib
from collections import Counter
from pathlib import Path

from leptotrials_harness.evidence import verify_evidence
from leptotrials_harness.execution import checked_record
from leptotrials_harness.logging_utils import digest, read_json
from leptotrials_harness.models import ClassificationOutput


def verify_bundle(bundle: Path) -> dict:
    bundle = bundle.resolve()
    manifest = read_json(bundle / "manifest.json")
    for name, expected in manifest["files"].items():
        path = (bundle / name).resolve()
        if not path.is_relative_to(bundle):
            raise ValueError("Bundle path escapes its directory")
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Checksum mismatch: {name}")
    results = read_json(bundle / "results.json")
    if digest(results["records"]) != manifest["record_index_hash"]:
        raise ValueError("Record index fingerprint mismatch")
    identities, revisions, nct_ids = set(), set(), set()
    implementations = {}
    classes, review_count = Counter(), 0
    for item in results["records"]:
        key = (item["original_run_id"], item["nct_id"])
        if key in identities:
            raise ValueError("Duplicate original record-round")
        identities.add(key)
        run = (bundle / item["evidence_directory"]).resolve()
        if not run.is_relative_to(bundle):
            raise ValueError("Evidence path escapes bundle")
        row, trial = checked_record(run / "decisions" / f"{item['nct_id']}.json", run)
        if row["error"] or row["input_hash"] != item["input_hash"]:
            raise ValueError("Failed or mismatched decision")
        result = ClassificationOutput.model_validate_json(
            (run / "results" / f"{item['nct_id']}.json").read_text()
        )
        if result.model_dump(mode="json") != row["result"]:
            raise ValueError("Result differs from recorded decision")
        if not isinstance(result.is_lm_inclusive, bool):
            raise ValueError("Unresolved inclusion decision")
        verify_evidence(result, trial)
        metadata = read_json(run / "source-manifest.json")
        if metadata["run_id"] != row["run_id"]:
            raise ValueError("Source-run identity mismatch")
        if row["model_called"] and (result.model_version, result.prompt_version) != (
            metadata["model"]["model_id"],
            metadata["prompts"]["version"],
        ):
            raise ValueError("Model or prompt provenance mismatch")
        version = metadata["prompts"]["version"]
        if version not in implementations:
            code = bundle / "implementations" / version / "src/leptotrials_harness"
            implementations[version] = digest(
                {p.name: p.read_text() for p in sorted(code.glob("*.py"))}
            )
        if implementations[version] != metadata["implementation_hash"]:
            raise ValueError("Frozen implementation differs from source run")
        if row["model_called"]:
            payload = read_json(run / "model_inputs" / f"{item['nct_id']}.json")
            if digest(payload) != row["model_input_hash"]:
                raise ValueError("Model payload fingerprint mismatch")
            if payload["input_projection"]["source_input_hash"] != row["input_hash"]:
                raise ValueError("Model payload refers to a different source revision")
        revisions.add(row["input_hash"])
        nct_ids.add(row["nct_id"])
        classes[result.classification.value] += 1
        review_count += bool(row["requires_review"])
    if len(identities) != manifest["record_count"]:
        raise ValueError("Result count differs from manifest")
    return {
        "record_rounds": len(identities),
        "unique_nct_ids": len(nct_ids),
        "unique_input_revisions": len(revisions),
        "failures": 0,
        "unresolved": 0,
        "review_flags": review_count,
        "classifications": dict(classes),
        "clinical_accuracy_verified": False,
    }


def main():
    import json

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    args = parser.parse_args()
    print(json.dumps(verify_bundle(args.bundle), indent=2))


if __name__ == "__main__":
    main()
