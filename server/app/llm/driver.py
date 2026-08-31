"""Hosted-agent LLM driver: per-turn calls, post-match reflection, key tests.

Timeouts: provider timeout = deadline - 1s; one retry only on transport/API
errors when at least 2s remain. Spend caps stop calling mid-match (empty turns).
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

import httpx

from app.llm import costs, providers
from app.llm.prompts import (
    ORDERS_SCHEMA,
    REFLECTION_SCHEMA,
    reflection_user_message,
    system_block_identity,
    system_block_rules,
    turn_user_message,
)


@dataclass
class HostedAgentCtx:
    agent_id: uuid.UUID
    name: str
    lineage: str
    level: int
    deadline_s: int
    history_turns: int
    band: str
    diplo: list[str]
    charter: str | None
    book_entries: list[str]
    provider: str
    model: str
    api_key: str
    max_tokens: int
    temperature_x100: int | None
    purpose: str = "turn"                      # turn | house | practice
    match_cap_micros: int = 1_000_000          # $1.00 default
    day_cap_micros: int = 5_000_000            # $5.00 default
    capped: bool = field(default=False)        # set once a cap trips

    def system_blocks(self) -> list[str]:
        return [system_block_rules(),
                system_block_identity(self.name, self.lineage, self.level,
                                      self.deadline_s, self.history_turns, self.band,
                                      self.diplo, self.charter, self.book_entries)]


async def call_for_turn(db, ctx: HostedAgentCtx, match_id, turn_number: int,
                        obs: dict) -> tuple[dict | None, str]:
    """Returns (parsed orders dict or None, status). Records the llm_call."""
    if ctx.capped:
        return None, "capped"
    spent_match = await costs.match_spend_micros(db, match_id, ctx.agent_id)
    spent_day = await costs.day_spend_micros(db, ctx.agent_id)
    if spent_match >= ctx.match_cap_micros or spent_day >= ctx.day_cap_micros:
        ctx.capped = True
        await costs.record_call(db, match_id=match_id, agent_id=ctx.agent_id,
                                turn_number=turn_number, provider=ctx.provider,
                                model=ctx.model, purpose=ctx.purpose,
                                status="error", error_code="spend_cap")
        return None, "spend_cap"

    price = await costs.get_price(db, ctx.provider, ctx.model)
    deadline = time.perf_counter() + ctx.deadline_s
    timeout = max(ctx.deadline_s - 1, 2)
    user = turn_user_message(obs)

    attempts = 0
    while attempts < 2:
        attempts += 1
        try:
            result = await asyncio.wait_for(
                providers.complete(ctx.provider, api_key=ctx.api_key, model=ctx.model,
                                   system_blocks=ctx.system_blocks(), user=user,
                                   schema=ORDERS_SCHEMA, max_tokens=ctx.max_tokens,
                                   temperature_x100=ctx.temperature_x100,
                                   timeout_s=timeout),
                timeout=timeout)
        except (TimeoutError, asyncio.TimeoutError):
            await costs.record_call(db, match_id=match_id, agent_id=ctx.agent_id,
                                    turn_number=turn_number, provider=ctx.provider,
                                    model=ctx.model, purpose=ctx.purpose,
                                    status="timeout", error_code="deadline")
            return None, "timeout"
        except (httpx.HTTPError, ValueError) as exc:
            remaining = deadline - time.perf_counter()
            if attempts < 2 and remaining >= 2:
                timeout = max(remaining - 0.5, 1.5)
                continue
            await costs.record_call(db, match_id=match_id, agent_id=ctx.agent_id,
                                    turn_number=turn_number, provider=ctx.provider,
                                    model=ctx.model, purpose=ctx.purpose,
                                    status="error", error_code=type(exc).__name__[:64])
            return None, "error"
        cost = costs.call_cost_micros(price, result.input_tokens, result.cached_tokens,
                                      result.output_tokens)
        status = "ok" if result.parsed is not None else "malformed"
        await costs.record_call(db, match_id=match_id, agent_id=ctx.agent_id,
                                turn_number=turn_number, provider=ctx.provider,
                                model=ctx.model, purpose=ctx.purpose, result=result,
                                status=status, cost_micros=cost)
        return result.parsed, status
    return None, "error"


async def call_for_reflection(db, ctx: HostedAgentCtx, match_id, summary: dict,
                              capacity: int) -> dict | None:
    user = reflection_user_message(summary, ctx.book_entries, capacity, ctx.charter)
    price = await costs.get_price(db, ctx.provider, ctx.model)
    try:
        result = await providers.complete(
            ctx.provider, api_key=ctx.api_key, model=ctx.model,
            system_blocks=ctx.system_blocks(), user=user, schema=REFLECTION_SCHEMA,
            max_tokens=1500, temperature_x100=ctx.temperature_x100, timeout_s=30)
    except (httpx.HTTPError, ValueError) as exc:
        await costs.record_call(db, match_id=match_id, agent_id=ctx.agent_id,
                                turn_number=None, provider=ctx.provider,
                                model=ctx.model, purpose="reflection",
                                status="error", error_code=type(exc).__name__[:64])
        return None
    cost = costs.call_cost_micros(price, result.input_tokens, result.cached_tokens,
                                  result.output_tokens)
    await costs.record_call(db, match_id=match_id, agent_id=ctx.agent_id,
                            turn_number=None, provider=ctx.provider, model=ctx.model,
                            purpose="reflection", result=result,
                            status="ok" if result.parsed else "malformed",
                            cost_micros=cost)
    return result.parsed


async def test_key(db, agent_id, provider: str, model: str, api_key: str) -> dict:
    """Small probe call used by PUT /agents/{id}/model."""
    price = await costs.get_price(db, provider, model)
    try:
        result = await providers.complete(
            provider, api_key=api_key, model=model,
            system_blocks=["You are a connectivity probe. Reply with JSON."],
            user='Reply exactly {"ok": true}',
            schema={"type": "object", "additionalProperties": False,
                    "required": ["ok"], "properties": {"ok": {"type": "boolean"}}},
            max_tokens=64, temperature_x100=None, timeout_s=20)
    except (httpx.HTTPError, ValueError) as exc:
        await costs.record_call(db, match_id=None, agent_id=agent_id, turn_number=None,
                                provider=provider, model=model, purpose="test",
                                status="error", error_code=type(exc).__name__[:64])
        return {"ok": False, "error": type(exc).__name__}
    cost = costs.call_cost_micros(price, result.input_tokens, result.cached_tokens,
                                  result.output_tokens)
    await costs.record_call(db, match_id=None, agent_id=agent_id, turn_number=None,
                            provider=provider, model=model, purpose="test",
                            result=result, status="ok", cost_micros=cost)
    estimate = costs.estimate_match_cost_micros(price)
    return {"ok": result.parsed is not None, "latency_ms": result.latency_ms,
            "sample_tokens": result.output_tokens,
            "est_cost_per_match_usd_cents": estimate // 10_000}
