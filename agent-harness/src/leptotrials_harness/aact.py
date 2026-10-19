"""True dated AACT flat-file ingestion; never substitute current registry text."""

import csv
import gzip
import hashlib
import json
import re
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path

from .logging_utils import now, write_json
from .trial_normalizer import normalize

RETRIEVAL_VERSION = "aact-sensitive-text-1.0.0"
IMPORT_VERSION = "aact-import-1.1.0"
SOURCE_DATE_FIELDS = (
    "first_received_date",
    "last_changed_date",  # legacy AACT snapshots
    "study_first_submitted_date",
    "study_first_posted_date",
    "last_update_submitted_date",
    "last_update_posted_date",
)
TABLES = {
    "studies": {"nct_id", "brief_title", "official_title", "overall_status", "phase", "study_type"},
    "eligibilities": {"nct_id", "criteria", "minimum_age", "maximum_age", "population"},
    "conditions": {"nct_id", "name"},
    "keywords": {"nct_id", "name"},
    "brief_summaries": {"nct_id", "description"},
    "detailed_descriptions": {"nct_id", "description"},
    "design_groups": {"id", "nct_id", "group_type", "title", "description"},
    "design_outcomes": {"nct_id", "outcome_type", "measure", "description", "time_frame"},
    "interventions": {"id", "nct_id", "intervention_type", "name", "description"},
    "design_group_interventions": {"nct_id", "design_group_id", "intervention_id"},
    "facilities": {"nct_id", "name", "city", "country"},
    "sponsors": {"nct_id", "name", "lead_or_collaborator"},
}
SCAN = (
    "studies",
    "eligibilities",
    "conditions",
    "keywords",
    "brief_summaries",
    "detailed_descriptions",
    "design_groups",
    "design_outcomes",
    "interventions",
)
LM = re.compile(
    r"\b(?:leptomening\w*|meningeal (?:metastas\w*|carcinomatosis|involvement|disease|"
    r"dissemination)|(?:neoplastic|lymphomatous|leukemic) meningitis)\b",
    re.I,
)
CNS = re.compile(
    r"\b(?:brain|CNS|central nervous system)\b.{0,100}"
    r"\b(?:metastas\w*|cohort|cancer|tumou?r|melanoma)\b|"
    r"\b(?:metastas\w*|cohort|cancer|tumou?r|melanoma)\b.{0,100}"
    r"\b(?:brain|CNS|central nervous system)\b",
    re.I | re.S,
)
ABBREVIATION = re.compile(r"\b(?:LM|LMD|LMC)\b", re.I)
ONCOLOGY = re.compile(
    r"\b(?:cancer|tumou?r|carcinoma|lymphoma|leukemia|metastas\w*|melanoma)\b", re.I
)


class FlatFiles:
    """Read only selected tables. ZIP members are never extracted to filesystem paths."""

    def __init__(self, source: Path):
        self.source = source
        self.archive = None if source.is_dir() else zipfile.ZipFile(source)
        names = list(source.glob("*.txt")) if source.is_dir() else self.archive.namelist()
        self.members = {}
        for item in names:
            name = Path(str(item)).name
            if name.removesuffix(".txt") in TABLES:
                if name in self.members:
                    raise ValueError(f"Duplicate archive table {name}")
                self.members[name] = item
        if set(f"{table}.txt" for table in TABLES) - set(self.members):
            raise ValueError("AACT archive is missing required protocol tables")
        self.hashes, self.counts = {}, {}

    def rows(self, table):
        name = table + ".txt"
        raw = (
            self.archive.open(self.members[name]) if self.archive else self.members[name].open("rb")
        )
        hasher = hashlib.sha256()
        count = 0
        csv.field_size_limit(64 * 1024 * 1024)
        with raw:

            def lines():
                for line in raw:
                    hasher.update(line)
                    yield line.decode("utf-8-sig" if raw.tell() == len(line) else "utf-8")

            reader = csv.DictReader(lines(), delimiter="|", strict=True)
            if not TABLES[table] <= set(reader.fieldnames or []):
                raise ValueError(f"Unsupported AACT column schema in {name}")
            if table == "studies" and not set(SOURCE_DATE_FIELDS) & set(reader.fieldnames):
                raise ValueError(
                    "Unsupported AACT source date columns; refusing unchecked snapshot"
                )
            for row in reader:
                if None in row or any(value is None for value in row.values()):
                    raise ValueError(f"Malformed delimited row in {name}")
                if not re.fullmatch(r"NCT\d{8}", row["nct_id"]):
                    raise ValueError(f"Invalid NCT identifier in {name}")
                count += 1
                yield row
        checksum = hasher.hexdigest()
        if name in self.hashes and self.hashes[name] != checksum:
            raise ValueError(f"Source table changed during import: {name}")
        self.hashes[name], self.counts[name] = checksum, count

    def close(self):
        if self.archive:
            self.archive.close()


