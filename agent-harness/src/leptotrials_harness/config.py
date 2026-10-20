"""Config loading and paths to bundled prompts/schemas."""

import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

import yaml
from dotenv import load_dotenv
from pydantic import Field, model_validator

from .models import StrictModel

SOURCE_ROOT = Path(__file__).resolve().parents[2]
RESOURCES = (
    SOURCE_ROOT if (SOURCE_ROOT / "config").is_dir() else Path(__file__).parent / "resources"
)


class ModelConfig(StrictModel):
    provider: Literal["google", "openai", "anthropic", "openai-compatible", "ollama"] = "google"
    model_id: str = "gemini-3.8-flash"
    reasoning_effort: Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"] | None = (
        "high"
    )
    temperature: float = Field(default=0.0, ge=0, le=2)
    timeout_seconds: int = Field(default=90, gt=0)
    max_attempts: int = Field(default=3, ge=1, le=5)
    max_output_tokens: int = Field(default=16384, ge=1024)
    api_key_env: str | None = None
    base_url: str | None = None
    send_temperature: bool = False
    context_length: int = Field(default=32768, ge=2048)
    local_thinking: bool = True
    model_revision: str | None = None
    input_usd_per_million: float | None = Field(default=None, ge=0)
    output_usd_per_million: float | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def provider_settings(self):
        if self.provider == "google" and self.reasoning_effort not in (
            None,
            "low",
            "medium",
            "high",
        ):
            raise ValueError("Gemini 3.8 supports low/medium/high thinking")
        if self.provider == "openai-compatible" and not self.base_url:
            raise ValueError("OpenAI-compatible provider requires an explicit base_url")
        if self.base_url:
            parsed = urlsplit(self.base_url)
            local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
            if parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError("base_url cannot contain credentials, query strings or fragments")
            if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
                raise ValueError("Provider URLs must use HTTPS (HTTP allowed only for loopback)")
            if self.provider not in ("openai-compatible", "ollama"):
                raise ValueError("Custom endpoints require a compatible or Ollama provider")
            if self.provider == "ollama" and not local:
                raise ValueError("Native Ollama provider is local-only; use a loopback URL")
        return self


class Search(StrictModel):
    kind: Literal["cond", "term"]
    value: str


class RegistryConfig(StrictModel):
    timeout_seconds: int = Field(default=45, gt=0)
    max_attempts: int = Field(default=4, ge=1, le=5)
    max_pages: int = Field(default=200, ge=1)
    page_size: int = Field(default=100, ge=1, le=1000)
    statuses: list[str]
    searches: list[Search]


class Config(StrictModel):
    model: ModelConfig
    registry: RegistryConfig


def load_config(path: Path | None = None) -> Config:
    # only the .env in the working directory, not parent folders
    load_dotenv(Path.cwd() / ".env", override=False)
    data = yaml.safe_load((RESOURCES / "config/default.yaml").read_text())
    if path:
        overrides = yaml.safe_load(path.read_text())
        for section, values in overrides.items():
            if section not in data or not isinstance(values, dict):
                raise ValueError(f"Unsupported configuration section: {section}")
            data[section].update(values)
    if os.getenv("HARNESS_PROVIDER"):
        data["model"]["provider"] = os.environ["HARNESS_PROVIDER"]
        if not os.getenv("HARNESS_MODEL"):
            raise ValueError("HARNESS_PROVIDER override requires HARNESS_MODEL")
    if os.getenv("HARNESS_MODEL"):
        data["model"]["model_id"] = os.environ["HARNESS_MODEL"]
    elif data["model"]["provider"] == "google" and os.getenv("GEMINI_MODEL"):
        data["model"]["model_id"] = os.environ["GEMINI_MODEL"]
    return Config.model_validate(data)
