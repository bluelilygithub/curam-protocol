"""Provider-agnostic LLM wrapper — reads LLM_PROVIDER from environment."""

from __future__ import annotations

import json
import os
from typing import Any


class LLMError(Exception):
    pass


def _provider() -> str:
    return (os.getenv("LLM_PROVIDER") or "anthropic").strip().lower()


def _model() -> str:
    model = os.getenv("LLM_MODEL", "").strip()
    if model:
        return model
    if _provider() == "anthropic":
        return "claude-sonnet-4-20250514"
    return "gpt-4o"


def generate(prompt: str, *, system: str | None = None, max_tokens: int = 4096) -> str:
    """Send a prompt to the configured LLM and return the text response."""
    provider = _provider()

    if provider == "anthropic":
        return _generate_anthropic(prompt, system=system, max_tokens=max_tokens)
    if provider in ("openai", "openai_compatible"):
        return _generate_openai(prompt, system=system, max_tokens=max_tokens)

    raise LLMError(
        f"Unsupported LLM_PROVIDER={provider!r}. Use anthropic, openai, or openai_compatible."
    )


def generate_json(prompt: str, *, system: str | None = None, max_tokens: int = 4096) -> Any:
    """Call generate and parse JSON from the response (strips markdown fences if present)."""
    text = generate(prompt, system=system, max_tokens=max_tokens)
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as err:
        raise LLMError(f"LLM did not return valid JSON: {err}\nRaw:\n{text[:500]}") from err


def _generate_anthropic(prompt: str, *, system: str | None, max_tokens: int) -> str:
    key = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not key:
        raise LLMError("ANTHROPIC_API_KEY is not set")

    try:
        import anthropic
    except ImportError as err:
        raise LLMError("Install anthropic: pip install anthropic") from err

    client = anthropic.Anthropic(api_key=key)
    kwargs: dict[str, Any] = {
        "model": _model(),
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        kwargs["system"] = system

    message = client.messages.create(**kwargs)
    parts = [b.text for b in message.content if hasattr(b, "text") and b.text]
    if not parts:
        raise LLMError("Empty response from Anthropic")
    return "\n".join(parts).strip()


def _generate_openai(prompt: str, *, system: str | None, max_tokens: int) -> str:
    key = os.getenv("OPENAI_API_KEY", "").strip()
    if not key:
        raise LLMError("OPENAI_API_KEY is not set")

    try:
        from openai import OpenAI
    except ImportError as err:
        raise LLMError("Install openai: pip install openai") from err

    base_url = os.getenv("OPENAI_BASE_URL", "").strip() or None
    client = OpenAI(api_key=key, base_url=base_url)

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    response = client.chat.completions.create(
        model=_model(),
        messages=messages,
        max_tokens=max_tokens,
    )
    text = response.choices[0].message.content
    if not text:
        raise LLMError("Empty response from OpenAI-compatible API")
    return text.strip()
