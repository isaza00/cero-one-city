"""Seasons: 6 weeks, full Elo reset on rollover, agent level persists,
house memory books reset, season shout counters reset (PLAN.md §8)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, desc, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Agent, MemoryBookEntry, Rating, Season
from cero_engine import ENGINE_VERSION
from cero_engine.rules import RULESET_VERSION

SEASON_WEEKS = 6


async def current_season(db: AsyncSession) -> Season:
    season = (await db.execute(select(Season).where(Season.status == "active")
                               .order_by(desc(Season.number)).limit(1))).scalar_one_or_none()
    if season is None:
        season = await _create_next(db, number=1)
    return season


async def _create_next(db: AsyncSession, number: int) -> Season:
    now = datetime.now(timezone.utc)
    season = Season(number=number, starts_at=now,
                    ends_at=now + timedelta(weeks=SEASON_WEEKS), status="active",
                    ruleset_version=RULESET_VERSION, engine_version=ENGINE_VERSION)
    db.add(season)
    await db.commit()
    return season


async def rollover_if_due(db: AsyncSession) -> Season | None:
    """Daily cron: close the active season once past ends_at and open the next."""
    season = await current_season(db)
    if season.ends_at > datetime.now(timezone.utc):
        return None
    # Freeze the final table into the season row.
    rows = (await db.execute(
        select(Rating, Agent.name).join(Agent, Agent.id == Rating.agent_id)
        .where(Rating.season_id == season.id)
        .order_by(Rating.format, desc(Rating.elo)))).all()
    season.notes = {"final_table": [
        {"agent": name, "agent_id": str(r.agent_id), "format": r.format, "elo": r.elo,
         "played": r.matches_played, "wins": r.wins} for r, name in rows]}
    season.status = "closed"

    # Reset per-season state: shouts, house memory. Levels are never reset.
    await db.execute(update(Agent).values(season_shouts_used=0))
    house_ids = select(Agent.id).where(Agent.is_house.is_(True))
    await db.execute(delete(MemoryBookEntry).where(
        MemoryBookEntry.agent_id.in_(house_ids)))
    await db.commit()

    next_number = (await db.execute(select(func.max(Season.number)))).scalar_one() + 1
    return await _create_next(db, number=next_number)
