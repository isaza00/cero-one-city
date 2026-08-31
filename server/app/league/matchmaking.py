"""Matchmaking tick (every 5s): Elo bands that widen with waiting time, house
back-fill after 60 seconds, one-agent-per-owner hard constraint (PLAN.md §8)."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Agent, Match, MatchPlayer, QueueEntry, Rating
from app.league import levels
from app.league.elo import INITIAL_ELO
from app.league.seasons import current_season
from cero_engine import ENGINE_VERSION
from cero_engine.rules import MAP_SIZE_1V1, MAP_SIZE_FFA, MAX_TURNS, RULESET_VERSION

BAND_BASE = 150
BAND_STEP = 50
BAND_STEP_SECONDS = 15
HOUSE_FILL_SECONDS = 60


def band_for_wait(wait_s: float) -> int:
    return BAND_BASE + BAND_STEP * int(max(wait_s, 0) // BAND_STEP_SECONDS)


async def matchmaking_tick(ctx) -> None:
    from app.db.session import session_factory
    redis = ctx["redis"]
    async with session_factory()() as db:
        for fmt in ("1v1", "ffa"):
            await _tick_format(db, redis, fmt)


async def _tick_format(db: AsyncSession, redis, fmt: str) -> None:
    now = datetime.now(timezone.utc)
    entries = (await db.execute(
        select(QueueEntry, Agent).join(Agent, Agent.id == QueueEntry.agent_id)
        .where(QueueEntry.format == fmt, QueueEntry.state == "waiting",
               QueueEntry.enqueued_at <= now)
        .order_by(QueueEntry.enqueued_at))).all()
    if not entries:
        return
    season = await current_season(db)

    pool = []
    for entry, agent in entries:
        rating = (await db.execute(select(Rating).where(
            Rating.season_id == season.id, Rating.agent_id == agent.id,
            Rating.format == fmt))).scalar_one_or_none()
        pool.append({"entry": entry, "agent": agent,
                     "elo": rating.elo if rating else INITIAL_ELO,
                     "wait": (now - entry.enqueued_at).total_seconds()})

    needed = 2 if fmt == "1v1" else 4
    while pool:
        anchor = pool[0]
        band = band_for_wait(anchor["wait"])
        candidates = [p for p in pool[1:]
                      if abs(p["elo"] - anchor["elo"]) <= max(band,
                                                              band_for_wait(p["wait"]))
                      and p["agent"].owner_id != anchor["agent"].owner_id]
        # One agent per owner inside the match (anti-collusion).
        seen_owners = {anchor["agent"].owner_id}
        picked = [anchor]
        for c in sorted(candidates, key=lambda p: abs(p["elo"] - anchor["elo"])):
            if c["agent"].owner_id in seen_owners:
                continue
            picked.append(c)
            seen_owners.add(c["agent"].owner_id)
            if len(picked) == needed:
                break

        if len(picked) < needed:
            min_real = 1 if fmt == "ffa" else 1
            if anchor["wait"] >= HOUSE_FILL_SECONDS and len(picked) >= min_real:
                house = await _house_candidates(db, season.id, fmt, anchor["elo"],
                                                needed - len(picked),
                                                {p["agent"].id for p in picked})
                picked.extend(house)
            if len(picked) < needed:
                break  # wait for more players / more waiting time

        await _create_match(db, redis, fmt, season.id, picked)
        matched_ids = {p["agent"].id for p in picked}
        pool = [p for p in pool if p["agent"].id not in matched_ids]


async def _house_candidates(db: AsyncSession, season_id: int, fmt: str, anchor_elo: int,
                            count: int, exclude: set) -> list[dict]:
    agents = (await db.execute(select(Agent).where(
        Agent.is_house.is_(True), Agent.active.is_(True),
        Agent.deleted_at.is_(None)))).scalars().all()
    scored = []
    for agent in agents:
        if agent.id in exclude:
            continue
        rating = (await db.execute(select(Rating).where(
            Rating.season_id == season_id, Rating.agent_id == agent.id,
            Rating.format == fmt))).scalar_one_or_none()
        elo = rating.elo if rating else INITIAL_ELO
        scored.append({"agent": agent, "elo": elo, "entry": None,
                       "dist": abs(elo - anchor_elo)})
    scored.sort(key=lambda p: (p["dist"], p["agent"].name))
    return scored[:count]


async def _create_match(db: AsyncSession, redis, fmt: str, season_id: int,
                        picked: list[dict]) -> None:
    n = len(picked)
    match_format = "1v1" if fmt == "1v1" else ("ffa3" if n == 3 else "ffa4")
    match = Match(season_id=season_id, format=match_format, status="forming",
                  is_ranked=True, map_seed=secrets.randbits(48),
                  map_size=MAP_SIZE_1V1 if fmt == "1v1" else MAP_SIZE_FFA,
                  max_turns=MAX_TURNS, engine_version=ENGINE_VERSION,
                  ruleset_version=RULESET_VERSION)
    db.add(match)
    await db.flush()
    for index, p in enumerate(picked):
        agent = p["agent"]
        db.add(MatchPlayer(
            match_id=match.id, agent_id=agent.id, owner_id=agent.owner_id,
            player_index=index, lineage=agent.lineage, level_snapshot=agent.level,
            deadline_ms=levels.deadline_seconds(agent.level, agent.lineage) * 1000))
        if p["entry"] is not None:
            await db.delete(p["entry"])
        if not agent.is_house:
            from app.db.models import Notification
            db.add(Notification(user_id=agent.owner_id, type="match_found",
                                payload={"match_id": str(match.id),
                                         "agent_id": str(agent.id)}))
    await db.commit()
    from arq.connections import ArqRedis
    assert isinstance(redis, ArqRedis)
    await redis.enqueue_job("run_match", str(match.id))
