"""Build the dated AACT evaluation rounds and smaller development samples.

Offline, and it never overwrites the original captures.
"""

import argparse
import gzip
import hashlib
import json
import re
import shutil
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from leptotrials_harness.aact import LM, TABLES
from leptotrials_harness.logging_utils import digest, now, read_json, write_json
from leptotrials_harness.structured_input import content_hash
from leptotrials_harness.validation import load_round

SAMPLER_VERSION = "observable-text-strata-1.0.0"
BUCKETS = (
    "cohort_language",
    "negative_or_qualified",
    "title_or_condition_lm",
    "eligibility_lm",
    "other_broad_candidate",
)


def fingerprint(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def bucket(trial) -> str:
    """Signals visible in the source text. These are not expected labels."""
    signals = trial.deterministic_signals
    if signals.lm_terms_in_arm_text or signals.possible_lm_cohort:
        return "cohort_language"
    if signals.negative_lm_phrases or signals.lm_terms_in_exclusion:
        return "negative_or_qualified"
    if signals.lm_terms_in_title or signals.lm_terms_in_conditions:
        return "title_or_condition_lm"
    if signals.lm_terms_in_inclusion or LM.search(trial.eligibility.population):
        return "eligibility_lm"
    return "other_broad_candidate"


def select_sample(trials, round_id: str, seed: str, count: int):
    if not 1 <= count <= 100 or len(trials) < count:
        raise ValueError("Sample size must be 1–100 and no larger than the source population")
    if len({trial.nct_id for trial in trials}) != len(trials):
        raise ValueError("Duplicate source IDs cannot enter sampling")
    groups = defaultdict(list)

    def rank(trial):
        return hashlib.sha256(f"{seed}\0{round_id}\0{trial.nct_id}".encode()).hexdigest()

    for trial in trials:
        groups[bucket(trial)].append(trial)
    selected = {}
    for key in BUCKETS:
        if groups[key] and len(selected) < count:
            item = min(groups[key], key=rank)
            selected[item.nct_id] = item
    for item in sorted(trials, key=rank):
        if len(selected) == count:
            break
        selected.setdefault(item.nct_id, item)
    chosen = [selected[key] for key in sorted(selected)]
    return chosen, {
        "version": SAMPLER_VERSION,
        "seed": seed,
        "requested_count": count,
        "source_count": len(trials),
        "population_strata": {k: len(groups[k]) for k in BUCKETS},
        "selected_strata": dict(Counter(bucket(t) for t in chosen)),
        "method": "One hash-ranked record per nonempty observable-text stratum, then hash-ranked "
        "fill without replacement. Ranking is SHA-256(seed NUL round_id NUL NCT ID).",
        "selection": [
            {"nct_id": t.nct_id, "input_hash": content_hash(t), "stratum": bucket(t)}
            for t in chosen
        ],
        "limitation": "Small stratified DEVELOPMENT smoke sample, not proportional random "
        "sampling, independent clinical labels, held-out evaluation, or full-population inference.",
    }


def build_collection(recipe_path: Path, destination: Path, count: int, seed: str) -> dict:
    recipe = read_json(recipe_path)
    ids = [r["round_id"] for r in recipe["rounds"]]
    if ids != [f"round_{i:02d}" for i in range(1, 11)]:
        raise ValueError("Source recipe must contain exactly ten distinct ordered rounds")
    if not seed.strip():
        raise ValueError("An explicit reproducible seed is required")
    destination.mkdir(parents=True, exist_ok=False)
    rounds, all_ids, revisions = [], set(), set()
    for item in recipe["rounds"]:
        source = (recipe_path.parent / item["manifest"]).resolve()
        original, trials, truth = load_round(source)
        nct_round = item["round_id"]
        if original["round_id"] != nct_round or not re.fullmatch(r"round_\d{2}", nct_round):
            raise ValueError("Source round identity mismatch")
        if truth or original.get("adjudications"):
            raise ValueError("This source-reconciliation recipe does not import expert labels")
        metadata = original["snapshot_source"]
        if not metadata.get("kind", "").startswith("actual_aact_as_of_snapshot"):
            raise ValueError("Only genuine AACT sources belong in this collection")
        if metadata.get("import_version") == "aact-import-1.1.0":
            missing = metadata["studies_without_source_dates"]
        elif original["snapshot_date"] == "2017-10-17":
            missing = metadata["source_date_values_missing"]
        else:
            raise ValueError(
                "Superseded date-column imports cannot enter the reconciled collection"
            )
        names = {f"{table}.txt" for table in TABLES}
        if missing or set(metadata["table_sha256"]) != names:
            raise ValueError("Missing date checks or required source table fingerprints")
        cutoff = date.fromisoformat(original["snapshot_date"])
        for trial in trials:
            if trial.last_update_date and date.fromisoformat(trial.last_update_date[:10]) > cutoff:
                raise ValueError("Normalized record date exceeds declared archive date")
        folder = destination / "full/rounds" / nct_round
        folder.mkdir(parents=True)
        source_inputs = (source.parent / original["inputs"]).resolve()
        raw_rows = source_inputs.parent / "source_rows.json.gz"
        if not raw_rows.is_file():
            raise ValueError("Original archived source rows are missing")
        for path in (source_inputs, raw_rows):
            shutil.copy2(path, folder / path.name)
        provenance = {
            "original_manifest": str(source),
            "original_manifest_sha256": fingerprint(source),
            "collection_recipe_sha256": fingerprint(recipe_path),
            "source_rows_sha256": fingerprint(folder / raw_rows.name),
        }
        clean = {
            **original,
            "role": "new_reconciled_aact_source_collection",
            "inputs": f"../rounds/{nct_round}/inputs.json.gz",
            "collection_id": recipe["collection_id"],
            "reconciliation": provenance,
            "source_rows": f"../rounds/{nct_round}/source_rows.json.gz",
            "source_rows_sha256": provenance["source_rows_sha256"],
        }
        if fingerprint(folder / source_inputs.name) != clean["inputs_sha256"]:
            raise ValueError("Copied source input checksum differs")
        write_json(folder / "metadata.json", metadata)
        write_json(destination / "full/manifests" / f"{nct_round}.json", clean)
        chosen, sampling = select_sample(trials, nct_round, seed, count)
        sample_folder = destination / "development/rounds" / nct_round
        sample_folder.mkdir(parents=True)
        sample_inputs = sample_folder / "inputs.json.gz"
        with gzip.open(sample_inputs, "xt", encoding="utf-8") as stream:
            json.dump({"trials": [t.model_dump(mode="json") for t in chosen]}, stream)
        sample = {
            "round_id": nct_round,
            "state": "ready",
            "role": "stratified_development_smoke",
            "snapshot_date": original["snapshot_date"],
            "snapshot_source": metadata,
            "inputs": f"../rounds/{nct_round}/inputs.json.gz",
            "inputs_sha256": fingerprint(sample_inputs),
            "candidate_ids": [t.nct_id for t in chosen],
            "adjudications": None,
            "sampling": sampling,
            "source_manifest_sha256": digest(clean),
            "collection_id": recipe["collection_id"],
            "not_original_paper_validation": True,
            "not_full_population_inference": True,
        }
        write_json(destination / "development/manifests" / f"{nct_round}.json", sample)
        # load them back with the real loader to make sure they work
        load_round(destination / "full/manifests" / f"{nct_round}.json")
        load_round(destination / "development/manifests" / f"{nct_round}.json")
        all_ids.update(t.nct_id for t in chosen)
        revisions.update((t.nct_id, content_hash(t)) for t in chosen)
        row = {
            "round_id": nct_round,
            "date": cutoff.isoformat(),
            "candidates": len(trials),
            "development_sample": len(chosen),
            "population_strata": sampling["population_strata"],
        }
        rounds.append(row)
        print(json.dumps(row), flush=True)
    result = {
        "state": "complete",
        "created_at": now(),
        "collection_id": recipe["collection_id"],
        "recipe": recipe,
        "recipe_sha256": fingerprint(recipe_path),
        "rounds": rounds,
        "full_record_round_pairs": sum(r["candidates"] for r in rounds),
        "development_record_round_pairs": sum(r["development_sample"] for r in rounds),
        "development_unique_nct_ids": len(all_ids),
        "development_unique_revisions": len(revisions),
        "sampling_seed": seed,
        "sampling_version": SAMPLER_VERSION,
        "expert_metrics": None,
        "note": "Complete SOURCE reconciliation; model-backed sample execution is a separate step. "
        "Repeated NCT IDs are not independent trials. No clinical reference labels were invented.",
    }
    write_json(destination / "collection.json", result)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--per-round", type=int, default=5)
    parser.add_argument("--seed", required=True)
    args = parser.parse_args()
    build_collection(args.recipe, args.destination, args.per_round, args.seed)
