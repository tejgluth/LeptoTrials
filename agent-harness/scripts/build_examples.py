"""Generate instructional examples; never represent these as observed model decisions."""

from pathlib import Path

from leptotrials_harness.logging_utils import write_json
from leptotrials_harness.models import (
    SCHEMA_VERSION,
    Classification,
    ClassificationOutput,
    Evidence,
)
from leptotrials_harness.structured_input import prompts
from leptotrials_harness.trial_normalizer import normalize

CASES = [
    ("LM-specific", "LM_SPECIFIC", "Patients with leptomeningeal disease required.", None),
    ("Exclusion", "LM_EXCLUDED", "Patients with known leptomeningeal disease are excluded.", None),
    (
        "Cohort-specific",
        "LM_INCLUSIVE_COHORT_SPECIFIC",
        "Cohort C: Patients with leptomeningeal disease are eligible.\n"
        "Cohorts A and B: leptomeningeal disease is excluded.",
        "Cohort C",
    ),
    (
        "Ambiguous",
        "AMBIGUOUS_REQUIRES_REVIEW",
        "Inclusion Criteria:\nLeptomeningeal disease required.\n"
        "Exclusion Criteria:\nMeningeal metastasis.",
        None,
    ),
]


def main():
    examples = []
    for i, (name, label, text, cohort) in enumerate(CASES):
        nct = f"NCT0000000{i}"
        raw = {
            "protocolSection": {
                "identificationModule": {"nctId": nct, "briefTitle": "SYNTHETIC example"},
                "conditionsModule": {
                    "conditions": ["Leptomeningeal Disease"] if i == 0 else ["Cancer"]
                },
                "eligibilityModule": {"eligibilityCriteria": text},
            }
        }
        trial = normalize(raw)
        inclusive = label.startswith("LM_INCLUSIVE") or label == "LM_SPECIFIC"
        ambiguous = label == "AMBIGUOUS_REQUIRES_REVIEW"
        evidence = Evidence(
            field="eligibility.raw_text",
            cohort=cohort,
            quote=text.split("\n")[0] if cohort else text,
            interpretation="Illustrative interpretation, not an observed model result",
            direction="context" if ambiguous else "inclusion" if inclusive else "exclusion",
        )
        conflicts = (
            [
                Evidence(
                    field="eligibility.raw_text",
                    cohort="Cohorts A and B",
                    quote=text.split("\n")[1],
                    direction="exclusion",
                    interpretation="Different cohorts exclude LM",
                )
            ]
            if cohort
            else []
        )
        result = ClassificationOutput(
            nct_id=nct,
            classification=Classification(label),
            is_lm_inclusive=None if ambiguous else inclusive,
            confidence=0.0,
            requires_human_review=ambiguous,
            primary_reason="Synthetic instructional example",
            evidence=[evidence],
            conflicting_evidence=conflicts,
            lm_terms_detected=["leptomeningeal disease"],
            classification_notes="Not produced by Gemini; not expert validation data.",
            model_version="illustrative-not-a-model-call",
            prompt_version=prompts()["version"],
            input_schema_version=trial.input_schema_version,
            output_schema_version=SCHEMA_VERSION,
        )
        examples.append(
            {
                "name": name,
                "synthetic": True,
                "raw_relevant_fields": raw,
                "structured_input": trial.model_dump(mode="json"),
                "illustrative_output": result.model_dump(mode="json"),
                "final_proposed_classification": label,
            }
        )
    write_json(Path("examples/cases.json"), examples)
    write_json(Path("examples/sample_output.json"), examples[2]["illustrative_output"])


if __name__ == "__main__":
    main()
