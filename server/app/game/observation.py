"""Server-side observation enrichment: engine observation + level, history,
pending shouts, match memory notes and last-turn order errors (PLAN.md §6.3)."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MatchMemory, Shout, Turn
from app.league import levels
from cero_engine.observe import observe


async def build_observation(db: AsyncSession, *, state, match_id: uuid.UUID,
                            player_index: int, agent_id: uuid.UUID, level: int,
                            lineage: str, deadline_s: int) -> dict:
    band = levels.detail_band(level)
    diplo = levels.diplo_actions(level)
    obs = observe(state, player_index, band=band, diplo_actions=diplo)
    obs["you"]["level"] = level
    obs["deadline_seconds"] = deadline_s

    # History: the player's own feed line (plus globals) for the last N turns.
    n = levels.history_turns(level)
    prev_turns = (await db.execute(
        select(Turn).where(Turn.match_id == match_id,
                           Turn.turn_number < state.turn)
        .order_by(Turn.turn_number.desc()).limit(n))).scalars().all()
    history = []
    for t in reversed(prev_turns):
        lines = [f["text"] for f in (t.feed or [])
                 if f.get("player_index") in (player_index, None)]
        if lines:
            history.append({"turn": t.turn_number, "summary": " ".join(lines)[:400]})
    obs["history"] = history

    # Last turn: this player's rejected orders (self-correction loop).
    last = prev_turns[0] if prev_turns else None
    errors = []
    if last is not None and last.order_errors:
        errors = last.order_errors.get(str(player_index), [])
    obs["last_turn"] = {"order_errors": errors,
                        "events": [f["text"] for f in ((last.feed if last else None) or [])
                                   if f.get("player_index") == player_index]}

    # Pending shouts from the bench (delivered exactly once).
    pending = (await db.execute(
        select(Shout).where(Shout.match_id == match_id, Shout.agent_id == agent_id,
                            Shout.delivered_turn.is_(None)))).scalars().all()
    obs["shouts_from_owner"] = [s.text for s in pending]
    for s in pending:
        s.delivered_turn = state.turn + 1

    # Match memory notes (written by the agent, wiped when the match ends).
    memory = (await db.execute(
        select(MatchMemory).where(MatchMemory.match_id == match_id,
                                  MatchMemory.agent_id == agent_id))).scalar_one_or_none()
    obs["memory_notes"] = list(memory.notes) if memory else []
    await db.commit()
    return obs


async def save_memory_notes(db: AsyncSession, match_id: uuid.UUID,
                            agent_id: uuid.UUID, notes: list) -> None:
    clean = [str(t)[:280] for t in notes if isinstance(t, str)][:20]
    memory = (await db.execute(
        select(MatchMemory).where(MatchMemory.match_id == match_id,
                                  MatchMemory.agent_id == agent_id))).scalar_one_or_none()
    if memory is None:
        db.add(MatchMemory(match_id=match_id, agent_id=agent_id, notes=clean))
    else:
        memory.notes = clean
    await db.commit()
