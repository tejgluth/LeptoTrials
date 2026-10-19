from leptotrials_harness.config import RESOURCES
from leptotrials_harness.validation import compare_configurations, compare_models


def stub_validator(captured):
    def run(manifest, variant, output, **kwargs):
        captured.append((variant.model.model_copy(deep=True), kwargs))
        return {
            "metrics": None,
            "run": {"performance": {}, "run_id": str(len(captured)), "state": "completed"},
        }

    return run


def test_config_comparison_preserves_thinking_and_forces_same_path(tmp_path, monkeypatch):
    captured = []
    monkeypatch.setattr("leptotrials_harness.validation.validate_round", stub_validator(captured))
    configs = [RESOURCES / "config/ollama.yaml", RESOURCES / "config/ollama-fast.yaml"]
    report = compare_configurations(tmp_path / "manifest.json", tmp_path, configs)
    assert [model.local_thinking for model, _ in captured] == [True, False]
    assert all(options["force_model"] and not options["use_cache"] for _, options in captured)
    assert all(row["metrics"] is None for row in report["results"])


def test_provider_switch_does_not_copy_zero_cost_or_custom_credentials(
    config, tmp_path, monkeypatch
):
    captured = []
    config.model.provider = "ollama"
    config.model.base_url = "http://127.0.0.1:11434"
    config.model.api_key_env = "LOCAL_ONLY_PLACEHOLDER"
    config.model.input_usd_per_million = config.model.output_usd_per_million = 0
    monkeypatch.setattr("leptotrials_harness.validation.validate_round", stub_validator(captured))
    compare_models(tmp_path / "manifest.json", config, tmp_path, ["openai:test-model"])
    model = captured[0][0]
    assert model.provider == "openai"
    assert model.base_url is None and model.api_key_env is None
    assert model.input_usd_per_million is None and model.output_usd_per_million is None
