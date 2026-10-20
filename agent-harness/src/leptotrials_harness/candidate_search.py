"""Broad ClinicalTrials.gov searches for candidate trials, tracking which query found each one."""

from .clinicaltrials_api import RegistryClient, RegistryError
from .logging_utils import now
from .trial_normalizer import normalize


def fetch_candidates(client: RegistryClient, statuses: list[str]) -> dict:
    by_id, searches = {}, []
    for query in client.config.searches:
        records = client.search(query.kind, query.value, statuses)
        reason = f"{query.kind}:{query.value}"
        searches.append({"query": reason, "count": len(records)})
        for raw in records:
            try:
                trial = normalize(raw, [reason])
            except (KeyError, TypeError, ValueError) as exc:
                raise RegistryError(f"Malformed candidate record: {type(exc).__name__}") from None
            if trial.nct_id in by_id:
                by_id[trial.nct_id]["candidate_retrieval_reasons"].append(reason)
            else:
                by_id[trial.nct_id] = trial.model_dump(mode="json")
    return {
        "kind": "research_candidates_not_production",
        "complete": True,
        "captured_at": now(),
        "source_url": "https://clinicaltrials.gov/api/v2/studies",
        "statuses": statuses,
        "searches": searches,
        "count": len(by_id),
        "trials": list(by_id.values()),
    }
