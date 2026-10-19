import json
from pathlib import Path

from leptotrials_harness.config import RESOURCES
from leptotrials_harness.logging_utils import read_json
from leptotrials_harness.models import TrialInput
from leptotrials_harness.strict_classifier import classify_strict


def test_known_difficult_public_records_cannot_bypass_contextual_review():
    archive = read_json(RESOURCES / "validation/records/registry-inputs.json.gz")
    records = {t["nct_id"]: t for t in archive["records"].values()}
    cases = read_json(Path(__file__).parent / "fixtures/regression-cases.json")["cases"]
    for case in cases:
        trial = TrialInput.model_validate_json(json.dumps(records[case["nct_id"]]))
        assert classify_strict(trial) is None, case["reason"]
