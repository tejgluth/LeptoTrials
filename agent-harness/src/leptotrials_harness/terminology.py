"""Term lists used to flag LM mentions and abbreviations (signals only)."""

import re

import yaml

from .config import RESOURCES

TERMS = yaml.safe_load((RESOURCES / "config/terminology.yaml").read_text())


def detect(text: str, context: str = "") -> list[str]:
    found = [t for t in TERMS["terms"] if re.search(r"\b" + re.escape(t) + r"\b", text, re.I)]
    abbreviations = [t for t in TERMS["abbreviations"] if re.search(r"\b" + t + r"\b", text, re.I)]
    # skip the expensive context scan when there's no abbreviation to disambiguate
    if abbreviations and (
        re.search(TERMS["oncology_context"], text + " " + context, re.I)
        or any(
            t not in {"leptomeningeal", "lepto-meningeal", "leptomeninges", "meningeal disease"}
            and re.search(r"\b" + re.escape(t) + r"\b", context, re.I)
            for t in TERMS["terms"]
        )
    ):
        found.extend(abbreviations)
    return sorted(set(found))


def lm_passages(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"[\n;]|(?<=\.)\s+", text) if detect(s, text)]
