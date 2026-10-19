"""Typed contracts. JSON schemas are generated from these models, never hand-maintained."""

from datetime import date
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

NctId = Annotated[str, Field(pattern=r"^NCT\d{8}$")]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
SCHEMA_VERSION = "1.0.0"
INPUT_SCHEMA_VERSION = "1.1.0"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Classification(StrEnum):
    LM_SPECIFIC = "LM_SPECIFIC"
    LM_INCLUSIVE_GENERAL = "LM_INCLUSIVE_GENERAL"
    LM_INCLUSIVE_COHORT_SPECIFIC = "LM_INCLUSIVE_COHORT_SPECIFIC"
    LM_EXCLUDED = "LM_EXCLUDED"
    LM_MENTION_ONLY = "LM_MENTION_ONLY"
    INSUFFICIENT_INFORMATION = "INSUFFICIENT_INFORMATION"
    AMBIGUOUS_REQUIRES_REVIEW = "AMBIGUOUS_REQUIRES_REVIEW"


INCLUSIVE = frozenset(list(Classification)[:3])
UNRESOLVED = frozenset(list(Classification)[5:])


def inclusive_value(category: Classification) -> bool | None:
    return None if category in UNRESOLVED else category in INCLUSIVE


class Eligibility(StrictModel):
    raw_text: str = ""
    inclusion_text: str = ""
    exclusion_text: str = ""
    section_found: bool = False
    minimum_age: str = ""
    maximum_age: str = ""
    sex: str = ""
    population: str = ""


class Arm(StrictModel):
    label: str = ""
    type: str = ""
    description: str = ""
    intervention_names: list[str] = Field(default_factory=list)


class Intervention(StrictModel):
    type: str = ""
    name: str = ""
    description: str = ""
    arm_group_labels: list[str] = Field(default_factory=list)


class Outcome(StrictModel):
    measure: str = ""
    description: str = ""
    time_frame: str = ""


class Location(StrictModel):
    facility: str = ""
    city: str = ""
    country: str = ""
    status: str = ""


class Signals(StrictModel):
    lm_terms_in_title: list[str] = Field(default_factory=list)
    lm_terms_in_conditions: list[str] = Field(default_factory=list)
    lm_terms_in_summary: list[str] = Field(default_factory=list)
    lm_terms_in_inclusion: list[str] = Field(default_factory=list)
    lm_terms_in_exclusion: list[str] = Field(default_factory=list)
    lm_terms_in_arm_text: list[str] = Field(default_factory=list)
    negative_lm_phrases: list[str] = Field(default_factory=list)
    possible_lm_cohort: bool = False


class TrialInput(StrictModel):
    nct_id: NctId
    input_schema_version: Literal["1.0.0", "1.1.0"] = INPUT_SCHEMA_VERSION
    brief_title: str = ""
    official_title: str = ""
    overall_status: str = ""
    study_type: str = ""
    phase: list[str] = Field(default_factory=list)
    conditions: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    brief_summary: str = ""
    detailed_description: str = ""
    eligibility: Eligibility = Field(default_factory=Eligibility)
    arms_and_cohorts: list[Arm] = Field(default_factory=list)
    interventions: list[Intervention] = Field(default_factory=list)
    primary_outcomes: list[Outcome] = Field(default_factory=list)
    secondary_outcomes: list[Outcome] = Field(default_factory=list)
    locations: list[Location] = Field(default_factory=list)
    sponsor: str = ""
    last_update_date: str = ""
    study_start_date: str = ""
    candidate_retrieval_reasons: list[str] = Field(default_factory=list)
    deterministic_signals: Signals = Field(default_factory=Signals)

    @model_validator(mode="after")
    def versioned_fields(self):
        if self.input_schema_version == "1.0.0" and self.eligibility.population:
            raise ValueError("Eligibility population requires input schema 1.1.0")
        return self


class Evidence(StrictModel):
    field: str = Field(min_length=1)
    cohort: str | None
    quote: str = Field(min_length=1, max_length=500)
    interpretation: str = Field(min_length=1, max_length=1000)
    direction: Literal["inclusion", "exclusion", "context"]


class ClassificationOutput(StrictModel):
    nct_id: NctId
    classification: Classification
    is_lm_inclusive: bool | None
    confidence: float = Field(ge=0, le=1)
    requires_human_review: bool
    primary_reason: str = Field(min_length=1, max_length=2000)
    evidence: list[Evidence]
    conflicting_evidence: list[Evidence]
    lm_terms_detected: list[str]
    classification_notes: str = Field(max_length=4000)
    model_version: str
    prompt_version: str
    input_schema_version: str
    output_schema_version: str

    @model_validator(mode="after")
    def consistent(self):
        if self.is_lm_inclusive is not inclusive_value(self.classification):
            raise ValueError("Binary label contradicts taxonomy")
        if self.classification in UNRESOLVED and not self.requires_human_review:
            raise ValueError("Unresolved classifications require review")
        if self.classification != Classification.INSUFFICIENT_INFORMATION and not self.evidence:
            raise ValueError("Classification requires evidence")
        if self.classification in INCLUSIVE:
            if not any(e.direction == "inclusion" for e in self.evidence):
                raise ValueError("Inclusion needs affirmative evidence")
        if self.classification == Classification.LM_EXCLUDED:
            if not any(e.direction == "exclusion" for e in self.evidence):
                raise ValueError("Exclusion needs exclusion evidence")
        if self.classification == Classification.LM_INCLUSIVE_COHORT_SPECIFIC:
            if not any(e.cohort and e.direction == "inclusion" for e in self.evidence):
                raise ValueError("Cohort-specific inclusion needs a named cohort")
        return self


class Adjudication(StrictModel):
    nct_id: NctId
    run_id: str = Field(pattern=r"^[a-zA-Z0-9_-]+$")
    input_hash: Digest
    decision_hash: Digest
    expert_classification: Classification
    is_lm_inclusive: bool | None
    reviewer_id: str = Field(pattern=r"^[a-zA-Z0-9_-]+$")
    review_date: date
    source_checked: bool
    disposition: Literal["approve", "change", "reject"]
    tumor_labels: list[Literal["LUNG", "BREAST", "MELANOMA", "GBM", "OTHER_SOLID"]]
    notes: str = Field(max_length=4000)

    @model_validator(mode="after")
    def consistent(self):
        if self.is_lm_inclusive is not inclusive_value(self.expert_classification):
            raise ValueError("Expert binary label contradicts taxonomy")
        if self.is_lm_inclusive is not True and self.tumor_labels:
            raise ValueError("Non-inclusive decisions cannot assign tumor labels")
        return self
