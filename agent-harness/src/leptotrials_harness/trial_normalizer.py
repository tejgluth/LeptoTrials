"""Turn ClinicalTrials.gov API v2 records into TrialInput."""

import re

from .models import Arm, Eligibility, Intervention, Location, Outcome, Signals, TrialInput
from .terminology import detect, lm_passages


def eligibility_sections(raw: str) -> tuple[str, str, bool]:
    """Split criteria into inclusion/exclusion, including flattened AACT text."""
    marker = re.search(
        r"(?i)\b(?:(?:key|main|subject|patient|study|specific|general)\s+)?"
        r"exclusion(?:\s+criteria)?\s*(?=[:\n\r~(]|$)",
        raw,
    )
    if marker:
        return raw[: marker.start()], raw[marker.start() :], True
    # if we can't find headings, don't pretend it's all inclusion criteria
    return "", "", False


def normalize(study: dict, reasons: list[str] | None = None) -> TrialInput:
    p = study["protocolSection"]
    ident = p["identificationModule"]
    status = p.get("statusModule") or {}
    design = p.get("designModule") or {}
    cond = p.get("conditionsModule") or {}
    desc = p.get("descriptionModule") or {}
    elig = p.get("eligibilityModule") or {}
    raw = elig.get("eligibilityCriteria") or ""
    # raw criteria are kept either way
    inclusion, exclusion, section_found = eligibility_sections(raw)
    arms = [
        Arm(
            label=a.get("label") or "",
            type=a.get("type") or "",
            description=a.get("description") or "",
            intervention_names=a.get("interventionNames") or [],
        )
        for a in (p.get("armsInterventionsModule") or {}).get("armGroups", [])
    ]
    interventions = [
        Intervention(
            type=i.get("type") or "",
            name=i.get("name") or "",
            description=i.get("description") or "",
            arm_group_labels=i.get("armGroupLabels") or [],
        )
        for i in (p.get("armsInterventionsModule") or {}).get("interventions", [])
    ]

    def outcomes(key):
        return [
            Outcome(
                measure=o.get("measure") or "",
                description=o.get("description") or "",
                time_frame=o.get("timeFrame") or "",
            )
            for o in (p.get("outcomesModule") or {}).get(key, [])
        ]

    trial = TrialInput(
        nct_id=ident["nctId"],
        brief_title=ident.get("briefTitle") or "",
        official_title=ident.get("officialTitle") or "",
        overall_status=status.get("overallStatus") or "",
        study_type=design.get("studyType") or "",
        phase=design.get("phases") or [],
        conditions=cond.get("conditions") or [],
        keywords=cond.get("keywords") or [],
        brief_summary=desc.get("briefSummary") or "",
        detailed_description=desc.get("detailedDescription") or "",
        eligibility=Eligibility(
            raw_text=raw,
            inclusion_text=inclusion,
            exclusion_text=exclusion,
            section_found=section_found,
            minimum_age=elig.get("minimumAge") or "",
            maximum_age=elig.get("maximumAge") or "",
            sex=elig.get("sex") or "",
            population=elig.get("studyPopulation") or "",
        ),
        arms_and_cohorts=arms,
        interventions=interventions,
        primary_outcomes=outcomes("primaryOutcomes"),
        secondary_outcomes=outcomes("secondaryOutcomes"),
        locations=[
            Location(
                facility=location.get("facility") or "",
                city=location.get("city") or "",
                country=location.get("country") or "",
                status=location.get("status") or "",
            )
            for location in (p.get("contactsLocationsModule") or {}).get("locations", [])
        ],
        sponsor=((p.get("sponsorCollaboratorsModule") or {}).get("leadSponsor") or {}).get("name")
        or "",
        last_update_date=(status.get("lastUpdatePostDateStruct") or {}).get("date") or "",
        study_start_date=(status.get("startDateStruct") or {}).get("date") or "",
        candidate_retrieval_reasons=reasons or [],
    )
    trial.deterministic_signals = extract_signals(trial)
    return trial


def extract_signals(trial: TrialInput) -> Signals:
    context = " ".join(
        [
            trial.brief_title,
            trial.official_title,
            *trial.conditions,
            trial.brief_summary,
            trial.eligibility.raw_text,
            trial.eligibility.population,
        ]
    )
    arm_text = " ".join(a.label + " " + a.description for a in trial.arms_and_cohorts)
    # any LM exclusion or conditional mention sends the trial to stage 2, even if it might allow LM
    negative = [
        s
        for s in lm_passages(context + " " + trial.detailed_description + " " + arm_text)
        if re.search(
            r"\b(no|not|without|absen\w*|exclud\w*|except|unless|symptomatic|washout)\b", s, re.I
        )
    ]
    negative.extend(lm_passages(trial.eligibility.exclusion_text))
    return Signals(
        lm_terms_in_title=detect(trial.brief_title + " " + trial.official_title, context),
        lm_terms_in_conditions=detect(" ".join(trial.conditions), context),
        lm_terms_in_summary=detect(trial.brief_summary, context),
        lm_terms_in_inclusion=detect(trial.eligibility.inclusion_text, context),
        lm_terms_in_exclusion=detect(trial.eligibility.exclusion_text, context),
        lm_terms_in_arm_text=detect(arm_text, context),
        negative_lm_phrases=sorted(set(negative)),
        possible_lm_cohort=bool(detect(arm_text, context)),
    )
