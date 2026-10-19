"""Public CTG API v2 with bounded retries and fail-closed pagination."""

import re
import time

import httpx

from .config import RegistryConfig

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"


class RegistryError(RuntimeError):
    pass


class RegistryClient:
    def __init__(self, config: RegistryConfig, client: httpx.Client | None = None):
        self.config = config
        self.client = client or httpx.Client(
            timeout=config.timeout_seconds,
            headers={
                "Accept": "application/json",
                "User-Agent": "LeptoTrials-research-harness/0.1",
            },
        )

    def close(self):
        self.client.close()

    def get_json(self, url: str, params: dict | None = None) -> dict:
        for attempt in range(self.config.max_attempts):
            try:
                response = self.client.get(url, params=params)
                if response.status_code == 429 or response.status_code >= 500:
                    if attempt + 1 < self.config.max_attempts:
                        retry_after = response.headers.get("Retry-After", "")
                        delay = float(retry_after) if retry_after.isdigit() else 2**attempt
                        time.sleep(min(delay, 30))
                        continue
                response.raise_for_status()
                data = response.json()
                if not isinstance(data, dict):
                    raise RegistryError("Registry returned a non-object response")
                return data
            except httpx.TransportError:
                if attempt + 1 < self.config.max_attempts:
                    time.sleep(2**attempt)
                    continue
                raise RegistryError("Registry transport failure after bounded retries") from None
            except (httpx.HTTPStatusError, ValueError) as exc:
                code = response.status_code
                raise RegistryError(
                    f"Registry request failed (HTTP {code}; {type(exc).__name__})"
                ) from None
        raise RegistryError("Registry retries exhausted")

    def study(self, nct_id: str) -> dict:
        if not re.fullmatch(r"NCT\d{8}", nct_id):
            raise RegistryError("Invalid NCT identifier")
        data = self.get_json(f"{BASE_URL}/{nct_id}")
        if data.get("protocolSection", {}).get("identificationModule", {}).get("nctId") != nct_id:
            raise RegistryError("Missing/mismatched registry study ID")
        return data

    def search(self, kind: str, value: str, statuses: list[str], advanced: str = "") -> list[dict]:
        params = {f"query.{kind}": value, "pageSize": self.config.page_size, "format": "json"}
        if statuses:
            params["filter.overallStatus"] = ",".join(statuses)
        if advanced:
            params["filter.advanced"] = advanced
        studies, tokens = [], set()
        for _ in range(self.config.max_pages):
            data = self.get_json(BASE_URL, params)
            if not isinstance(data.get("studies"), list):
                raise RegistryError("Registry search missing studies array")
            studies.extend(data["studies"])
            token = data.get("nextPageToken")
            if not token:
                return studies
            if not isinstance(token, str) or token in tokens:
                raise RegistryError("Repeated or malformed pagination token; retrieval incomplete")
            tokens.add(token)
            params["pageToken"] = token
        raise RegistryError("Pagination limit exceeded; retrieval incomplete")
