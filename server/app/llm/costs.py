"""Cost accounting: model price lookup, per-call cost, spend caps, estimates."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import LlmCall, ModelPrice

# Seed prices (USD per MTok, in micros). Editable by the admin afterwards.
SEED_PRICES = [
    ("anthropic", "claude-haiku-4-5", 1_000_000, 100_000, 5_000_000),
    ("anthropic", "claude-sonnet-5", 3_000_000, 300_000, 15_000_000),
    ("anthropic", "claude-opus-5", 5_000_000, 500_000, 25_000_000),
    ("mock", "boom", 0, 0, 0),
    ("mock", "rush", 0, 0, 0),
    ("mock", "turtle", 0, 0, 0),
    ("mock", "random", 0, 0, 0),
]


async def seed_model_prices(db: AsyncSession) -> None:
    existing = {(p.provider, p.model)
                for p in (await db.execute(select(ModelPrice))).scalars()}
    for provider, model, inp, cached, out in SEED_PRICES:
        if (provider, model) not in existing:
            db.add(ModelPrice(provider=provider, model=model,
                              input_usd_per_mtok_micros=inp,
                              cached_input_usd_per_mtok_micros=cached,
                              output_usd_per_mtok_micros=out))
    await db.commit()


async def get_price(db: AsyncSession, provider: str, model: str) -> ModelPrice | None:
    return (await db.execute(select(ModelPrice).where(
        ModelPrice.provider == provider, ModelPrice.model == model,
        ModelPrice.active.is_(True)))).scalar_one_or_none()


def call_cost_micros(price: ModelPrice | None, input_tokens: int, cached_tokens: int,
                     output_tokens: int) -> int:
    if price is None:
        return 0
    fresh = max(input_tokens - cached_tokens, 0)
    return (fresh * price.input_usd_per_mtok_micros
            + cached_tokens * price.cached_input_usd_per_mtok_micros
            + output_tokens * price.output_usd_per_mtok_micros) // 1_000_000


def estimate_match_cost_micros(price: ModelPrice | None) -> int:
    """PLAN.md §6.5.7: 35 turns x (2200 cached + 1200 input + 450 output) + one
    reflection call (3000 in / 800 out)."""
    if price is None:
        return 0
    per_turn = call_cost_micros(price, 1200 + 2200, 2200, 450)
    reflection = call_cost_micros(price, 3000, 0, 800)
    return 35 * per_turn + reflection


async def match_spend_micros(db: AsyncSession, match_id: uuid.UUID,
                             agent_id: uuid.UUID) -> int:
    total = (await db.execute(select(func.coalesce(func.sum(LlmCall.cost_usd_micros), 0))
                              .where(LlmCall.match_id == match_id,
                                     LlmCall.agent_id == agent_id))).scalar_one()
    return int(total)


async def day_spend_by_purpose_micros(db: AsyncSession, purpose: str) -> int:
    """Global daily spend for game-paid purposes (house / practice budgets)."""
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    total = (await db.execute(select(func.coalesce(func.sum(LlmCall.cost_usd_micros), 0))
                              .where(LlmCall.purpose == purpose,
                                     LlmCall.created_at >= day_start))).scalar_one()
    return int(total)


async def day_spend_micros(db: AsyncSession, agent_id: uuid.UUID) -> int:
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    total = (await db.execute(select(func.coalesce(func.sum(LlmCall.cost_usd_micros), 0))
                              .where(LlmCall.agent_id == agent_id,
                                     LlmCall.created_at >= day_start))).scalar_one()
    return int(total)


async def record_call(db: AsyncSession, *, match_id, agent_id, turn_number, provider,
                      model, purpose, result=None, status="ok", error_code=None,
                      cost_micros: int = 0) -> None:
    db.add(LlmCall(
        match_id=match_id, agent_id=agent_id, turn_number=turn_number,
        provider=provider, model=model, purpose=purpose,
        input_tokens=getattr(result, "input_tokens", 0),
        cached_tokens=getattr(result, "cached_tokens", 0),
        output_tokens=getattr(result, "output_tokens", 0),
        cost_usd_micros=cost_micros,
        latency_ms=getattr(result, "latency_ms", 0),
        status=status, error_code=error_code))
    await db.commit()
