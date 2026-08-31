"""arq worker: match jobs plus all recurring crons (matchmaking, house self-play,
season rollover, retention, crash recovery)."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import delete, select, update

from app.db.session import init_db, session_factory
from app.game.match_runner import run_match
from app.league.house import house_selfplay_tick
from app.league.matchmaking import matchmaking_tick
from app.settings import get_settings

logger = logging.getLogger("cero.worker")


async def startup(ctx: dict) -> None:
    await init_db()
    from app.league.house import seed_house
    from app.league.seasons import current_season
    from app.llm.costs import seed_model_prices
    async with session_factory()() as db:
        await seed_model_prices(db)
        await seed_house(db)
        await current_season(db)
    logger.info("worker started (env=%s)", get_settings().env)


async def guarded_matchmaking(ctx: dict) -> None:
    from app.db.models import Setting
    async with session_factory()() as db:
        kill = (await db.execute(select(Setting).where(
            Setting.key == "killswitch"))).scalar_one_or_none()
        if kill is not None and kill.value.get("matchmaking") is False:
            return
    await matchmaking_tick(ctx)


async def season_rollover(ctx: dict) -> None:
    from app.league.seasons import rollover_if_due
    async with session_factory()() as db:
        new = await rollover_if_due(db)
        if new is not None:
            logger.info("season rolled over to %s", new.number)


async def resume_stuck_matches(ctx: dict) -> None:
    """Crash recovery: live matches without a runner lock get re-enqueued."""
    from app.db.models import Match
    redis = ctx["redis"]
    async with session_factory()() as db:
        stuck = (await db.execute(select(Match.id).where(
            Match.status == "live"))).scalars().all()
    for match_id in stuck:
        if not await redis.get(f"lock:match:{match_id}"):
            logger.info("resuming match %s", match_id)
            await redis.enqueue_job("run_match", str(match_id))


async def retention(ctx: dict) -> None:
    """Nightly: for finished matches older than 90 days keep only every 10th turn
    state (plus 0 and the last); events/feed/hashes always survive."""
    from app.db.models import Match, Turn
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    async with session_factory()() as db:
        old = (await db.execute(select(Match).where(
            Match.status == "finished", Match.finished_at < cutoff))).scalars().all()
        for match in old:
            await db.execute(update(Turn).where(
                Turn.match_id == match.id,
                Turn.turn_number % 10 != 0,
                Turn.turn_number != match.current_turn).values(state=None))
        # Expired custom invites are cancelled outright.
        await db.execute(delete(Match).where(
            Match.status == "forming", Match.invite_code.isnot(None),
            Match.invite_expires_at < datetime.now(timezone.utc)))
        await db.commit()


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    on_startup = startup
    functions = [run_match]
    cron_jobs = [
        cron(guarded_matchmaking, second={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55},
             run_at_startup=True),
        cron(house_selfplay_tick, second={0, 15, 30, 45}, run_at_startup=True),
        cron(season_rollover, hour={4}, minute={30}),
        cron(retention, hour={5}, minute={0}),
        cron(resume_stuck_matches, minute=set(range(0, 60, 2))),
    ]
    job_timeout = 3600  # a full match with slow providers can take a while
    max_jobs = 8
