"""Provider contract and explicit factory; provider identity is part of every cache key."""

from typing import Protocol

from .config import ModelConfig
from .gemini_client import GeminiClient, ModelReply


class ModelClient(Protocol):
    config: ModelConfig

    def generate(self, system: str, task: str, payload: dict) -> ModelReply: ...

    def close(self) -> None: ...


def create_model_client(config: ModelConfig) -> ModelClient:
    if config.provider == "ollama":
        from .ollama_client import OllamaClient

        return OllamaClient(config)
    if config.provider == "google":
        return GeminiClient(config)
    if config.provider in ("openai", "openai-compatible"):
        from .openai_client import OpenAIClient

        return OpenAIClient(config)
    if config.provider == "anthropic":
        from .anthropic_client import AnthropicClient

        return AnthropicClient(config)
    raise ValueError("Unsupported provider")
