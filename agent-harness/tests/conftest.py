import json

import pytest

from leptotrials_harness.config import load_config
from leptotrials_harness.gemini_client import ModelReply
from leptotrials_harness.models import SCHEMA_VERSION
from leptotrials_harness.structured_input import prompts
from leptotrials_harness.trial_normalizer import normalize


@pytest.fixture
def config(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    result = load_config()
    result.model.max_attempts = 1
    return result


def raw_trial(criteria="", *, conditions=None, title="Oncology study", arms=None):
    return {
        "protocolSection": {
            "identificationModule": {"nctId": "NCT01234567", "briefTitle": title},
            "conditionsModule": {"conditions": conditions or ["Breast Cancer"]},
            "eligibilityModule": {"eligibilityCriteria": criteria},
            "armsInterventionsModule": {"armGroups": arms or []},
        }
    }


def trial(criteria="Patients with leptomeningeal disease may enroll.", **kwargs):
    return normalize(raw_trial(criteria, **kwargs))


def response(
    t, category="LM_INCLUSIVE_GENERAL", field="eligibility.raw_text", quote=None, cohort=None
):
    inclusive = category in ("LM_SPECIFIC", "LM_INCLUSIVE_GENERAL", "LM_INCLUSIVE_COHORT_SPECIFIC")
    unresolved = category in ("AMBIGUOUS_REQUIRES_REVIEW", "INSUFFICIENT_INFORMATION")
    return {
        "nct_id": t.nct_id,
        "classification": category,
        "is_lm_inclusive": None if unresolved else inclusive,
        "confidence": 0.9,
        "requires_human_review": unresolved,
        "primary_reason": "Fixture classification",
        "evidence": [
            {
                "field": field,
                "quote": quote or t.eligibility.raw_text,
                "cohort": cohort,
                "interpretation": "Fixture evidence",
                "direction": "inclusion"
                if inclusive
                else "exclusion"
                if category == "LM_EXCLUDED"
                else "context",
            }
        ],
        "conflicting_evidence": [],
        "lm_terms_detected": ["leptomeningeal disease"],
        "classification_notes": "Synthetic test, not expert adjudication",
        "model_version": "gemini-3.8-flash",
        "prompt_version": prompts()["version"],
        "input_schema_version": t.input_schema_version,
        "output_schema_version": SCHEMA_VERSION,
    }


class FakeModel:
    def __init__(self, config, output):
        self.config, self.output, self.calls = config.model, output, 0

    def generate(self, *args):
        self.calls += 1
        if isinstance(self.output, Exception):
            raise self.output
        text = self.output if isinstance(self.output, str) else json.dumps(self.output)
        return ModelReply(
            text, self.config.model_id, {"total_input_tokens": 20, "total_output_tokens": 10}, 12.0
        )

    def close(self):
        pass
