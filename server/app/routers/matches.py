"""Match endpoints: listing, detail, replay turns, shouts, custom matches."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_owned_agent
from app.db import get_db
from app.db.models import Agent, Match, MatchPlayer, MatchPlayerCost, MatchReport, Shout, Turn, User
from app.league import levels
from cero_engine import ENGINE_VERSION
from cero_engine.rules import MAP_SIZE_1V1, MAP_SIZE_FFA, MAX_TURNS, RULESET_VERSION

router = APIRouter(prefix="/api/matches", tags=["matches"])

SEASON_SHOUT_LIMIT = 30
MATCH_SHOUT_LIMIT = 2


async def _players_out(db: AsyncSession, match_id: uuid.UUID) -> list[dict]:
    rows = (await db.execute(
        select(MatchPlayer, Agent).join(Agent, Agent.id == MatchPlayer.agent_id)
        .where(MatchPlayer.match_id == match_id)
        .order_by(MatchPlayer.player_index))).all()
    return [{"player_index": mp.player_index, "agent_id": str(a.id), "name": a.name,
             "lineage": a.lineage, "level": mp.level_snapshot, "is_house": a.is_house,
             "kind": a.kind, "status": mp.status, "placement": mp.placement,
             "score": mp.score,
             "elo_delta": ((mp.elo_after or 0) - (mp.elo_before or 0))
             if mp.elo_after is not None else None}
            for mp, a in rows]


@router.get("")
async def list_matches(status: str = "live", format: str | None = None,
                       agent_id: uuid.UUID | None = None, limit: int = 20,
                       offset: int = 0, db: AsyncSession = Depends(get_db)) -> dict:
    q = select(Match)
    if status in ("live", "finished", "forming"):
        q = q.where(Match.status == status)
    if format:
        q = q.where(Match.format == format)
    if agent_id:
        q = q.join(MatchPlayer, MatchPlayer.match_id == Match.id).where(
            MatchPlayer.agent_id == agent_id)
    q = q.order_by(desc(Match.created_at)).limit(min(limit, 50)).offset(offset)
    matches = (await db.execute(q)).scalars().all()
    out = []
    for m in matches:
        out.append({"id": str(m.id), "format": m.format, "status": m.status,
                    "turn": m.current_turn, "max_turns": m.max_turns,
                    "is_ranked": m.is_ranked,
                    "created_at": m.created_at.isoformat(),
                    "players": await _players_out(db, m.id)})
    return {"matches": out}


@router.get("/{match_id}")
async def get_match(match_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    match = await db.get(Match, match_id)
    if match is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "no such match"})
    return {"match": {"id": str(match.id), "format": match.format,
                      "status": match.status, "turn": match.current_turn,
                      "max_turns": match.max_turns, "is_ranked": match.is_ranked,
                      "map_seed": match.map_seed, "map_size": match.map_size,
                      "engine_version": match.engine_version,
                      "ruleset_version": match.ruleset_version,
                      "summary": match.summary,
                      "started_at": match.started_at.isoformat() if match.started_at else None,
                      "finished_at": match.finished_at.isoformat() if match.finished_at else None},
            "players": await _players_out(db, match_id)}


@router.get("/{match_id}/replay")
async def replay_meta(match_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    match = await db.get(Match, match_id)
    if match is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "no such match"})
    turns = (await db.execute(select(Turn.turn_number).where(
        Turn.match_id == match_id, Turn.state.isnot(None))
        .order_by(Turn.turn_number))).scalars().all()
    return {"turns_available": list(turns), "engine_version": match.engine_version,
            "ruleset_version": match.ruleset_version, "map_seed": match.map_seed}


@router.get("/{match_id}/turns/{turn_number}")
async def get_turn(match_id: uuid.UUID, turn_number: int,
                   db: AsyncSession = Depends(get_db)) -> dict:
    turn = (await db.execute(select(Turn).where(
        Turn.match_id == match_id, Turn.turn_number == turn_number))).scalar_one_or_none()
    if turn is None:
        raise HTTPException(404, detail={"code": "not_found", "message": "no such turn"})
    return {"turn_number": turn.turn_number, "state": turn.state,
            "events": turn.events, "feed": turn.feed, "state_hash": turn.state_hash}


@router.get("/{match_id}/report")
async def my_report(match_id: uuid.UUID, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(
        select(MatchReport, Agent).join(Agent, Agent.id == MatchReport.agent_id)
        .where(MatchReport.match_id == match_id, Agent.owner_id == user.id))).all()
    return {"reports": [{"agent_id": str(a.id), "agent_name": a.name,
                         "text": r.report_text} for r, a in rows]}


@router.get("/{match_id}/costs")
async def my_match_costs(match_id: uuid.UUID, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(
        select(MatchPlayerCost, Agent).join(Agent, Agent.id == MatchPlayerCost.agent_id)
        .where(MatchPlayerCost.match_id == match_id, Agent.owner_id == user.id))).all()
    return {"costs": [{"agent_id": str(a.id), "calls": c.calls,
                       "tokens_in": c.tokens_in, "tokens_out": c.tokens_out,
                       "cost_usd": c.cost_usd_micros / 1_000_000} for c, a in rows]}


# ----------------------------------------------------------------------- shouts

class ShoutBody(BaseModel):
    agent_id: uuid.UUID
    text: str = Field(min_length=1, max_length=200)


@router.post("/{match_id}/shout")
async def shout(match_id: uuid.UUID, body: ShoutBody,
                user: User = Depends(get_current_user),
                db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(body.agent_id, user, db)
    match = await db.get(Match, match_id)
    if match is None or match.status != "live":
        raise HTTPException(409, detail={"code": "not_live",
                                         "message": "match is not live"})
    mp = (await db.execute(select(MatchPlayer).where(
        MatchPlayer.match_id == match_id,
        MatchPlayer.agent_id == agent.id))).scalar_one_or_none()
    if mp is None:
        raise HTTPException(403, detail={"code": "not_in_match",
                                         "message": "your agent is not in this match"})
    used_match = (await db.execute(select(func.count(Shout.id)).where(
        Shout.match_id == match_id, Shout.agent_id == agent.id))).scalar_one()
    if used_match >= MATCH_SHOUT_LIMIT:
        raise HTTPException(409, detail={"code": "match_limit",
                                         "message": f"{MATCH_SHOUT_LIMIT} shouts per match"})
    if agent.season_shouts_used >= SEASON_SHOUT_LIMIT:
        raise HTTPException(409, detail={"code": "season_limit",
                                         "message": f"{SEASON_SHOUT_LIMIT} shouts per season"})
    entry = Shout(match_id=match_id, agent_id=agent.id, owner_id=user.id,
                  text=body.text, created_turn=match.current_turn)
    agent.season_shouts_used += 1
    mp.shouts_used += 1
    db.add(entry)
    await db.commit()
    return {"shout": {"text": entry.text, "created_turn": entry.created_turn,
                      "match_used": used_match + 1,
                      "season_used": agent.season_shouts_used}}


# --------------------------------------------------------------- custom matches

class CustomBody(BaseModel):
    format: str
    map_seed: int | None = None


@router.post("/custom")
async def create_custom(body: CustomBody, user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    if body.format not in ("1v1", "ffa3", "ffa4"):
        raise HTTPException(422, detail={"code": "bad_format",
                                         "message": "format: 1v1 | ffa3 | ffa4"})
    code = secrets.token_hex(3)
    match = Match(season_id=None, format=body.format, status="forming",
                  is_ranked=False,
                  map_seed=body.map_seed if body.map_seed is not None
                  else secrets.randbits(48),
                  map_size=MAP_SIZE_1V1 if body.format == "1v1" else MAP_SIZE_FFA,
                  max_turns=MAX_TURNS, engine_version=ENGINE_VERSION,
                  ruleset_version=RULESET_VERSION, invite_code=code,
                  invite_expires_at=datetime.now(timezone.utc) + timedelta(minutes=30))
    db.add(match)
    await db.commit()
    return {"code": code, "match_id": str(match.id),
            "expires_at": match.invite_expires_at.isoformat()}


class JoinBody(BaseModel):
    agent_id: uuid.UUID


@router.post("/custom/{code}/join")
async def join_custom(code: str, body: JoinBody,
                      user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(body.agent_id, user, db)
    match = (await db.execute(select(Match).where(
        Match.invite_code == code.lower(), Match.status == "forming"))).scalar_one_or_none()
    if match is None or (match.invite_expires_at
                         and match.invite_expires_at < datetime.now(timezone.utc)):
        raise HTTPException(404, detail={"code": "not_found",
                                         "message": "invite not found or expired"})
    players = (await db.execute(select(MatchPlayer).where(
        MatchPlayer.match_id == match.id))).scalars().all()
    needed = {"1v1": 2, "ffa3": 3, "ffa4": 4}[match.format]
    if len(players) >= needed:
        raise HTTPException(409, detail={"code": "full", "message": "match is full"})
    if any(p.owner_id == user.id for p in players):
        raise HTTPException(409, detail={"code": "owner_dup",
                                         "message": "one agent per owner per match"})
    db.add(MatchPlayer(match_id=match.id, agent_id=agent.id, owner_id=user.id,
                       player_index=len(players), lineage=agent.lineage,
                       level_snapshot=agent.level,
                       deadline_ms=levels.deadline_seconds(agent.level,
                                                           agent.lineage) * 1000))
    await db.commit()
    if len(players) + 1 == needed:
        from app.worker_client import enqueue
        await enqueue("run_match", str(match.id))
        return {"match_id": str(match.id), "started": True}
    return {"match_id": str(match.id), "started": False,
            "waiting_for": needed - len(players) - 1}
