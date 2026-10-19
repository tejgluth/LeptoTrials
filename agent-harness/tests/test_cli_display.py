import json
import sys

from leptotrials_harness import cli


def test_validation_console_omits_large_inputs_but_preserves_metrics(monkeypatch, capsys):
    result = {
        "run": {
            "state": "complete",
            "run_id": "example",
            "count": 17000,
            "prompts": {"system": "large prompt"},
            "record_ids": ["NCT01234567"],
        },
        "metrics": None,
        "validation_state": "dry_run_not_model_evaluation",
    }
    monkeypatch.setattr(sys, "argv", ["harness", "validate", "unused.json", "--dry-run"])
    monkeypatch.setattr(cli, "execute", lambda args: result)
    cli.main()
    displayed = json.loads(capsys.readouterr().out)
    assert displayed["run"] == {"state": "complete", "run_id": "example", "count": 17000}
    assert displayed["metrics"] is None
    assert "prompts" in result["run"]  # persisted result is not altered
