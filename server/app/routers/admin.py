"""Minimal admin surface: model prices, daily LLM spend, seasons, house agents,
kill-switches, user bans (PLAN.md §5/§9.15)."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_admin
from app.db import get_db
from app.db.models import AdminAudit, Agent, LlmCall, Match, ModelPrice, Season, Setting, User
from app.league.seasons import current_season

router = APIRouter(prefix="/api/admin", tags=["admin"])


async def _audit(db: AsyncSession, admin: User, action: str, payload: dict) -> None:
    db.add(AdminAudit(admin_id=admin.id, action=action, payload=payload))


@router.get("/model-prices")
async def get_prices(admin: User = Depends(get_admin),
                     db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(ModelPrice).order_by(
        ModelPrice.provider, ModelPrice.model))).scalars().all()
    return {"prices": [{"id": str(p.id), "provider": p.provider, "model": p.model,
                        "input": p.input_usd_per_mtok_micros,
                        "cached": p.cached_input_usd_per_mtok_micros,
                        "output": p.output_usd_per_mtok_micros,
                        "active": p.active} for p in rows]}


class PriceBody(BaseModel):
    provider: str
    model: str
    input: int = Field(ge=0)
    cached: int = Field(ge=0)
    output: int = Field(ge=0)
    active: bool = True


@router.put("/model-prices")
async def put_prices(body: list[PriceBody], admin: User = Depends(get_admin),
                     db: AsyncSession = Depends(get_db)) -> dict:
    for item in body:
        row = (await db.execute(select(ModelPrice).where(
            ModelPrice.provider == item.provider,
            ModelPrice.model == item.model))).scalar_one_or_none()
        if row is None:
            row = ModelPrice(provider=item.provider, model=item.model)
            db.add(row)
        row.input_usd_per_mtok_micros = item.input
        row.cached_input_usd_per_mtok_micros = item.cached
        row.output_usd_per_mtok_micros = item.output
        row.active = item.active
    await _audit(db, admin, "put_prices", {"count": len(body)})
    await db.commit()
    return await get_prices(admin, db)


@router.get("/costs")
async def costs_today(admin: User = Depends(get_admin),
                      db: AsyncSession = Depends(get_db)) -> dict:
    day_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0,
                                                   microsecond=0)
    rows = (await db.execute(
        select(LlmCall.purpose, LlmCall.provider,
               func.coalesce(func.sum(LlmCall.cost_usd_micros), 0),
               func.count(LlmCall.id))
        .where(LlmCall.created_at >= day_start)
        .group_by(LlmCall.purpose, LlmCall.provider))).all()
    total = sum(int(r[2]) for r in rows)
    live = (await db.execute(select(func.count(Match.id)).where(
        Match.status == "live"))).scalar_one()
    return {"llm_spend_today_usd": total / 1_000_000,
            "live_matches": int(live),
            "by_purpose_provider": [{"purpose": r[0], "provider": r[1],
                                     "usd": int(r[2]) / 1_000_000, "calls": int(r[3])}
                                    for r in rows]}


class SeasonBody(BaseModel):
    number: int
    starts_at: datetime | None = None
    weeks: int = 6


@router.post("/seasons")
async def create_season(body: SeasonBody, admin: User = Depends(get_admin),
                        db: AsyncSession = Depends(get_db)) -> dict:
    from cero_engine import ENGINE_VERSION
    from cero_engine.rules import RULESET_VERSION
    starts = body.starts_at or datetime.now(timezone.utc)
    season = Season(number=body.number, starts_at=starts,
                    ends_at=starts + timedelta(weeks=body.weeks), status="active",
                    ruleset_version=RULESET_VERSION, engine_version=ENGINE_VERSION)
    db.add(season)
    await _audit(db, admin, "create_season", {"number": body.number})
    await db.commit()
    return {"season": {"number": season.number, "ends_at": season.ends_at.isoformat()}}


@router.post("/seasons/close")
async def close_season(admin: User = Depends(get_admin),
                       db: AsyncSession = Depends(get_db)) -> dict:
    season = await current_season(db)
    season.ends_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db.commit()
    from app.league.seasons import rollover_if_due
    new = await rollover_if_due(db)
    await _audit(db, admin, "close_season", {"closed": season.number})
    await db.commit()
    return {"closed": season.number, "opened": new.number if new else None}


@router.get("/house-agents")
async def house_agents(admin: User = Depends(get_admin),
                       db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(Agent).where(Agent.is_house.is_(True))
                             .order_by(Agent.name))).scalars().all()
    return {"agents": [{"id": str(a.id), "name": a.name, "tier": a.house_tier,
                        "lineage": a.lineage, "level": a.level, "active": a.active,
                        "charter": a.charter} for a in rows]}


class HousePatch(BaseModel):
    charter: str | None = Field(default=None, max_length=4000)
    tier: str | None = None
    active: bool | None = None


@router.patch("/house-agents/{agent_id}")
async def patch_house(agent_id: uuid.UUID, body: HousePatch,
                      admin: User = Depends(get_admin),
                      db: AsyncSession = Depends(get_db)) -> dict:
    agent = await db.get(Agent, agent_id)
    if agent is None or not agent.is_house:
        raise HTTPException(404, detail={"code": "not_found",
                                         "message": "no such house agent"})
    if body.charter is not None:
        agent.charter = body.charter
    if body.tier in ("rookie", "veteran", "elite"):
        agent.house_tier = body.tier
    if body.active is not None:
        agent.active = body.active
    await _audit(db, admin, "patch_house", {"agent": agent.name})
    await db.commit()
    return {"id": str(agent.id), "name": agent.name, "tier": agent.house_tier,
            "active": agent.active}


class BanBody(BaseModel):
    reason: str = Field(max_length=300)


@router.post("/users/{user_id}/ban", status_code=204)
async def ban_user(user_id: uuid.UUID, body: BanBody,
                   admin: User = Depends(get_admin),
                   db: AsyncSession = Depends(get_db)) -> None:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "no such user"})
    user.banned_at = datetime.now(timezone.utc)
    await _audit(db, admin, "ban_user", {"user": str(user_id), "reason": body.reason})
    await db.commit()


class KillswitchBody(BaseModel):
    matchmaking: bool | None = None
    practice: bool | None = None


@router.post("/killswitch")
async def killswitch(body: KillswitchBody, admin: User = Depends(get_admin),
                     db: AsyncSession = Depends(get_db)) -> dict:
    setting = (await db.execute(select(Setting).where(
        Setting.key == "killswitch"))).scalar_one_or_none()
    value = dict(setting.value) if setting else {"matchmaking": True, "practice": True}
    if body.matchmaking is not None:
        value["matchmaking"] = body.matchmaking
    if body.practice is not None:
        value["practice"] = body.practice
    if setting is None:
        setting = Setting(key="killswitch", value=value)
        db.add(setting)
    else:
        setting.value = value
    await _audit(db, admin, "killswitch", value)
    await db.commit()
    return {"settings": value}


@router.get("/matches")
async def admin_matches(status: str | None = None, limit: int = 30,
                        admin: User = Depends(get_admin),
                        db: AsyncSession = Depends(get_db)) -> dict:
    q = select(Match)
    if status:
        q = q.where(Match.status == status)
    rows = (await db.execute(q.order_by(desc(Match.created_at))
                             .limit(min(limit, 100)))).scalars().all()
    return {"matches": [{"id": str(m.id), "format": m.format, "status": m.status,
                         "turn": m.current_turn, "is_ranked": m.is_ranked,
                         "created_at": m.created_at.isoformat()} for m in rows]}
