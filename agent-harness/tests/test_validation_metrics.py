import pytest

from leptotrials_harness.metrics import calculate_metrics, retrieval_metrics


def pair(index, predicted, gold):
    classes = {True: "LM_SPECIFIC", False: "LM_EXCLUDED", None: "AMBIGUOUS_REQUIRES_REVIEW"}
    return (
        {
            "nct_id": str(index),
            "result": {"is_lm_inclusive": predicted, "classification": classes[predicted]},
            "requires_review": predicted is None,
        },
        {
            "nct_id": str(index),
            "is_lm_inclusive": gold,
            "expert_classification": classes[gold],
            "source_checked": True,
        },
    )


def test_confusion_matrix_and_disagreements():
    pairs = [pair(0, True, True), pair(1, True, False), pair(2, False, False), pair(3, False, True)]
    m = calculate_metrics([p[0] for p in pairs], [p[1] for p in pairs])
    assert (m["TP"], m["FP"], m["TN"], m["FN"]) == (1, 1, 1, 1)
    assert m["accuracy"] == m["precision"] == m["recall"] == m["specificity"] == m["F1"] == 0.5
    assert len(m["disagreements"]) == 2


def test_no_fp_fn_is_observed_only_for_complete_resolved_predictions():
    p = [pair(0, True, True), pair(1, False, False)]
    assert calculate_metrics([x[0] for x in p], [x[1] for x in p])["no_observed_fp_fn"]
    p.append(pair(2, None, True))
    m = calculate_metrics([x[0] for x in p], [x[1] for x in p])
    assert not m["no_observed_fp_fn"]
    assert m["accuracy"] == 2 / 3
    assert m["abstentions_or_failures"] == 1


def test_missing_predictions_are_not_dropped():
    _, ref = pair(0, True, True)
    with pytest.raises(ValueError, match="ID sets differ"):
        calculate_metrics([], [ref])


def test_retrieval_separate_from_given_candidate_classification():
    m = retrieval_metrics(["a", "b", "b"], ["b", "c"])
    assert m["retrieval_recall"] == 0.5
    assert m["relevant_missing"] == ["c"]
