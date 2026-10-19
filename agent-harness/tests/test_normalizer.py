import json

from conftest import raw_trial

from leptotrials_harness.logging_utils import digest
from leptotrials_harness.models import TrialInput
from leptotrials_harness.structured_input import content_hash, model_payload
from leptotrials_harness.terminology import detect
from leptotrials_harness.trial_normalizer import normalize


def test_missing_optional_fields():
    result = normalize({"protocolSection": {"identificationModule": {"nctId": "NCT01234567"}}})
    assert result.eligibility.raw_text == ""
    assert result.arms_and_cohorts == []


def test_text_unicode_and_multiple_cohorts_preserved():
    text = (
        "Inclusion Criteria:\nCohort C — stable LM permitted.\n"
        "Key Exclusion Criteria:\nCohort A: LM."
    )
    raw = raw_trial(
        text,
        arms=[
            {"label": "A", "description": "Excludes LM"},
            {"label": "C", "description": "Allows LM"},
        ],
    )
    result = normalize(raw)
    assert result.eligibility.raw_text == text
    assert result.eligibility.inclusion_text + result.eligibility.exclusion_text == text
    assert result.eligibility.exclusion_text.startswith("Key Exclusion Criteria")
    assert len(result.arms_and_cohorts) == 2


def test_ambiguous_abbreviations_and_word_boundaries():
    assert detect("LM algorithm for signal analysis") == []
    assert "LM" in detect("Patients with LM", "breast cancer")
    assert "LM" not in detect("LMA in cancer")


def test_change_detection_ignores_timestamp_but_not_status_age_or_cohort():
    t = normalize(raw_trial("LM allowed"))
    baseline = content_hash(t)
    t.last_update_date = "2026-10-17"
    assert content_hash(t) == baseline
    t.overall_status = "COMPLETED"
    assert content_hash(t) != baseline
    t.overall_status = ""
    t.eligibility.minimum_age = "18 Years"
    assert content_hash(t) != baseline


def test_population_preserved_and_versioned_without_rewriting_legacy_hashes():
    raw = raw_trial()
    raw["protocolSection"]["eligibilityModule"]["studyPopulation"] = (
        "Adults with leptomeningeal disease."
    )
    current = normalize(raw)
    assert current.input_schema_version == "1.1.0"
    assert current.eligibility.population == "Adults with leptomeningeal disease."
    assert model_payload(current, "test")["provenance"]["input_schema_version"] == "1.1.0"
    legacy = normalize(raw_trial()).model_dump(mode="json")
    legacy["input_schema_version"] = "1.0.0"
    legacy["eligibility"].pop("population")
    old_hash_data = json.loads(json.dumps(legacy))
    for key in ("last_update_date", "candidate_retrieval_reasons", "deterministic_signals"):
        old_hash_data.pop(key)
    restored = TrialInput.model_validate_json(json.dumps(legacy))
    assert content_hash(restored) == digest(old_hash_data)
    assert "population" not in model_payload(restored, "test")["trial"]["eligibility"]


def test_flat_aact_and_inline_headings_do_not_label_exclusions_as_inclusions():
    for separator in ("~", "    ", "\n"):
        text = (
            "Inclusion Criteria:"
            + separator
            + "Part F: LM required."
            + separator
            + "Exclusion Criteria:"
            + separator
            + "Parts A and B: leptomeningeal metastases."
        )
        current = normalize(raw_trial(text))
        assert current.eligibility.section_found
        assert "Parts A and B" not in current.eligibility.inclusion_text
        assert "Parts A and B" in current.eligibility.exclusion_text
        assert current.eligibility.inclusion_text + current.eligibility.exclusion_text == text


def test_projection_repairs_legacy_views_without_rewriting_frozen_input_or_hash():
    text = "Inclusion Criteria:~Part F: LM required.~Exclusion Criteria:~Parts A and B: LM."
    legacy = normalize(raw_trial(text))
    # Reproduce the old saved AACT projection bug deliberately.
    legacy.eligibility.inclusion_text = text
    legacy.eligibility.exclusion_text = ""
    legacy.eligibility.section_found = False
    before = legacy.model_dump(mode="json")
    original_hash = content_hash(legacy)
    prepared = model_payload(legacy, "test", provider="ollama")
    assert legacy.model_dump(mode="json") == before
    assert content_hash(legacy) == original_hash
    assert prepared["input_projection"]["source_input_hash"] == original_hash
    eligibility = prepared["trial"]["eligibility"]
    assert eligibility["section_found"]
    assert "Parts A and B" not in eligibility["inclusion_text"]
    assert "Parts A and B" in eligibility["exclusion_text"]
    assert eligibility["raw_text"] == text
    assert all(
        a["field"] not in ("eligibility.inclusion_text", "eligibility.exclusion_text")
        for a in prepared["source_passages"]
    )


def test_unsectioned_text_is_not_invented_as_an_inclusion_section():
    current = normalize(raw_trial("Patients with LM may enroll."))
    assert current.eligibility.raw_text == "Patients with LM may enroll."
    assert current.eligibility.inclusion_text == ""
    assert current.eligibility.exclusion_text == ""
    assert not current.eligibility.section_found


def test_acronym_context_recognizes_malignancy_plural_tumors_and_expanded_lm_condition():
    for context in (
        "tissue confirmed solid malignancy",
        "solid tumors",
        "brain tumours",
        "Leptomeningeal Disease",
    ):
        assert "LMD" in detect("CSF sampling positive for LMD", context)
    assert "LM" not in detect("LM algorithm for signal analysis")