def candidate_reason(text):
    if LM.search(text):
        return "explicit_lm_terminology"
    if ABBREVIATION.search(text) and ONCOLOGY.search(text):
        return "oncology_lm_abbreviation"
    if CNS.search(text):
        return "broad_cns_oncology_or_cohort"
    return None


def normalize_rows(nct, rows, reasons, cutoff):
    """Bridge source columns into the existing normalizer; not an API response capture."""
    study = rows["studies"][0]
    single = lambda table: rows[table][0] if rows[table] else {}  # noqa: E731
    eligibility = single("eligibilities")
    groups = {g["id"]: g for g in rows["design_groups"]}
    interventions = {item["id"]: item for item in rows["interventions"]}
    if len(groups) != len(rows["design_groups"]) or len(interventions) != len(
        rows["interventions"]
    ):
        raise ValueError("Duplicate cohort/intervention identifiers")
    linked = rows["design_group_interventions"]
    for link in linked:
        if link["design_group_id"] not in groups or link["intervention_id"] not in interventions:
            raise ValueError("AACT cohort/intervention relationship is incomplete")

    def outcomes(kind):
        return [
            {"measure": o["measure"], "description": o["description"], "timeFrame": o["time_frame"]}
            for o in rows["design_outcomes"]
            if o["outcome_type"].casefold() == kind
        ]

    bridge = {
        "protocolSection": {
            "identificationModule": {
                "nctId": nct,
                "briefTitle": study["brief_title"],
                "officialTitle": study["official_title"],
            },
            "statusModule": {
                "overallStatus": study["overall_status"],
                "lastUpdatePostDateStruct": {
                    "date": study.get("last_update_posted_date")
                    or study.get("last_changed_date", "")
                },
                "startDateStruct": {"date": study.get("start_date", "")},
            },
            "designModule": {
                "studyType": study["study_type"],
                "phases": study["phase"].split("/") if study["phase"] else [],
            },
            "conditionsModule": {
                "conditions": [r["name"] for r in rows["conditions"]],
                "keywords": [r["name"] for r in rows["keywords"]],
            },
            "descriptionModule": {
                "briefSummary": single("brief_summaries").get("description", ""),
                "detailedDescription": single("detailed_descriptions").get("description", ""),
            },
            "eligibilityModule": {
                "eligibilityCriteria": eligibility.get("criteria", ""),
                "studyPopulation": eligibility.get("population", ""),
                "minimumAge": eligibility.get("minimum_age", ""),
                "maximumAge": eligibility.get("maximum_age", ""),
                "sex": eligibility.get("gender", eligibility.get("sex", "")),
            },
            "armsInterventionsModule": {
                "armGroups": [
                    {
                        "label": g["title"],
                        "type": g["group_type"],
                        "description": g["description"],
                        "interventionNames": [
                            interventions[link["intervention_id"]]["name"]
                            for link in linked
                            if link["design_group_id"] == g["id"]
                        ],
                    }
                    for g in groups.values()
                ],
                "interventions": [
                    {
                        "type": item["intervention_type"],
                        "name": item["name"],
                        "description": item["description"],
                        "armGroupLabels": [
                            groups[link["design_group_id"]]["title"]
                            for link in linked
                            if link["intervention_id"] == item["id"]
                        ],
                    }
                    for item in interventions.values()
                ],
            },
            "outcomesModule": {
                "primaryOutcomes": outcomes("primary"),
                "secondaryOutcomes": outcomes("secondary"),
            },
            "contactsLocationsModule": {
                "locations": [
                    {
                        "facility": r["name"],
                        "city": r["city"],
                        "country": r["country"],
                        "status": r.get("status", ""),
                    }
                    for r in rows["facilities"]
                ]
            },
            "sponsorCollaboratorsModule": {
                "leadSponsor": {
                    "name": next(
                        (
                            r["name"]
                            for r in rows["sponsors"]
                            if r["lead_or_collaborator"].casefold() == "lead"
                        ),
                        "",
                    )
                }
            },
        }
    }
    return normalize(bridge, [f"AACT:{cutoff}:{reason}" for reason in sorted(reasons)])


