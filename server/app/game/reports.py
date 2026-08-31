"""Match finalization: placements, Elo, XP/levels, cost consolidation, post-match
reflection (report + memory book), notifications, cleanup and re-queueing."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import (
    LlmCall,
    Match,
    MatchMemory,
    MatchPlayerCost,
    MatchReport,
    MemoryBookEntry,
    Notification,
    QueueEntry,
    Rating,
    RatingHistory,
    RemoteLocker,
    Turn,
)
from app.league import elo, levels
from app.league.seasons import current_season
from cero_engine.score import placements as engine_placements
from cero_engine.score import score as engine_score


async def finalize_match(db: AsyncSession, redis, match: Match, state, seats: dict,
                         names: dict[int, str], agent_ids: dict[int, str]) -> None:
    scores = engine_score(state)
    order = engine_placements(state)
    placement_of = {pid: pos + 1 for pos, pid in enumerate(order)}

    for idx, seat in seats.items():
        seat.mp.placement = placement_of.get(idx)
        seat.mp.score = scores.get(idx, 0)
        if seat.mp.status == "alive":
            seat.mp.status = "winner" if state.winner == idx else "loser"

    match.status = "finished"
    match.finished_at = datetime.now(timezone.utc)

    highlights = await _collect_highlights(db, match.id)
    match.summary = {
        "winner": state.winner,
        "turns": state.turn,
        "placements": [{"player_index": pid, "agent_id": agent_ids.get(pid),
                        "name": names.get(pid), "placement": placement_of[pid],
                        "score": scores.get(pid, 0)} for pid in order],
        "highlights": highlights[:20],
    }
    await db.commit()

    if match.is_ranked:
        await _apply_elo(db, match, seats, order)
        await _apply_xp(db, match, seats, placement_of)
    await _consolidate_costs(db, match, seats)
    await _reflections(db, match, state, seats, placement_of, scores)
    await _notify_and_cleanup(db, redis, match, seats, placement_of, scores, agent_ids)


async def _collect_highlights(db: AsyncSession, match_id: uuid.UUID) -> list[dict]:
    from app.game.feed import HIGHLIGHT_KINDS
    turns = (await db.execute(select(Turn).where(Turn.match_id == match_id)
                              .order_by(Turn.turn_number))).scalars().all()
    out = []
    for t in turns:
        for e in (t.events or []):
            if e.get("type") in HIGHLIGHT_KINDS:
                out.append({"turn": t.turn_number, "kind": e["type"], "data": e})
    return out


async def _apply_elo(db: AsyncSession, match: Match, seats: dict,
                     order: list[int]) -> None:
    season = await current_season(db)
    fmt = "1v1" if match.format == "1v1" else "ffa"
    entries = []
    ratings: dict[int, Rating] = {}
    for idx, seat in seats.items():
        rating = (await db.execute(select(Rating).where(
            Rating.season_id == season.id, Rating.agent_id == seat.agent.id,
            Rating.format == fmt))).scalar_one_or_none()
        if rating is None:
            rating = Rating(season_id=season.id, agent_id=seat.agent.id, format=fmt,
                            elo=elo.INITIAL_ELO)
            db.add(rating)
            await db.flush()
        ratings[idx] = rating
        entries.append({"player_index": idx, "elo": rating.elo,
                        "is_house": seat.agent.is_house})
    deltas = elo.match_deltas(entries, order)
    for idx, seat in seats.items():
        rating = ratings[idx]
        seat.mp.elo_before = rating.elo
        rating.elo += deltas[idx]
        rating.matches_played += 1
        if order and order[0] == idx:
            rating.wins += 1
        seat.mp.elo_after = rating.elo
        db.add(RatingHistory(season_id=season.id, agent_id=seat.agent.id, format=fmt,
                             match_id=match.id, elo_before=seat.mp.elo_before,
                             elo_after=rating.elo, delta=deltas[idx]))
    await db.commit()


async def _apply_xp(db: AsyncSession, match: Match, seats: dict,
                    placement_of: dict[int, int]) -> None:
    for idx, seat in seats.items():
        agent = seat.agent
        xp = levels.XP_PER_MATCH
        if placement_of.get(idx) == 1:
            xp += levels.XP_WIN_BONUS
        seat.mp.xp_awarded = xp
        agent.xp += xp
        new_level = levels.level_for_xp(agent.xp)
        if new_level > agent.level:
            agent.level = new_level
            agent.title = levels.title_for_level(new_level)
            if not agent.is_house:
                db.add(Notification(user_id=agent.owner_id, type="level_up",
                                    payload={"agent_id": str(agent.id),
                                             "level": new_level,
                                             "title": agent.title}))
    await db.commit()


async def _consolidate_costs(db: AsyncSession, match: Match, seats: dict) -> None:
    for seat in seats.values():
        row = (await db.execute(select(
            func.count(LlmCall.id), func.coalesce(func.sum(LlmCall.input_tokens), 0),
            func.coalesce(func.sum(LlmCall.output_tokens), 0),
            func.coalesce(func.sum(LlmCall.cost_usd_micros), 0))
            .where(LlmCall.match_id == match.id,
                   LlmCall.agent_id == seat.agent.id))).one()
        db.add(MatchPlayerCost(match_id=match.id, agent_id=seat.agent.id,
                               calls=int(row[0]), tokens_in=int(row[1]),
                               tokens_out=int(row[2]), cost_usd_micros=int(row[3])))
    await db.commit()


def _match_summary_for(state, idx: int, placement: int, scores: dict,
                       names: dict[int, str]) -> dict:
    player = state.players[idx]
    return {
        "your_player_index": idx,
        "placement": placement,
        "turns": state.turn,
        "winner": state.winner,
        "final_scores": {names.get(p.id, str(p.id)): scores.get(p.id, 0)
                         for p in state.players},
        "you": {"lineage": player.lineage, "eliminated_turn": player.eliminated_turn,
                "damage_dealt": player.damage_dealt, "techs": player.techs,
                "firmware": player.firmware},
    }


async def _reflections(db: AsyncSession, match: Match, state, seats: dict,
                       placement_of: dict[int, int], scores: dict) -> None:
    from app.llm.driver import call_for_reflection
    names = {idx: seat.agent.name for idx, seat in seats.items()}
    for idx, seat in seats.items():
        if seat.kind != "hosted" or seat.hosted is None:
            continue
        capacity = levels.book_capacity(seat.mp.level_snapshot)
        summary = _match_summary_for(state, idx, placement_of.get(idx, 0), scores, names)
        parsed = await call_for_reflection(db, seat.hosted, match.id, summary, capacity)
        if not isinstance(parsed, dict):
            continue
        report = str(parsed.get("report") or "")[:1500]
        if report:
            db.add(MatchReport(match_id=match.id, agent_id=seat.agent.id,
                               report_text=report))
        entries = parsed.get("book_entries")
        if isinstance(entries, list):
            await db.execute(delete(MemoryBookEntry).where(
                MemoryBookEntry.agent_id == seat.agent.id))
            for slot, text in enumerate([str(t)[:500] for t in entries
                                         if isinstance(t, str)][:capacity]):
                db.add(MemoryBookEntry(agent_id=seat.agent.id, slot=slot, text=text,
                                       source_match_id=match.id))
        await db.commit()


async def _notify_and_cleanup(db: AsyncSession, redis, match: Match, seats: dict,
                              placement_of: dict[int, int], scores: dict,
                              agent_ids: dict[int, str]) -> None:
    # Notify owners, push match_end to remote agents, wipe match memories, requeue.
    for idx, seat in seats.items():
        agent = seat.agent
        agent.can_edit_charter = True  # one charter edit unlocks after each match
        if seat.kind == "remote":
            locker = (await db.execute(select(RemoteLocker).where(
                RemoteLocker.agent_id == agent.id))).scalar_one_or_none()
            await redis.publish(f"agent:push:{agent.id}", json.dumps({
                "type": "match_end", "match_id": str(match.id),
                "placement": placement_of.get(idx), "score": scores.get(idx, 0),
                "elo_delta": (seat.mp.elo_after or 0) - (seat.mp.elo_before or 0),
                "xp_awarded": seat.mp.xp_awarded,
                "locker_final_b64": (locker.data.decode() if locker else None)}))
        if not agent.is_house:
            db.add(Notification(user_id=agent.owner_id, type="match_finished",
                                payload={"match_id": str(match.id),
                                         "agent_id": str(agent.id),
                                         "placement": placement_of.get(idx),
                                         "score": scores.get(idx, 0)}))
    await db.execute(delete(MatchMemory).where(MatchMemory.match_id == match.id))
    await db.commit()

    await redis.publish(f"spectate:{match.id}", json.dumps(
        {"type": "match_end", "placements": match.summary["placements"],
         "summary": match.summary}))

    # Auto-queue: back into the pool ~60s after finishing (PLAN.md §8).
    for seat in seats.values():
        agent = seat.agent
        if agent.is_house or not agent.auto_queue or not agent.active:
            continue
        exists = (await db.execute(select(QueueEntry).where(
            QueueEntry.agent_id == agent.id))).scalar_one_or_none()
        if exists is None and match.format in ("1v1", "ffa3", "ffa4"):
            fmt = "1v1" if match.format == "1v1" else "ffa"
            if fmt in (agent.formats or []):
                db.add(QueueEntry(agent_id=agent.id, format=fmt,
                                  enqueued_at=datetime.now(timezone.utc)
                                  + timedelta(seconds=60)))
    await db.commit()
