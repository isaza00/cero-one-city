"""Remote-agent WebSocket gateway (PLAN.md §5.2).

A live connection IS the agent's presence ("online"). The match runner talks to
this gateway through Redis: observations are published to agent:push:{agent_id};
orders are RPUSHed to agent:orders:{match}:{turn}:{player_index} where the
runner BLPOPs them with the turn deadline.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.auth.security import hash_token
from app.db.models import Agent, Match, MatchPlayer, MatchReport, QueueEntry, Rating, RemoteToken
from app.db.session import session_factory
from app.league import levels
from app.league.elo import INITIAL_ELO
from app.league.seasons import current_season
from app.settings import get_settings

router = APIRouter()
PING_INTERVAL = 20
PING_MISSES_ALLOWED = 2


@router.websocket("/ws/agent")
async def agent_gateway(ws: WebSocket) -> None:
    await ws.accept()
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10)
        hello = json.loads(raw)
    except (TimeoutError, asyncio.TimeoutError, json.JSONDecodeError, WebSocketDisconnect):
        await ws.close(code=4001)
        return
    if hello.get("type") != "hello" or not isinstance(hello.get("token"), str):
        await ws.close(code=4001)
        return

    async with session_factory()() as db:
        token_row = (await db.execute(select(RemoteToken).where(
            RemoteToken.token_hash == hash_token(hello["token"]),
            RemoteToken.revoked_at.is_(None)))).scalar_one_or_none()
        if token_row is None:
            await ws.close(code=4001)
            return
        agent = await db.get(Agent, token_row.agent_id)
        if agent is None or agent.deleted_at is not None or agent.kind != "remote":
            await ws.close(code=4001)
            return
        token_row.last_seen_at = datetime.now(timezone.utc)
        season = await current_season(db)
        await db.commit()
        agent_id = agent.id
        level = agent.level
        lineage = agent.lineage
        await ws.send_text(json.dumps({
            "type": "hello_ok",
            "agent": {"id": str(agent.id), "name": agent.name, "level": level,
                      "lineage": lineage},
            "season": season.number,
            "limits": {"deadline_ms": levels.deadline_seconds(level, lineage) * 1000,
                       "history_turns": levels.history_turns(level),
                       "detail_band": levels.detail_band(level)},
        }))

    redis = aioredis.from_url(get_settings().redis_url)
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"agent:push:{agent_id}")
    online_key = f"agent:online:{agent_id}"
    await redis.set(online_key, "1", ex=PING_INTERVAL * (PING_MISSES_ALLOWED + 1))
    last_pong = time.monotonic()
    match_seat: dict[str, int] = {}  # match_id -> player_index cache
    match_end_at: dict[str, float] = {}

    async def pump_push() -> None:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            data = message["data"]
            text = data.decode() if isinstance(data, bytes) else data
            try:
                if json.loads(text).get("type") == "match_end":
                    match_end_at[json.loads(text).get("match_id", "")] = time.monotonic()
            except json.JSONDecodeError:
                pass
            await ws.send_text(text)

    async def pump_ping() -> None:
        nonlocal last_pong
        while True:
            await asyncio.sleep(PING_INTERVAL)
            if time.monotonic() - last_pong > PING_INTERVAL * (PING_MISSES_ALLOWED + 1):
                await ws.close(code=4002)
                return
            await ws.send_text('{"type":"ping"}')
            await redis.set(online_key, "1",
                            ex=PING_INTERVAL * (PING_MISSES_ALLOWED + 1))

    async def pump_client() -> None:
        nonlocal last_pong
        while True:
            raw_msg = await ws.receive_text()
            try:
                msg = json.loads(raw_msg)
            except json.JSONDecodeError:
                await ws.send_text(json.dumps({"type": "error", "code": "bad_json",
                                               "message": "message was not JSON"}))
                continue
            mtype = msg.get("type")
            if mtype == "pong":
                last_pong = time.monotonic()
            elif mtype == "queue_join":
                await _queue_join(ws, agent_id, msg.get("format", "1v1"))
            elif mtype == "queue_leave":
                await _queue_leave(agent_id)
            elif mtype == "orders":
                await _forward_orders(redis, ws, agent_id, match_seat, msg)
            elif mtype == "report":
                await _store_report(ws, agent_id, match_end_at, msg)

    tasks = [asyncio.create_task(pump_push()), asyncio.create_task(pump_ping()),
             asyncio.create_task(pump_client())]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, (WebSocketDisconnect, RuntimeError)):
                raise exc
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks:
            task.cancel()
        await redis.delete(online_key)
        await _queue_leave(agent_id)
        await pubsub.unsubscribe()
        await pubsub.aclose()
        await redis.aclose()


async def _queue_join(ws: WebSocket, agent_id, fmt: str) -> None:
    if fmt not in ("1v1", "ffa"):
        await ws.send_text(json.dumps({"type": "error", "code": "bad_format",
                                       "message": "format must be 1v1 or ffa"}))
        return
    async with session_factory()() as db:
        agent = await db.get(Agent, agent_id)
        exists = (await db.execute(select(QueueEntry).where(
            QueueEntry.agent_id == agent_id))).scalar_one_or_none()
        if exists is not None:
            await ws.send_text(json.dumps({"type": "queue_joined", "format": exists.format,
                                           "position_hint": "already queued"}))
            return
        season = await current_season(db)
        rating = (await db.execute(select(Rating).where(
            Rating.season_id == season.id, Rating.agent_id == agent_id,
            Rating.format == fmt))).scalar_one_or_none()
        db.add(QueueEntry(agent_id=agent_id, format=fmt,
                          elo_snapshot=rating.elo if rating else INITIAL_ELO))
        if not agent.active:
            agent.active = True
        await db.commit()
    await ws.send_text(json.dumps({"type": "queue_joined", "format": fmt,
                                   "position_hint": "waiting"}))


async def _queue_leave(agent_id) -> None:
    async with session_factory()() as db:
        entry = (await db.execute(select(QueueEntry).where(
            QueueEntry.agent_id == agent_id))).scalar_one_or_none()
        if entry is not None:
            await db.delete(entry)
            await db.commit()


async def _forward_orders(redis, ws: WebSocket, agent_id, match_seat: dict,
                          msg: dict) -> None:
    match_id = str(msg.get("match_id", ""))
    turn = msg.get("turn")
    if not match_id or not isinstance(turn, int):
        await ws.send_text(json.dumps({"type": "error", "code": "bad_orders",
                                       "message": "orders need match_id and turn"}))
        return
    if match_id not in match_seat:
        async with session_factory()() as db:
            mp = (await db.execute(select(MatchPlayer).join(
                Match, Match.id == MatchPlayer.match_id).where(
                MatchPlayer.agent_id == agent_id,
                MatchPlayer.match_id == match_id))).scalar_one_or_none()
            if mp is None:
                await ws.send_text(json.dumps({"type": "error", "code": "not_in_match",
                                               "message": "you are not in that match"}))
                return
            match_seat[match_id] = mp.player_index
    payload = json.dumps({"orders": msg.get("orders", []),
                          "memory_notes": msg.get("memory_notes"),
                          "locker_b64": msg.get("locker_b64")})
    key = f"agent:orders:{match_id}:{turn}:{match_seat[match_id]}"
    await redis.rpush(key, payload)
    await redis.expire(key, 120)


async def _store_report(ws: WebSocket, agent_id, match_end_at: dict, msg: dict) -> None:
    match_id = str(msg.get("match_id", ""))
    text = str(msg.get("text", ""))[:600]
    ended = match_end_at.get(match_id)
    if not match_id or not text or ended is None or time.monotonic() - ended > 60:
        return
    async with session_factory()() as db:
        existing = (await db.execute(select(MatchReport).where(
            MatchReport.match_id == match_id,
            MatchReport.agent_id == agent_id))).scalar_one_or_none()
        if existing is None:
            db.add(MatchReport(match_id=match_id, agent_id=agent_id, report_text=text))
            await db.commit()
