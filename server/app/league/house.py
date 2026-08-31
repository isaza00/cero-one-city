"""House agents: 12 personalities in 3 tiers, owned by the system user. They fill
matchmaking gaps, play each other when the arena is empty (budget-capped), and
their memory books reset every season (PLAN.md §8)."""

from __future__ import annotations

import secrets

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import hash_password
from app.db.models import Agent, Match, MatchPlayer, User
from app.league import levels
from app.llm import costs
from app.settings import get_settings
from cero_engine import ENGINE_VERSION
from cero_engine.rules import MAP_SIZE_1V1, MAX_TURNS, RULESET_VERSION

SYSTEM_EMAIL = "system@cero.local"

ROSTER = [
    ("Sprocket", "rookie", 2, "swarm",
     "Rush early with strikers. Attack the first enemy you see, even if it is clumsy."),
    ("Fuse", "rookie", 2, "forge",
     "Greedy boomer: build economy nonstop, never scout, only fight if attacked."),
    ("Rivet", "rookie", 2, "oracle",
     "Shy turtle: stay home, build a couple of turrets, never initiate combat."),
    ("Sparky", "rookie", 2, "swarm",
     "Aggressive and reckless: attack anything that moves with whatever you have."),
    ("Rust", "rookie", 2, "parasite",
     "Steal and run: capture racks and loot scrap, avoid fair fights."),
    ("Lumen", "rookie", 2, "photon",
     "Poke from range: mass prisms early, kite melee, never let them touch you."),
    ("Hinge", "veteran", 5, "forge",
     "Turtle with turrets, tech to v3 and break the game open with walking towers."),
    ("Antenna", "veteran", 5, "oracle",
     "Diplomat: propose truces early, honor the first, betray the second when ahead."),
    ("Pinion", "veteran", 5, "swarm",
     "Constant waves: attack every few turns with cheap units, never stop producing."),
    ("Suction", "veteran", 5, "parasite",
     "Capture racks and defend them; harass workers with recruited humans."),
    ("Dynamo", "veteran", 5, "forge",
     "All-in riders the moment firmware v2 lands. Hit worker lines first."),
    ("MAINFRAME", "elite", 8, "oracle",
     "Play a complete, opportunistic game: scout, tech, trade efficiently and close."),
    ("GOLGOTHA-9", "elite", 8, "forge",
     "Relentless pressure and siege: contain, expand, then dismantle their base."),
]


async def seed_house(db: AsyncSession) -> None:
    # One system user per house agent: the one-agent-per-owner-per-match rule is a
    # DB constraint, and house agents must be able to face each other.
    existing = {a.name for a in (await db.execute(
        select(Agent).where(Agent.is_house.is_(True)))).scalars()}
    level_xp = {lvl: req for lvl, (req, *_r) in levels.LEVELS.items()}
    for name, tier, level, lineage, charter in ROSTER:
        slug = name.lower()
        if slug in existing:
            continue
        email = f"house-{slug}@cero.local"
        owner = (await db.execute(select(User).where(
            User.email == email))).scalar_one_or_none()
        if owner is None:
            owner = User(email=email, password_hash=hash_password(secrets.token_hex(16)),
                         display_name=f"House ({name})", role="user",
                         practice_remaining=0)
            db.add(owner)
            await db.flush()
        db.add(Agent(owner_id=owner.id, name=slug, lineage=lineage,
                     kind="hosted", charter=charter, is_house=True, house_tier=tier,
                     level=level, xp=level_xp.get(level, 0), active=True,
                     formats=["1v1", "ffa"], title=levels.title_for_level(level)))
    await db.commit()


async def house_selfplay_tick(ctx) -> None:
    """Every 15 seconds: if fewer than 2 matches are live/forming and budget
    remains, start a house-vs-house 1v1. The arena is NEVER empty - that is the
    whole point of having house agents."""
    from app.db.session import session_factory
    redis = ctx["redis"]
    settings = get_settings()
    async with session_factory()() as db:
        live = (await db.execute(select(func.count(Match.id)).where(
            Match.status.in_(("live", "forming")),
            Match.invite_code.is_(None)))).scalar_one()  # custom lobbies do not count
        if live >= 2:
            return
        spent = await costs.day_spend_by_purpose_micros(db, "house")
        if spent >= settings.house_daily_budget_usd * 1_000_000:
            return
        busy = select(MatchPlayer.agent_id).join(
            Match, Match.id == MatchPlayer.match_id).where(
            Match.status.in_(("live", "forming")))
        agents = (await db.execute(select(Agent).where(
            Agent.is_house.is_(True), Agent.active.is_(True),
            Agent.id.not_in(busy))
            .order_by(func.random()).limit(2))).scalars().all()
        if len(agents) < 2:
            return
        from app.league.seasons import current_season
        season = await current_season(db)
        match = Match(season_id=season.id, format="1v1", status="forming",
                      is_ranked=True, map_seed=secrets.randbits(48),
                      map_size=MAP_SIZE_1V1, max_turns=MAX_TURNS,
                      engine_version=ENGINE_VERSION, ruleset_version=RULESET_VERSION)
        db.add(match)
        await db.flush()
        for index, agent in enumerate(agents):
            db.add(MatchPlayer(match_id=match.id, agent_id=agent.id,
                               owner_id=agent.owner_id, player_index=index,
                               lineage=agent.lineage, level_snapshot=agent.level,
                               deadline_ms=levels.deadline_seconds(
                                   agent.level, agent.lineage) * 1000))
        await db.commit()
        await redis.enqueue_job("run_match", str(match.id))