def import_aact(
    source: Path, cutoff: date, round_id: str, destination: Path, provenance: str, progress=None
) -> dict:
    if not re.fullmatch(r"round_\d{2}", round_id):
        raise ValueError("Use round_01 through round_99")
    if not provenance.strip():
        raise ValueError("Archive provenance/source URL is required")
    if (destination / "manifests" / f"{round_id}.json").exists():
        raise FileExistsError("Historical round already exists; choose a new versioned destination")
    files = FlatFiles(source)
    selected, universe, source_dates_missing = defaultdict(set), set(), 0
    try:
        for table in SCAN:
            for row in files.rows(table):
                nct = row["nct_id"]
                if table == "studies":
                    if nct in universe:
                        raise ValueError("Duplicate study identifier in AACT snapshot")
                    universe.add(nct)
                    available_dates = [row[name] for name in SOURCE_DATE_FIELDS if row.get(name)]
                    source_dates_missing += not available_dates
                    for value in available_dates:
                        if date.fromisoformat(value[:10]) > cutoff:
                            raise ValueError("AACT record date is after the declared snapshot")
                elif nct not in universe:
                    raise ValueError("Orphan source row outside the snapshot study universe")
                reason = candidate_reason(" ".join(row.values()))
                if reason:
                    selected[nct].add(f"{table}:{reason}")
            if progress:
                progress(
                    {
                        "stage": "candidate_scan",
                        "table": table,
                        "rows": files.counts[table + ".txt"],
                        "candidates": len(selected),
                    }
                )
        records = {nct: {table: [] for table in TABLES} for nct in sorted(selected)}
        for table in TABLES:
            for row in files.rows(table):
                if row["nct_id"] in records:
                    records[row["nct_id"]][table].append(row)
            if progress:
                progress(
                    {
                        "stage": "source_join",
                        "table": table,
                        "rows": files.counts[table + ".txt"],
                        "candidates": len(selected),
                    }
                )
        for rows in records.values():
            if len(rows["studies"]) != 1 or any(
                len(rows[t]) > 1
                for t in ("eligibilities", "brief_summaries", "detailed_descriptions")
            ):
                raise ValueError("Unexpected duplicate singleton protocol rows")
        trials = [
            normalize_rows(nct, rows, selected[nct], cutoff).model_dump(mode="json")
            for nct, rows in records.items()
        ]
        folder = destination / "rounds" / round_id
        folder.mkdir(parents=True, exist_ok=True)
        inputs = folder / "inputs.json.gz"
        with gzip.open(inputs, "xt", encoding="utf-8") as stream:
            json.dump({"trials": trials}, stream, ensure_ascii=False)
        with gzip.open(folder / "source_rows.json.gz", "xt", encoding="utf-8") as stream:
            json.dump(records, stream, ensure_ascii=False)
        metadata = {
            "kind": "actual_aact_as_of_snapshot_new_evaluation_not_original_experiment",
            "imported_at": now(),
            "provenance": provenance,
            "retrieval_rule_version": RETRIEVAL_VERSION,
            "import_version": IMPORT_VERSION,
            "snapshot_studies_scanned": len(universe),
            "candidate_count": len(trials),
            "studies_without_source_dates": source_dates_missing,
            "checked_source_date_fields": list(SOURCE_DATE_FIELDS),
            "table_sha256": files.hashes,
            "table_row_counts": files.counts,
            "limitations": "Offline text matching, not historical registry search indexing. "
            "AACT text may already be whitespace-flattened. Original rows are preserved. "
            "last_update_date maps to AACT last_update_posted_date when available, otherwise "
            "legacy last_changed_date (not represented as an API post date). "
            "No expert reference labels or held-out split are inferred.",
        }
        manifest = {
            "round_id": round_id,
            "state": "ready",
            "role": "new_aact_snapshot_evaluation",
            "snapshot_date": cutoff.isoformat(),
            "snapshot_source": metadata,
            "inputs": f"../rounds/{round_id}/inputs.json.gz",
            "inputs_sha256": hashlib.sha256(inputs.read_bytes()).hexdigest(),
            "candidate_ids": [t["nct_id"] for t in trials],
            "adjudications": None,
            "not_original_paper_validation": True,
        }
        write_json(folder / "metadata.json", metadata)
        write_json(destination / "manifests" / f"{round_id}.json", manifest)
        return {
            "manifest": str(destination / "manifests" / f"{round_id}.json"),
            "snapshot_date": cutoff.isoformat(),
            "universe": len(universe),
            "candidates": len(trials),
        }
    finally:
        files.close()
