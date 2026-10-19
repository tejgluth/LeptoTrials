import csv
from datetime import date
from pathlib import Path

import pytest

from leptotrials_harness.aact import TABLES, import_aact
from leptotrials_harness.validation import load_round


def table_files(folder: Path, future=False, duplicate=False):
    folder.mkdir()
    ids = ["NCT01234561", "NCT01234562", "NCT01234563"]
    rows = {name: [] for name in TABLES}
    rows["studies"] = [
        {
            "nct_id": nct,
            "brief_title": title,
            "phase": "Phase 1/Phase 2",
            "last_changed_date": "2026-01-01" if future else "2017-01-01",
            "first_received_date": "2016-01-01",
        }
        for nct, title in zip(
            ids, ["Lung cancer study", "Brain metastases cohort", "Migraine"], strict=True
        )
    ]
    rows["eligibilities"] = [
        {
            "nct_id": ids[0],
            "population": "Adults with leptomeningeal disease — stable.",
            "criteria": "Inclusion Criteria:\nGeneral criteria",
            "gender": "All",
        },
        {"nct_id": ids[1], "criteria": "Cohort C: patients with LM may enroll.", "gender": "All"},
    ]
    if duplicate:
        rows["eligibilities"].append(rows["eligibilities"][0])
    rows["design_groups"] = [
        {
            "nct_id": ids[1],
            "id": "1",
            "title": "Cohort C",
            "description": "LM eligible",
            "group_type": "Experimental",
        }
    ]
    rows["interventions"] = [{"nct_id": ids[1], "id": "2", "name": "Test intervention"}]
    rows["design_group_interventions"] = [
        {"nct_id": ids[1], "design_group_id": "1", "intervention_id": "2"}
    ]
    for name, required in TABLES.items():
        fields = sorted(required | {key for row in rows[name] for key in row})
        with (folder / f"{name}.txt").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fields, delimiter="|")
            writer.writeheader()
            for row in rows[name]:
                writer.writerow({key: row.get(key, "") for key in fields})


def test_actual_snapshot_ingestion_preserves_population_and_cohort_links(tmp_path):
    source = tmp_path / "source"
    table_files(source)
    output = tmp_path / "frozen"
    result = import_aact(source, date(2017, 10, 17), "round_01", output, "Synthetic AACT fixture")
    assert result["universe"] == 3 and result["candidates"] == 2
    manifest, trials, truth = load_round(Path(result["manifest"]))
    assert truth == []
    assert trials[0].eligibility.population.endswith("— stable.")
    assert trials[0].eligibility.raw_text == "Inclusion Criteria:\nGeneral criteria"
    assert trials[1].arms_and_cohorts[0].intervention_names == ["Test intervention"]
    assert trials[1].interventions[0].arm_group_labels == ["Cohort C"]
    assert manifest["snapshot_source"]["snapshot_studies_scanned"] == 3
    assert len(manifest["snapshot_source"]["table_sha256"]) == len(TABLES)
    assert (output / "rounds/round_01/source_rows.json.gz").exists()


@pytest.mark.parametrize("future,duplicate", [(True, False), (False, True)])
def test_bad_snapshot_does_not_publish_ready_manifest(tmp_path, future, duplicate):
    source = tmp_path / "source"
    table_files(source, future, duplicate)
    with pytest.raises(ValueError):
        import_aact(source, date(2017, 10, 17), "round_01", tmp_path / "bad", "Synthetic fixture")
    assert not (tmp_path / "bad/manifests/round_01.json").exists()


def test_missing_protocol_table_is_not_silently_treated_as_empty(tmp_path):
    source = tmp_path / "empty"
    source.mkdir()
    with pytest.raises(ValueError, match="required protocol tables"):
        import_aact(source, date(2017, 10, 17), "round_01", tmp_path / "bad", "Synthetic fixture")


@pytest.mark.parametrize("future", [False, True])
def test_current_aact_date_columns_are_preserved_and_checked(tmp_path, future):
    source = tmp_path / "source"
    table_files(source)
    studies = source / "studies.txt"
    with studies.open() as stream:
        rows = list(csv.DictReader(stream, delimiter="|"))
    for row in rows:
        row.pop("last_changed_date")
        row.pop("first_received_date")
        row["study_first_submitted_date"] = "2016-01-01"
        row["last_update_posted_date"] = "2018-01-01" if future else "2017-02-03"
    with studies.open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), delimiter="|")
        writer.writeheader()
        writer.writerows(rows)
    if future:
        with pytest.raises(ValueError, match="after the declared snapshot"):
            import_aact(source, date(2017, 10, 17), "round_01", tmp_path / "bad", "Synthetic")
    else:
        result = import_aact(source, date(2017, 10, 17), "round_01", tmp_path / "good", "Synthetic")
        manifest, trials, _ = load_round(Path(result["manifest"]))
        assert trials[0].last_update_date == "2017-02-03"
        assert manifest["snapshot_source"]["studies_without_source_dates"] == 0


def test_unknown_date_column_schema_cannot_silently_pass_date_validation(tmp_path):
    source = tmp_path / "source"
    table_files(source)
    studies = source / "studies.txt"
    text = studies.read_text().replace("first_received_date", "unknown_first_date")
    studies.write_text(text.replace("last_changed_date", "unknown_last_date"))
    with pytest.raises(ValueError, match="source date columns"):
        import_aact(source, date(2017, 10, 17), "round_01", tmp_path / "bad", "Synthetic")
