"""League endpoints: leaderboard, seasons, notifications."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_db
from app.db.models import Agent, Notification, Rating, Season, User
from app.league.seasons import current_season

router = APIRouter(prefix="/api", tags=["league"])


@router.get("/models")
async def public_models(db: AsyncSession = Depends(get_db)) -> dict:
    """Active models a player can pick when connecting an agent."""
    from app.db.models import ModelPrice
    rows = (await db.execute(select(ModelPrice).where(ModelPrice.active.is_(True))
                             .order_by(ModelPrice.provider, ModelPrice.model))).scalars().all()
    return {"models": [{"provider": p.provider, "model": p.model,
                        "input_usd_per_mtok": p.input_usd_per_mtok_micros / 1_000_000,
                        "output_usd_per_mtok": p.output_usd_per_mtok_micros / 1_000_000}
                       for p in rows]}


@router.get("/leaderboard")
async def leaderboard(season: int | None = None, format: str = "1v1",
                      limit: int = 50, offset: int = 0,
                      db: AsyncSession = Depends(get_db)) -> dict:
    if season is None:
        season_row = await current_season(db)
    else:
        season_row = (await db.execute(select(Season).where(
            Season.number == season))).scalar_one_or_none()
        if season_row is None:
            return {"rows": [], "season": None}
    fmt = "1v1" if format == "1v1" else "ffa"
    rows = (await db.execute(
        select(Rating, Agent).join(Agent, Agent.id == Rating.agent_id)
        .where(Rating.season_id == season_row.id, Rating.format == fmt,
               Agent.deleted_at.is_(None))
        .order_by(desc(Rating.elo)).limit(min(limit, 100)).offset(offset))).all()
    return {"season": season_row.number,
            "rows": [{"rank": offset + i + 1, "agent_id": str(a.id), "name": a.name,
                      "lineage": a.lineage, "kind": a.kind, "level": a.level,
                      "title": a.title, "is_house": a.is_house, "elo": r.elo,
                      "played": r.matches_played, "wins": r.wins}
                     for i, (r, a) in enumerate(rows)]}


@router.get("/seasons")
async def seasons(db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(Season).order_by(desc(Season.number)))).scalars().all()
    return {"seasons": [{"number": s.number, "status": s.status,
                         "starts_at": s.starts_at.isoformat(),
                         "ends_at": s.ends_at.isoformat(),
                         "ruleset_version": s.ruleset_version,
                         "final_table": (s.notes or {}).get("final_table")
                         if s.status == "closed" else None} for s in rows]}


@router.get("/seasons/current")
async def season_current(db: AsyncSession = Depends(get_db)) -> dict:
    season = await current_season(db)
    days_left = max((season.ends_at - datetime.now(timezone.utc)).days, 0)
    return {"season": {"number": season.number, "ends_at": season.ends_at.isoformat(),
                       "ruleset_version": season.ruleset_version},
            "days_left": days_left}


@router.get("/notifications")
async def notifications(unread: bool = False, user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    q = select(Notification).where(Notification.user_id == user.id)
    if unread:
        q = q.where(Notification.read_at.is_(None))
    rows = (await db.execute(q.order_by(desc(Notification.created_at)).limit(50))
            ).scalars().all()
    return {"notifications": [{"id": str(n.id), "type": n.type, "payload": n.payload,
                               "read": n.read_at is not None,
                               "created_at": n.created_at.isoformat()} for n in rows]}


class ReadBody(BaseModel):
    ids: list[str]


@router.post("/notifications/read", status_code=204)
async def mark_read(body: ReadBody, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)) -> None:
    import uuid as _uuid
    now = datetime.now(timezone.utc)
    for raw in body.ids[:100]:
        try:
            nid = _uuid.UUID(raw)
        except ValueError:
            continue
        n = await db.get(Notification, nid)
        if n is not None and n.user_id == user.id and n.read_at is None:
            n.read_at = now
    await db.commit()
