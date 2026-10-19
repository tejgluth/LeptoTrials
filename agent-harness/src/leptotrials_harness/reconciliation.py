"""Compare a captured live set with independent research results, never force parity."""

import re
from pathlib import Path

from .logging_utils import digest, now, read_json
from .models import TrialInput
from .structured_input import content_hash


def reconcile_production(baseline: Path, candidates: Path, run: Path) -> dict:
    live, capture = read_json(baseline), read_json(candidates)
    ids = live["nct_ids"]
    if (
        len(ids) != live["count"]
        or len(set(ids)) != len(ids)
        or any(not re.fullmatch(r"NCT\d{8}", n) for n in ids)
    ):
        raise ValueError("Production baseline count/IDs are invalid or duplicated")
    if live.get("url", "").rstrip("/") != "https://leptotrials.com":
        raise ValueError("Baseline must be explicitly captured from production")
    if capture.get("complete") is not True:
        raise ValueError("Candidate retrieval is incomplete")
    if set(capture["statuses"]) != set(live["filters"]["statuses"]):
        raise ValueError("Recruitment status filters differ")
    if any(
        (
            live["filters"].get("age") is not None,
            live["filters"].get("location") != "Anywhere",
            live["filters"].get("tumor_type") != "any",
            live["filters"].get("study_type") != "any",
            bool(live["filters"].get("phases")),
        )
    ):
        raise ValueError("This reconciliation supports default unrestricted filters only")
    trials = {t["nct_id"]: TrialInput.model_validate(t) for t in capture["trials"]}
    if len(trials) != capture["count"] or len(trials) != len(capture["trials"]):
        raise ValueError("Candidate count mismatch or duplicate IDs")
    rows = []
    seen = set()
    for path in sorted((run / "decisions").glob("*.json")):
        decision = read_json(path)
        nct = decision["nct_id"]
        if nct not in trials or nct in seen:
            raise ValueError("Run contains unexpected or duplicate trial")
        seen.add(nct)
        if decision["input_hash"] != content_hash(trials[nct]):
            raise ValueError(f"Run/candidate source revision mismatch: {nct}")
        expected_hash = digest(
            {
                "input_hash": decision["input_hash"],
                "result": decision.get("result"),
                "status": decision["status"],
                "error": decision.get("error"),
            }
        )
        if expected_hash != decision["decision_hash"]:
            raise ValueError(f"Saved decision fingerprint mismatch: {nct}")
        result = decision.get("result") or {}
        rows.append(
            {
                "nct_id": nct,
                "in_live_production": nct in ids,
                "status": decision["status"],
                "classification": result.get("classification"),
                "is_lm_inclusive": result.get("is_lm_inclusive"),
                "requires_review": decision["requires_review"],
                "error": decision.get("error"),
                "input_hash": decision["input_hash"],
                "decision_hash": decision["decision_hash"],
                "primary_reason": result.get("primary_reason"),
                "evidence": result.get("evidence", []),
                "conflicting_evidence": result.get("conflicting_evidence", []),
            }
        )
    proposed = {r["nct_id"] for r in rows if r["is_lm_inclusive"] is True}
    accepted = {
        r["nct_id"]
        for r in rows
        if r["is_lm_inclusive"] is True and not r["requires_review"] and not r["error"]
    }
    live_set = set(ids)
    pending = sorted(set(trials) - seen)
    unresolved = sorted(r["nct_id"] for r in rows if r["error"] or r["is_lm_inclusive"] is None)
    return {
        "kind": "production_membership_comparison_not_clinical_accuracy",
        "compared_at": now(),
        "baseline_hash": digest(live),
        "baseline_captured_at": live["captured_at"],
        "candidate_captured_at": capture["captured_at"],
        "baseline_url": live["url"],
        "filters": live["filters"],
        "run": str(run),
        "live_count": len(ids),
        "candidate_count": len(trials),
        "processed_count": len(rows),
        "pending_nct_ids": pending,
        "retrieval_missing_live_ids": sorted(live_set - set(trials)),
        "proposed_inclusive_count": len(proposed),
        "accepted_inclusive_count": len(accepted),
        "live_not_proposed_inclusive": sorted(live_set - proposed),
        "proposed_inclusive_not_live": sorted(proposed - live_set),
        "live_not_auto_accepted": sorted(live_set - accepted),
        "unresolved_nct_ids": unresolved,
        "execution_complete": not pending and (run / "manifest.json").exists(),
        "proposed_membership_equals_live": not pending and proposed == live_set,
        "accepted_membership_equals_live": not pending and accepted == live_set,
        "expert_validation_complete": False,
        "limitation": "Production membership is a compatibility baseline, not expert ground "
        "truth. Abstentions, failures and source conflicts are not negative labels. "
        "Never overwrite a classification to manufacture equality. Source data "
        "may change between the live capture and the API capture.",
        "records": rows,
    }
