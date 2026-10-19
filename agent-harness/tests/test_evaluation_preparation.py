import importlib.util
import json
from datetime import date
from pathlib import Path

import pytest
from conftest import trial
from test_aact import table_files

from leptotrials_harness.aact import import_aact
from leptotrials_harness.validation import load_round


def helper():
    path = Path(__file__).resolve().parents[1] / "scripts/build_aact_evaluation.py"
    spec = importlib.util.spec_from_file_location("evaluation_preparation", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sampling_is_deterministic_without_using_predictions_or_expert_labels():
    items = []
    for i in range(12):
        item = trial()
        item.nct_id = f"NCT{i:08d}"
        items.append(item)
    module = helper()
    first, plan = module.select_sample(items, "round_01", "fixed-seed", 5)
    second, _ = module.select_sample(list(reversed(items)), "round_01", "fixed-seed", 5)
    assert [t.nct_id for t in first] == [t.nct_id for t in second]
    assert len(set(t.nct_id for t in first)) == 5
    assert sum(plan["population_strata"].values()) == 12
    assert sum(plan["selected_strata"].values()) == 5
    assert "DEVELOPMENT" in plan["limitation"]
    assert all(row["input_hash"] for row in plan["selection"])
    with pytest.raises(ValueError, match="Sample size"):
        module.select_sample(items, "round_01", "seed", 13)


def source_recipe(tmp_path):
    tables = tmp_path / "tables"
    table_files(tables)
    original = tmp_path / "original"
    rows = []
    for i in range(1, 11):
        identifier = f"round_{i:02d}"
        imported = import_aact(
            tables, date(2016 + i, 10, 17), identifier, original, "Synthetic only"
        )
        rows.append({"round_id": identifier, "manifest": imported["manifest"]})
    recipe = tmp_path / "recipe.json"
    recipe.write_text(json.dumps({"collection_id": "synthetic", "rounds": rows}))
    return recipe, original


def test_reconciled_collection_copies_verified_inputs_and_tracks_sample_lineage(tmp_path):
    recipe, original = source_recipe(tmp_path)
    source_bytes = (original / "rounds/round_01/inputs.json.gz").read_bytes()
    destination = tmp_path / "collection"
    result = helper().build_collection(recipe, destination, 2, "fixed-seed")
    assert result["state"] == "complete"
    assert result["development_record_round_pairs"] == 20
    assert result["full_record_round_pairs"] == 20
    assert len(result["rounds"]) == 10 and result["expert_metrics"] is None
    full, full_inputs, _ = load_round(destination / "full/manifests/round_01.json")
    sample, sample_inputs, truth = load_round(destination / "development/manifests/round_01.json")
    assert not truth
    assert {t.nct_id for t in sample_inputs} <= {t.nct_id for t in full_inputs}
    assert sample["not_full_population_inference"]
    assert full["source_rows_sha256"]
    assert (original / "rounds/round_01/inputs.json.gz").read_bytes() == source_bytes
    with pytest.raises(FileExistsError):
        helper().build_collection(recipe, destination, 2, "fixed-seed")


def test_superseded_date_mapping_cannot_be_labeled_a_reconciled_collection(tmp_path):
    recipe, original = source_recipe(tmp_path)
    path = original / "manifests/round_02.json"
    source = json.loads(path.read_text())
    source["snapshot_source"]["import_version"] = "superseded"
    path.write_text(json.dumps(source))
    destination = tmp_path / "bad-collection"
    with pytest.raises(ValueError, match="Superseded"):
        helper().build_collection(recipe, destination, 2, "seed")
    assert not (destination / "collection.json").exists()
