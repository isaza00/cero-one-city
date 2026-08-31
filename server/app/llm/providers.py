"""Provider adapters (Anthropic, OpenAI, Google, OpenRouter) over raw HTTPS.

Each adapter returns (parsed_json_or_None, raw_text, usage) and never raises on
model output problems - only on transport/API errors (httpx exceptions), which
the caller may retry once within the deadline.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass

import httpx

from app.llm.json_extract import extract_json

_client: httpx.AsyncClient | None = None


def http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=30.0)
    return _client


@dataclass
class LLMResult:
    parsed: dict | None
    text: str
    input_tokens: int = 0
    cached_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0


async def complete(provider: str, *, api_key: str, model: str,
                   system_blocks: list[str], user: str, schema: dict | None,
                   max_tokens: int, temperature_x100: int | None,
                   timeout_s: float) -> LLMResult:
    t0 = time.perf_counter()
    if provider == "anthropic":
        result = await _anthropic(api_key, model, system_blocks, user, schema,
                                  max_tokens, timeout_s)
    elif provider == "openai":
        result = await _openai_style("https://api.openai.com/v1/chat/completions",
                                     api_key, model, system_blocks, user, schema,
                                     max_tokens, temperature_x100, timeout_s)
    elif provider == "openrouter":
        result = await _openai_style("https://openrouter.ai/api/v1/chat/completions",
                                     api_key, model, system_blocks, user, schema,
                                     max_tokens, temperature_x100, timeout_s)
    elif provider == "google":
        result = await _google(api_key, model, system_blocks, user, schema,
                               max_tokens, timeout_s)
    else:
        raise ValueError(f"unknown provider {provider}")
    result.latency_ms = int((time.perf_counter() - t0) * 1000)
    return result


async def _anthropic(api_key: str, model: str, system_blocks: list[str], user: str,
                     schema: dict | None, max_tokens: int, timeout_s: float) -> LLMResult:
    system = [{"type": "text", "text": block} for block in system_blocks]
    if system:
        # One cache breakpoint at the end of the stable prefix (rules + identity).
        system[-1]["cache_control"] = {"type": "ephemeral"}
    body: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
    }
    if schema is not None:
        body["output_config"] = {"format": {"type": "json_schema", "schema": schema}}
    resp = await http().post(
        "https://api.anthropic.com/v1/messages",
        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json=body, timeout=timeout_s)
    resp.raise_for_status()
    data = resp.json()
    text = "".join(b.get("text", "") for b in data.get("content", [])
                   if b.get("type") == "text")
    usage = data.get("usage", {})
    return LLMResult(parsed=extract_json(text), text=text,
                     input_tokens=usage.get("input_tokens", 0),
                     cached_tokens=usage.get("cache_read_input_tokens", 0) or 0,
                     output_tokens=usage.get("output_tokens", 0))


async def _openai_style(url: str, api_key: str, model: str, system_blocks: list[str],
                        user: str, schema: dict | None, max_tokens: int,
                        temperature_x100: int | None, timeout_s: float) -> LLMResult:
    body: dict = {
        "model": model,
        "max_completion_tokens": max_tokens,
        "messages": [{"role": "system", "content": "\n\n".join(system_blocks)},
                     {"role": "user", "content": user}],
    }
    if temperature_x100 is not None:
        body["temperature"] = temperature_x100 / 100
    if schema is not None:
        body["response_format"] = {
            "type": "json_schema",
            "json_schema": {"name": "orders", "schema": schema, "strict": False},
        }
    resp = await http().post(url, headers={"Authorization": f"Bearer {api_key}"},
                             json=body, timeout=timeout_s)
    if resp.status_code == 400 and schema is not None:
        # Some models/providers reject json_schema: retry with plain json mode.
        body["response_format"] = {"type": "json_object"}
        body.pop("max_completion_tokens", None)
        body["max_tokens"] = max_tokens
        resp = await http().post(url, headers={"Authorization": f"Bearer {api_key}"},
                                 json=body, timeout=timeout_s)
    resp.raise_for_status()
    data = resp.json()
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "") or ""
    usage = data.get("usage", {})
    cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0)
    return LLMResult(parsed=extract_json(text), text=text,
                     input_tokens=usage.get("prompt_tokens", 0),
                     cached_tokens=cached or 0,
                     output_tokens=usage.get("completion_tokens", 0))


async def _google(api_key: str, model: str, system_blocks: list[str], user: str,
                  schema: dict | None, max_tokens: int, timeout_s: float) -> LLMResult:
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model}:generateContent?key={api_key}")
    generation_config: dict = {"maxOutputTokens": max_tokens}
    if schema is not None:
        generation_config["responseMimeType"] = "application/json"
    body = {
        "systemInstruction": {"parts": [{"text": "\n\n".join(system_blocks)}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": generation_config,
    }
    resp = await http().post(url, json=body, timeout=timeout_s)
    resp.raise_for_status()
    data = resp.json()
    parts = ((data.get("candidates") or [{}])[0].get("content") or {}).get("parts", [])
    text = "".join(p.get("text", "") for p in parts)
    usage = data.get("usageMetadata", {})
    return LLMResult(parsed=extract_json(text), text=text,
                     input_tokens=usage.get("promptTokenCount", 0),
                     cached_tokens=usage.get("cachedContentTokenCount", 0) or 0,
                     output_tokens=usage.get("candidatesTokenCount", 0))


def parse_or_none(text: str) -> dict | None:
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return extract_json(text)
