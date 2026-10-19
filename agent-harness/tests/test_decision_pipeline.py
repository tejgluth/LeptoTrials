from conftest import FakeModel, response, trial

from leptotrials_harness.decision_pipeline import Pipeline
from leptotrials_harness.gemini_client import ModelFailure


def test_strict_accept_and_dry_run_never_call_model(config, tmp_path):
    client = FakeModel(config, ModelFailure("must not call"))
    strict = Pipeline(config, tmp_path, client=client)
    result = strict.classify(trial("", conditions=["Leptomeningeal Metastasis"]))
    assert result["status"] == "AUTO_ACCEPTED_STRICT"
    dry = Pipeline(config, tmp_path, client=client, dry_run=True)
    result = dry.classify(trial())
    assert result["status"] == "DRY_RUN_STAGE_2"
    assert client.calls == 0


def test_model_success_and_cache_invalidation(config, tmp_path):
    t = trial()
    client = FakeModel(config, response(t))
    first = Pipeline(config, tmp_path, client=client)
    assert first.classify(t)["status"] == "MODEL_CLASSIFIED"
    second = Pipeline(config, tmp_path, client=client)
    t.last_update_date = "2026-10-17"
    assert second.classify(t)["cached"] is True
    third = Pipeline(config, tmp_path, client=client)
    t.eligibility.raw_text += " More eligibility information."
    assert third.classify(t)["cached"] is False
    assert client.calls == 2


def test_ambiguous_and_unscoped_conflicts_require_review(config, tmp_path):
    t = trial()
    ambiguous = FakeModel(config, response(t, "AMBIGUOUS_REQUIRES_REVIEW"))
    assert Pipeline(config, tmp_path, client=ambiguous).classify(t)["requires_review"]
    data = response(t)
    data["conflicting_evidence"] = data["evidence"].copy()
    result = Pipeline(config, tmp_path, client=FakeModel(config, data), use_cache=False).classify(t)
    assert result["status"] == "REQUIRES_EXPERT_REVIEW"
    assert (
        result["result"]["requires_human_review"] is False
    )  # retain raw decision, safety gate separate


def test_model_api_failure_and_invalid_output(config, tmp_path):
    for output in (ModelFailure("temporary"), "{malformed", response(trial(), quote="invented")):
        result = Pipeline(config, tmp_path, client=FakeModel(config, output)).classify(trial())
        assert result["error"] == "MODEL_FAILURE"
        assert result["classification"] is None
        assert result["requires_review"]
        assert len(result["attempts"]) == 1


def test_cohort_specific_scope_kept(config, tmp_path):
    text = "Cohort C: Patients with leptomeningeal disease may enroll."
    t = trial(text)
    data = response(t, "LM_INCLUSIVE_COHORT_SPECIFIC", cohort="Cohort C")
    result = Pipeline(config, tmp_path, client=FakeModel(config, data)).classify(t)
    assert result["result"]["is_lm_inclusive"] is True
    assert result["result"]["evidence"][0]["cohort"] == "Cohort C"


def test_placeholder_or_query_only_cohort_names_require_expert_review(config, tmp_path):
    for cohort in ("N/A", "Not applicable", "Cohort Z"):
        item = trial()
        item.candidate_retrieval_reasons = ["Search included Cohort Z"]
        data = response(item, "LM_INCLUSIVE_COHORT_SPECIFIC", cohort=cohort)
        row = Pipeline(config, tmp_path, client=FakeModel(config, data)).classify(item)
        assert row["status"] == "REQUIRES_EXPERT_REVIEW"
        assert row["error"] == "MODEL_FAILURE"
        assert row["result"] is None
        assert "not linked to its stated cohort" in row["attempts"][0]["error"]["message"]
        # Raw proposed output remains auditable; it is not accepted as a result.
        assert '"requires_human_review": false' in row["attempts"][0]["raw_output"]


def test_running_batch_pins_prompt_payload_cache_and_manifest(config, tmp_path, monkeypatch):
    import leptotrials_harness.decision_pipeline as module
    from leptotrials_harness.logging_utils import read_json

    item = trial()
    pipeline = Pipeline(config, tmp_path, client=FakeModel(config, response(item)))
    original = pipeline.prompt.copy()
    monkeypatch.setattr(module, "prompts", lambda: {"version": "changed-after-start"})
    row = pipeline.classify(item)
    manifest = pipeline.finish()
    payload = read_json(pipeline.run_dir / "model_inputs" / f"{item.nct_id}.json")
    assert row["prompt_version"] == original["version"]
    assert payload["provenance"]["prompt_version"] == original["version"]
    assert manifest["prompts"] == original
    assert row["error"] is None
