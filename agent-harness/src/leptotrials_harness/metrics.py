"""Abstentions/failures remain in denominators; retrieval measured separately."""

from collections import Counter

from .models import Classification


def ratio(n, d):
    return n / d if d else None


def calculate_metrics(records: list[dict], truth: list[dict]) -> dict:
    if len({r["nct_id"] for r in records}) != len(records):
        raise ValueError("Duplicate predictions")
    if len({r["nct_id"] for r in truth}) != len(truth):
        raise ValueError("Duplicate reference classifications")
    refs = {r["nct_id"]: r for r in truth}
    if set(refs) != {r["nct_id"] for r in records}:
        raise ValueError("Prediction/reference ID sets differ; cannot silently drop records")
    tp = fp = tn = fn = abstentions = correct = changes = 0
    classes, per_class, disagreements = Counter(), {}, []
    for record in records:
        ref = refs[record["nct_id"]]
        gold = ref["is_lm_inclusive"]
        if type(gold) is not bool or not ref["source_checked"]:
            raise ValueError("Reference must be a resolved, source-checked adjudication")
        result = record.get("result") or {}
        pred = result.get("is_lm_inclusive")
        predicted = result.get("classification", record.get("error") or "NO_DECISION")
        category = ref["expert_classification"]
        classes[(category, predicted)] += 1
        counts = per_class.setdefault(category, {"total": 0, "correct": 0})
        counts["total"] += 1
        counts["correct"] += predicted == category
        if type(pred) is not bool:
            abstentions += 1
        elif pred and gold:
            tp += 1
        elif pred and not gold:
            fp += 1
        elif not pred and not gold:
            tn += 1
        else:
            fn += 1
        correct += type(pred) is bool and pred == gold
        if predicted != category:
            changes += 1
            disagreements.append(
                {"nct_id": record["nct_id"], "predicted": predicted, "reference": category}
            )
    n, resolved = len(records), tp + fp + tn + fn
    attempts = [a for r in records for a in r.get("attempts", [])]
    schema = sum(
        (a.get("error") or {}).get("type") == "SCHEMA_OR_EVIDENCE_FAILURE" for a in attempts
    )
    api = sum((a.get("error") or {}).get("type") == "API_MODEL_FAILURE" for a in attempts)
    return {
        "total_records": n,
        "resolved_predictions": resolved,
        "abstentions_or_failures": abstentions,
        "TP": tp,
        "FP": fp,
        "TN": tn,
        "FN": fn,
        "accuracy": ratio(correct, n),
        "resolved_accuracy": ratio(tp + tn, resolved),
        "binary_metric_scope": "PPV/NPV/recall/specificity/F1 use resolved predictions only; "
        "interpret with prediction_coverage and overall accuracy (which includes abstentions).",
        "precision": ratio(tp, tp + fp),
        "PPV": ratio(tp, tp + fp),
        "NPV": ratio(tn, tn + fn),
        "recall": ratio(tp, tp + fn),
        "sensitivity": ratio(tp, tp + fn),
        "specificity": ratio(tn, tn + fp),
        "F1": ratio(2 * tp, 2 * tp + fp + fn),
        "prediction_coverage": ratio(resolved, n),
        "human_review_rate": ratio(sum(r.get("requires_review", False) for r in records), n),
        "schema_failure_rate_per_attempt": ratio(schema, len(attempts)),
        "api_model_failure_rate_per_attempt": ratio(api, len(attempts)),
        "model_failure_rate_per_record": ratio(
            sum(r.get("error") == "MODEL_FAILURE" for r in records), n
        ),
        "strict_count": sum(r.get("pipeline_stage") == "strict_rule" for r in records),
        "stage_2_count": sum(r.get("pipeline_stage") == "agent" for r in records),
        "expert_changed_count": changes,
        "disagreements": disagreements,
        "confusion_matrix": {
            c.value: {p: v for (g, p), v in classes.items() if g == c.value} for c in Classification
        },
        "per_class_accuracy": {
            k: {**v, "accuracy": ratio(v["correct"], v["total"])} for k, v in per_class.items()
        },
        "no_observed_fp_fn": bool(n and fp == fn == abstentions == 0),
    }


def retrieval_metrics(retrieved_ids: list[str], reference_inclusive_ids: list[str]) -> dict:
    found, reference = set(retrieved_ids), set(reference_inclusive_ids)
    return {
        "retrieved_unique": len(found),
        "reference_inclusive": len(reference),
        "relevant_retrieved": len(found & reference),
        "relevant_missing": sorted(reference - found),
        "retrieval_recall": ratio(len(found & reference), len(reference)),
        "scope": "candidate retrieval, separate from given-candidate classification",
    }
