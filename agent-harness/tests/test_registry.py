import httpx
import pytest
from conftest import raw_trial

from leptotrials_harness.clinicaltrials_api import RegistryClient, RegistryError


def registry(config, callback):
    return RegistryClient(config.registry, httpx.Client(transport=httpx.MockTransport(callback)))


def test_pagination_and_failed_later_page(config):
    calls = []

    def callback(request):
        calls.append(dict(request.url.params))
        if "pageToken" in request.url.params:
            return httpx.Response(200, json={"studies": []})
        return httpx.Response(200, json={"studies": [raw_trial()], "nextPageToken": "page2"})

    assert len(registry(config, callback).search("term", "leptomeningeal", [])) == 1
    assert calls[1]["pageToken"] == "page2"

    def failed(request):
        return (
            httpx.Response(400, json={}) if "pageToken" in request.url.params else callback(request)
        )

    with pytest.raises(RegistryError):
        registry(config, failed).search("term", "leptomeningeal", [])


def test_repeated_tokens_malformed_response_and_retry(config, monkeypatch):
    monkeypatch.setattr("leptotrials_harness.clinicaltrials_api.time.sleep", lambda _: None)
    repeated = registry(
        config, lambda _: httpx.Response(200, json={"studies": [], "nextPageToken": "x"})
    )
    with pytest.raises(RegistryError, match="Repeated"):
        repeated.search("term", "x", [])
    malformed = registry(config, lambda _: httpx.Response(200, json={"wrong": []}))
    with pytest.raises(RegistryError, match="missing studies"):
        malformed.search("term", "x", [])
    statuses = iter([429, 503, 200])
    retry = registry(config, lambda _: httpx.Response(next(statuses), json={"studies": []}))
    assert retry.search("term", "x", []) == []
