"""The match loop (arq job): observations out in parallel, orders in before the
deadline, engine.advance, persist the turn, publish to spectators. Tolerates
lost turns (persistent orders); 3 consecutive missed turns = abandonment.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto import decrypt
from app.db.models import (
    Agent,
    AgentModelConfig,
    ApiKey,
    Match,
    MatchPlayer,
    MemoryBookEntry,
    RemoteLocker,
    Turn,
)
from app.db.session import session_factory
from app.game import reports
from app.game.feed import extract_highlights, render_feed
from app.game.observation import build_observation, save_memory_notes
from app.league import levels
from app.llm import costs
from app.llm.driver import HostedAgentCtx, call_for_turn
from app.settings import get_settings
from cero_engine import ENGINE_VERSION
from cero_engine.bots import BOTS
from cero_engine.hashing import chain_hash, hash_state
from cero_engine.mapgen import generate_map
from cero_engine.phases import advance
from cero_engine.rules import RULESET_VERSION
from cero_engine.score import score as engine_score
from cero_engine.state import State


@dataclass
class Seat:
    mp: MatchPlayer
    agent: Agent
    kind: str                       # hosted | remote | mock
    hosted: HostedAgentCtx | None = None
    bot: object | None = None


async def run_match(ctx, match_id: str) -> None:
    redis = ctx["redis"]
    lock_key = f"lock:match:{match_id}"
    token = uuid.uuid4().hex
    if not await redis.set(lock_key, token, nx=True, ex=180):
        return
    try:
        async with session_factory()() as db:
            runner = MatchRunner(db, redis, uuid.UUID(match_id), lock_key)
            await runner.run()
    finally:
        if await redis.get(lock_key) == token.encode():
            await redis.delete(lock_key)


class MatchRunner:
    def __init__(self, db: AsyncSession, redis, match_id: uuid.UUID, lock_key: str):
        self.db = db
        self.redis = redis
        self.match_id = match_id
        self.lock_key = lock_key
        self.settings = get_settings()
        self.seats: dict[int, Seat] = {}
        self.names: dict[int, str] = {}
        self.agent_ids: dict[int, str] = {}

    # ------------------------------------------------------------------ setup
    async def run(self) -> None:
        match = await self.db.get(Match, self.match_id)
        if match is None or match.status in ("finished", "cancelled"):
            return
        players = (await self.db.execute(
            select(MatchPlayer).where(MatchPlayer.match_id == self.match_id)
            .order_by(MatchPlayer.player_index))).scalars().all()
        for mp in players:
            agent = await self.db.get(Agent, mp.agent_id)
            self.names[mp.player_index] = agent.name
            self.agent_ids[mp.player_index] = str(agent.id)
            self.seats[mp.player_index] = await self._build_seat(match, mp, agent)

        last = (await self.db.execute(
            select(Turn).where(Turn.match_id == self.match_id)
            .order_by(Turn.turn_number.desc()).limit(1))).scalar_one_or_none()

        if match.status == "forming" or last is None:
            # Fresh start (also covers a "live" match that never got its turn 0).
            lineages = [self.seats[i].mp.lineage for i in sorted(self.seats)]
            state = generate_map(match.map_seed, match.format
                                 if match.format in ("1v1", "ffa3", "ffa4")
                                 else ("1v1" if len(players) == 2 else "ffa3"),
                                 lineages)
            match.status = "live"
            match.started_at = datetime.now(timezone.utc)
            chain = chain_hash("", hash_state(state))
            self.db.add(Turn(match_id=self.match_id, turn_number=0,
                             state=state.to_dict(), state_hash=hash_state(state),
                             chain_hash=chain, orders={}, order_errors={}, events=[],
                             feed=[], resolved_in_ms=0))
            await self.db.commit()
            await self._publish_remote_match_start(match, state)
        else:
            state = State.from_dict(last.state)
            chain = last.chain_hash
            match.resume_pending = False
            await self.db.commit()

        await self._loop(match, state, chain)

    async def _build_seat(self, match: Match, mp: MatchPlayer, agent: Agent) -> Seat:
        settings = self.settings
        book = [e.text for e in (await self.db.execute(
            select(MemoryBookEntry).where(MemoryBookEntry.agent_id == agent.id)
            .order_by(MemoryBookEntry.slot))).scalars()]
        level = mp.level_snapshot
        common = dict(
            agent_id=agent.id, name=agent.name, lineage=agent.lineage, level=level,
            deadline_s=max(mp.deadline_ms // 1000, 2),
            history_turns=levels.history_turns(level), band=levels.detail_band(level),
            diplo=levels.diplo_actions(level), charter=agent.charter,
            book_entries=book, max_tokens=levels.max_tokens(level),
        )

        if agent.kind == "remote":
            return Seat(mp=mp, agent=agent, kind="remote")

        if agent.is_house:
            if settings.house_api_key:
                model = (settings.house_model_strong if agent.house_tier == "elite"
                         else settings.house_model_cheap)
                hosted = HostedAgentCtx(**common, provider=settings.house_provider,
                                        model=model, api_key=settings.house_api_key,
                                        temperature_x100=None, purpose="house",
                                        match_cap_micros=10_000_000_000,
                                        day_cap_micros=10_000_000_000)
                return Seat(mp=mp, agent=agent, kind="hosted", hosted=hosted)
            bot_name = {"rookie": "rush", "veteran": "boom", "elite": "turtle"}.get(
                agent.house_tier or "rookie", "boom")
            return Seat(mp=mp, agent=agent, kind="mock",
                        bot=BOTS[bot_name](mp.player_index, match.map_seed))

        if match.format == "practice" and not agent.is_house:
            if settings.practice_api_key:
                hosted = HostedAgentCtx(**common, provider=settings.practice_provider,
                                        model=settings.practice_model,
                                        api_key=settings.practice_api_key,
                                        temperature_x100=None, purpose="practice",
                                        match_cap_micros=10_000_000_000,
                                        day_cap_micros=10_000_000_000)
                return Seat(mp=mp, agent=agent, kind="hosted", hosted=hosted)
            return Seat(mp=mp, agent=agent, kind="mock",
                        bot=BOTS["boom"](mp.player_index, match.map_seed))

        config = (await self.db.execute(
            select(AgentModelConfig).where(AgentModelConfig.agent_id == agent.id)
        )).scalar_one_or_none()
        if config is None:
            return Seat(mp=mp, agent=agent, kind="mock",
                        bot=BOTS["random"](mp.player_index, match.map_seed))
        if config.provider == "mock":
            return Seat(mp=mp, agent=agent, kind="mock",
                        bot=BOTS.get(config.model, BOTS["boom"])(mp.player_index,
                                                                 match.map_seed))
        api_key = ""
        if config.api_key_id is not None:
            row = await self.db.get(ApiKey, config.api_key_id)
            if row is not None and row.revoked_at is None:
                api_key = decrypt(row.nonce, row.key_ciphertext)
        hosted = HostedAgentCtx(
            **common, provider=config.provider, model=config.model, api_key=api_key,
            temperature_x100=config.temperature_x100, purpose="turn",
            match_cap_micros=config.per_match_cap_usd_cents * 10_000,
            day_cap_micros=config.per_day_cap_usd_cents * 10_000)
        if config.max_tokens_override:
            hosted.max_tokens = config.max_tokens_override
        return Seat(mp=mp, agent=agent, kind="hosted", hosted=hosted)

    # ------------------------------------------------------------------- loop
    async def _loop(self, match: Match, state: State, chain: str) -> None:
        while not state.finished:
            turn_started = time.perf_counter()
            turn_no = state.turn + 1
            await self.redis.expire(self.lock_key, 180)

            game_budget_ok = await self._game_budgets_ok()
            observations: dict[int, dict] = {}
            for idx, seat in self.seats.items():
                if not state.players[idx].alive or seat.mp.status == "abandoned":
                    continue
                observations[idx] = await build_observation(
                    self.db, state=state, match_id=self.match_id, player_index=idx,
                    agent_id=seat.agent.id, level=seat.mp.level_snapshot,
                    lineage=seat.agent.lineage,
                    deadline_s=max(seat.mp.deadline_ms // 1000, 2))

            # Preload remote lockers sequentially: the gather below runs the
            # seats concurrently and they share one DB session, so no seat may
            # touch self.db while gather is in flight (SQLAlchemy forbids
            # concurrent ops on a session). Reads happen here, writes after.
            self._locker_reads = await self._load_lockers(observations)
            self._locker_writes: dict = {}

            results = await asyncio.gather(*[
                self._collect_orders(match, seat, turn_no, observations[idx],
                                     game_budget_ok)
                for idx, seat in self.seats.items() if idx in observations])

            await self._flush_locker_writes()

            orders_by_player: dict[int, list] = {}
            raw_orders_log: dict[str, list] = {}
            forfeits: list[int] = []
            for idx, parsed in zip([i for i in self.seats if i in observations], results):
                seat = self.seats[idx]
                if parsed is None:
                    seat.mp.missed_streak += 1
                    seat.mp.missed_total += 1
                    if seat.mp.missed_streak >= 3 and seat.kind != "mock":
                        forfeits.append(idx)
                        seat.mp.status = "abandoned"
                    orders_by_player[idx] = []
                else:
                    seat.mp.missed_streak = 0
                    orders = parsed.get("orders") if isinstance(parsed, dict) else None
                    orders_by_player[idx] = orders if isinstance(orders, list) else []
                    raw_orders_log[str(idx)] = orders_by_player[idx]
                    notes = parsed.get("memory_notes") if isinstance(parsed, dict) else None
                    if seat.kind == "hosted" and isinstance(notes, list):
                        await save_memory_notes(self.db, self.match_id, seat.agent.id, notes)

            diplo_allowed = {idx: levels.diplo_actions(seat.mp.level_snapshot)
                             for idx, seat in self.seats.items()}
            t0 = time.perf_counter()
            _, events, order_errors = advance(state, orders_by_player,
                                              diplo_allowed=diplo_allowed,
                                              forfeits=tuple(forfeits))
            resolved_ms = int((time.perf_counter() - t0) * 1000)

            state_hash = hash_state(state)
            chain = chain_hash(chain, state_hash)
            feed = render_feed(events, self.names, self.agent_ids)
            highlights = extract_highlights(state.turn, events, self.names)
            self.db.add(Turn(
                match_id=self.match_id, turn_number=state.turn, state=state.to_dict(),
                state_hash=state_hash, chain_hash=chain, orders=raw_orders_log,
                order_errors={str(k): v for k, v in order_errors.items() if v},
                events=events, feed=feed, resolved_in_ms=resolved_ms))
            match.current_turn = state.turn
            for idx, seat in self.seats.items():
                player = state.players[idx]
                if not player.alive and seat.mp.status == "alive":
                    seat.mp.status = "eliminated"
                    seat.mp.eliminated_at_turn = player.eliminated_turn
            await self.db.commit()

            scores = engine_score(state)
            await self._publish({"type": "turn_resolved", "turn_number": state.turn,
                                 "state": state.to_dict(), "events": events,
                                 "feed": feed,
                                 "scoreboard": [
                                     {"player_index": p.id,
                                      "agent_id": self.agent_ids.get(p.id),
                                      "name": self.names.get(p.id),
                                      "score": scores[p.id], "alive": p.alive}
                                     for p in state.players]})
            for h in highlights:
                await self._publish({"type": "highlight", **h})

            elapsed = time.perf_counter() - turn_started
            if self.settings.min_turn_seconds and elapsed < self.settings.min_turn_seconds:
                await asyncio.sleep(self.settings.min_turn_seconds - elapsed)

        await reports.finalize_match(self.db, self.redis, match, state,
                                     {i: s for i, s in self.seats.items()},
                                     self.names, self.agent_ids)

    async def _collect_orders(self, match: Match, seat: Seat, turn_no: int,
                              obs: dict, game_budget_ok: bool) -> dict | None:
        deadline_s = max(seat.mp.deadline_ms // 1000, 2)
        if seat.kind == "mock":
            try:
                return {"orders": seat.bot.act(obs)}
            except Exception:
                return {"orders": []}
        if seat.kind == "remote":
            return await self._remote_orders(seat, turn_no, obs, deadline_s)
        if seat.hosted.purpose in ("house", "practice") and not game_budget_ok:
            return {"orders": []}  # global game budget exhausted: idle turns
        parsed, _status = await call_for_turn(self.db, seat.hosted, self.match_id,
                                              turn_no, obs)
        return parsed

    async def _remote_orders(self, seat: Seat, turn_no: int, obs: dict,
                             deadline_s: int) -> dict | None:
        # No DB access here: this runs under asyncio.gather with the other
        # seats over a shared session. Lockers are read into self._locker_reads
        # before the gather and written from self._locker_writes after it.
        locker_in = self._locker_reads.get(seat.agent.id)
        payload = {"type": "observation", "match_id": str(self.match_id),
                   "turn": turn_no, "deadline_ms": deadline_s * 1000, "obs": obs,
                   "locker_b64": (locker_in.decode() if locker_in else None)}
        await self.redis.publish(f"agent:push:{seat.agent.id}", json.dumps(payload))
        key = f"agent:orders:{self.match_id}:{turn_no}:{seat.mp.player_index}"
        res = await self.redis.blpop(key, timeout=deadline_s)
        if not res:
            return None
        try:
            reply = json.loads(res[1])
        except (json.JSONDecodeError, TypeError):
            return None
        locker_b64 = reply.get("locker_b64")
        if isinstance(locker_b64, str) and len(locker_b64) <= 65536:
            self._locker_writes[seat.agent.id] = locker_b64.encode()
        return reply if isinstance(reply, dict) else None

    async def _load_lockers(self, observations: dict) -> dict:
        """Read every active remote seat's locker up front (sequential)."""
        agent_ids = [seat.agent.id for idx, seat in self.seats.items()
                     if idx in observations and seat.kind == "remote"]
        if not agent_ids:
            return {}
        rows = (await self.db.execute(select(RemoteLocker).where(
            RemoteLocker.agent_id.in_(agent_ids)))).scalars().all()
        return {row.agent_id: row.data for row in rows}

    async def _flush_locker_writes(self) -> None:
        """Persist locker updates gathered during the turn (sequential)."""
        if not self._locker_writes:
            return
        existing = (await self.db.execute(select(RemoteLocker).where(
            RemoteLocker.agent_id.in_(list(self._locker_writes))))).scalars().all()
        by_agent = {row.agent_id: row for row in existing}
        for agent_id, data in self._locker_writes.items():
            row = by_agent.get(agent_id)
            if row is None:
                self.db.add(RemoteLocker(agent_id=agent_id, data=data))
            else:
                row.data = data
        await self.db.commit()

    async def _game_budgets_ok(self) -> bool:
        house = await costs.day_spend_by_purpose_micros(self.db, "house")
        practice = await costs.day_spend_by_purpose_micros(self.db, "practice")
        return (house < self.settings.house_daily_budget_usd * 1_000_000
                and practice < self.settings.practice_daily_budget_usd * 1_000_000)

    async def _publish(self, message: dict) -> None:
        await self.redis.publish(f"spectate:{self.match_id}",
                                 json.dumps(message, separators=(",", ":")))

    async def _publish_remote_match_start(self, match: Match, state: State) -> None:
        for idx, seat in self.seats.items():
            if seat.kind != "remote":
                continue
            locker = (await self.db.execute(select(RemoteLocker).where(
                RemoteLocker.agent_id == seat.agent.id))).scalar_one_or_none()
            payload = {
                "type": "match_start", "match_id": str(self.match_id),
                "format": match.format, "map_size": match.map_size,
                "max_turns": match.max_turns, "your_player_index": idx,
                "engine_version": ENGINE_VERSION, "ruleset_version": RULESET_VERSION,
                "players": [{"player_index": i, "name": self.names[i],
                             "lineage": self.seats[i].agent.lineage,
                             "level": self.seats[i].mp.level_snapshot}
                            for i in sorted(self.seats)],
                "locker_b64": (locker.data.decode() if locker else None),
            }
            await self.redis.publish(f"agent:push:{seat.agent.id}", json.dumps(payload))
