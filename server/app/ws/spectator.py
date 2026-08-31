"""Public spectator WebSocket: snapshot on connect, then live turn_resolved /
highlight / match_end messages relayed from the match runner via Redis pub/sub."""

from __future__ import annotations

import asyncio
import json
import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.db.models import Agent, Match, MatchPlayer, Turn
from app.db.session import session_factory
from app.game.feed import HIGHLIGHT_KINDS
from app.settings import get_settings

router = APIRouter()


async def _snapshot(match_id: uuid.UUID) -> dict | None:
    async with session_factory()() as db:
        match = await db.get(Match, match_id)
        if match is None:
            return None
        players = (await db.execute(
            select(MatchPlayer, Agent.name, Agent.lineage, Agent.is_house)
            .join(Agent, Agent.id == MatchPlayer.agent_id)
            .where(MatchPlayer.match_id == match_id)
            .order_by(MatchPlayer.player_index))).all()
        last = (await db.execute(select(Turn).where(Turn.match_id == match_id)
                                 .order_by(Turn.turn_number.desc()).limit(1))
                ).scalar_one_or_none()
        recent = (await db.execute(select(Turn).where(Turn.match_id == match_id)
                                   .order_by(Turn.turn_number.desc()).limit(8))
                  ).scalars().all()
        feed_recent: list = []
        highlights: list = []
        for t in reversed(recent):
            for f in (t.feed or []):
                feed_recent.append({"turn": t.turn_number, **f})
            for e in (t.events or []):
                if e.get("type") in HIGHLIGHT_KINDS:
                    highlights.append({"turn": t.turn_number, "kind": e["type"], "data": e})
        return {
            "type": "snapshot",
            "match": {"id": str(match.id), "format": match.format,
                      "status": match.status, "turn": match.current_turn,
                      "max_turns": match.max_turns, "is_ranked": match.is_ranked,
                      "summary": match.summary},
            "players": [{"player_index": mp.player_index, "agent_id": str(mp.agent_id),
                         "name": name, "lineage": lineage, "is_house": is_house,
                         "level": mp.level_snapshot, "status": mp.status}
                        for mp, name, lineage, is_house in players],
            "turn_number": last.turn_number if last else 0,
            "state": last.state if last else None,
            "feed_recent": feed_recent[-40:],
            "highlights": highlights[-20:],
        }


@router.websocket("/ws/matches/{match_id}")
async def spectate(ws: WebSocket, match_id: uuid.UUID) -> None:
    await ws.accept()
    snapshot = await _snapshot(match_id)
    if snapshot is None:
        await ws.close(code=4404)
        return
    try:
        await ws.send_text(json.dumps(snapshot, separators=(",", ":")))
    except (WebSocketDisconnect, RuntimeError):
        return  # client vanished during the snapshot query (e.g. React StrictMode)

    redis = aioredis.from_url(get_settings().redis_url)
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"spectate:{match_id}")

    async def pump_redis() -> None:
        async for message in pubsub.listen():
            if message["type"] == "message":
                data = message["data"]
                await ws.send_text(data.decode() if isinstance(data, bytes) else data)

    async def pump_client() -> None:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "ping":
                await ws.send_text('{"type":"pong"}')

    try:
        done, pending = await asyncio.wait(
            [asyncio.create_task(pump_redis()), asyncio.create_task(pump_client())],
            return_when=asyncio.FIRST_EXCEPTION)
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe()
        await pubsub.aclose()
        await redis.aclose()
