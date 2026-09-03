"""Agent endpoints: create/list, public profile, charter editing (diff-guarded),
model config + key test, remote token, memory book, costs, reports, queue,
practice (PLAN.md §5)."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_owned_agent
from app.auth.security import hash_token
from app.crypto import decrypt, encrypt
from app.db import get_db
from app.db.models import (
    Agent,
    AgentModelConfig,
    ApiKey,
    Match,
    MatchPlayer,
    MatchPlayerCost,
    MatchReport,
    MemoryBookEntry,
    QueueEntry,
    Rating,
    RemoteToken,
    Setting,
    User,
)
from app.league import levels
from app.league.elo import INITIAL_ELO
from app.league.seasons import current_season
from app.llm.driver import test_key
from cero_engine import ENGINE_VERSION
from cero_engine.rules import LINEAGES, MAP_SIZE_1V1, MAX_TURNS, RULESET_VERSION

router = APIRouter(prefix="/api/agents", tags=["agents"])

PROVIDERS = ("anthropic", "openai", "google", "openrouter", "mock", "claude-code")
KEYLESS = ("mock", "claude-code")  # no API key: scripted bot / the owner's own Claude Code
HOUSE_PRACTICE_ROTATION = ("sprocket", "fuse", "rivet")


def levenshtein_within(a: str, b: str, k: int) -> bool:
    """Banded Levenshtein: True iff edit distance(a, b) <= k."""
    if abs(len(a) - len(b)) > k:
        return False
    if a == b:
        return True
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        lo = max(1, i - k)
        hi = min(len(b), i + k)
        if lo > 1:
            cur[lo - 1] = k + 1
        best = k + 1
        for j in range(lo, hi + 1):
            cost = 0 if ca == b[j - 1] else 1
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            best = min(best, cur[j])
        if best > k:
            return False
        prev = cur
    return prev[len(b)] <= k


async def _agent_elo(db: AsyncSession, agent_id: uuid.UUID) -> dict:
    season = await current_season(db)
    rows = (await db.execute(select(Rating).where(
        Rating.season_id == season.id, Rating.agent_id == agent_id))).scalars().all()
    out = {"1v1": INITIAL_ELO, "ffa": INITIAL_ELO}
    for r in rows:
        out[r.format] = r.elo
    return out


async def _agent_state(db: AsyncSession, agent: Agent) -> dict:
    queued = (await db.execute(select(QueueEntry).where(
        QueueEntry.agent_id == agent.id))).scalar_one_or_none()
    # An agent can sit in a live match AND a stale forming custom lobby at the
    # same time: prefer the live one, then the newest (never crash on two rows).
    live = (await db.execute(select(Match.id).join(
        MatchPlayer, MatchPlayer.match_id == Match.id).where(
        MatchPlayer.agent_id == agent.id,
        Match.status.in_(("forming", "live")))
        .order_by(Match.status.desc(), Match.created_at.desc()))).scalars().first()
    return {"queued_format": queued.format if queued else None,
            "live_match_id": str(live) if live else None}


def _public(agent: Agent, elo: dict, model_declared: str | None) -> dict:
    return {
        "id": str(agent.id), "name": agent.name, "lineage": agent.lineage,
        "kind": agent.kind, "level": agent.level, "xp": agent.xp,
        "title": agent.title, "avatar_variant": agent.avatar_variant,
        "is_house": agent.is_house, "house_tier": agent.house_tier,
        "model_declared": model_declared, "elo_by_format": elo,
        "interventions_count": agent.season_shouts_used + (agent.charter_version - 1),
        "created_at": agent.created_at.isoformat(),
    }


async def _model_declared(db: AsyncSession, agent: Agent) -> str | None:
    if agent.is_house:
        return "house model"
    config = (await db.execute(select(AgentModelConfig).where(
        AgentModelConfig.agent_id == agent.id))).scalar_one_or_none()
    if config is None:
        return None
    suffix = " (declared by owner)" if agent.kind == "remote" else ""
    return f"{config.provider}/{config.model}{suffix}"


# ------------------------------------------------------------------- create/list

class CreateAgentBody(BaseModel):
    name: str = Field(min_length=2, max_length=40, pattern=r"^[a-zA-Z0-9_\- ]+$")
    lineage: str
    kind: str
    charter: str | None = Field(default=None, max_length=4000)


@router.post("")
async def create_agent(body: CreateAgentBody, user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> dict:
    if body.lineage not in LINEAGES:
        raise HTTPException(422, detail={"code": "bad_lineage",
                                         "message": f"lineage must be one of {LINEAGES}"})
    if body.kind not in ("hosted", "remote"):
        raise HTTPException(422, detail={"code": "bad_kind",
                                         "message": "kind must be hosted or remote"})
    if body.kind == "hosted" and not body.charter:
        raise HTTPException(422, detail={"code": "charter_required",
                                         "message": "hosted agents need a charter"})
    name = body.name.lower().strip()
    exists = (await db.execute(select(Agent).where(Agent.name == name))).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(409, detail={"code": "name_taken",
                                         "message": "agent name already in use"})
    agent = Agent(owner_id=user.id, name=name, lineage=body.lineage, kind=body.kind,
                  charter=body.charter if body.kind == "hosted" else None)
    db.add(agent)
    await db.commit()
    return {"agent": _public(agent, {"1v1": INITIAL_ELO, "ffa": INITIAL_ELO}, None)}


@router.get("")
async def my_agents(user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)) -> dict:
    agents = (await db.execute(select(Agent).where(
        Agent.owner_id == user.id, Agent.deleted_at.is_(None))
        .order_by(Agent.created_at))).scalars().all()
    out = []
    for agent in agents:
        elo = await _agent_elo(db, agent.id)
        model = await _model_declared(db, agent)
        state = await _agent_state(db, agent)
        out.append({**_public(agent, elo, model), **state,
                    "active": agent.active, "auto_queue": agent.auto_queue,
                    "formats": agent.formats, "can_edit_charter": agent.can_edit_charter})
    return {"agents": out}


@router.get("/{agent_id}")
async def get_agent(agent_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)) -> dict:
    agent = await db.get(Agent, agent_id)
    if agent is None or agent.deleted_at is not None:
        raise HTTPException(404, detail={"code": "not_found", "message": "no such agent"})
    elo = await _agent_elo(db, agent.id)
    model = await _model_declared(db, agent)
    data = _public(agent, elo, model)
    history = (await db.execute(
        select(MatchPlayer, Match).join(Match, Match.id == MatchPlayer.match_id)
        .where(MatchPlayer.agent_id == agent.id, Match.status == "finished")
        .order_by(desc(Match.finished_at)).limit(20))).all()
    data["history"] = [{"match_id": str(m.id), "format": m.format,
                        "placement": mp.placement, "score": mp.score,
                        "elo_delta": (mp.elo_after or 0) - (mp.elo_before or 0),
                        "finished_at": m.finished_at.isoformat() if m.finished_at else None}
                       for mp, m in history]
    if agent.owner_id == user.id or user.role == "admin":
        data.update({"charter": agent.charter, "can_edit_charter": agent.can_edit_charter,
                     "active": agent.active, "auto_queue": agent.auto_queue,
                     "formats": agent.formats,
                     **(await _agent_state(db, agent))})
        config = (await db.execute(select(AgentModelConfig).where(
            AgentModelConfig.agent_id == agent.id))).scalar_one_or_none()
        if config:
            data["model_config"] = {
                "provider": config.provider, "model": config.model,
                "temperature_x100": config.temperature_x100,
                "max_tokens_override": config.max_tokens_override,
                "per_match_cap_usd_cents": config.per_match_cap_usd_cents,
                "per_day_cap_usd_cents": config.per_day_cap_usd_cents,
                "last_test_ok": config.last_test_ok,
                "est_cost_per_match_usd_cents": config.est_cost_per_match_usd_cents}
    return data


# ---------------------------------------------------------------------- charter

class CharterBody(BaseModel):
    charter: str = Field(min_length=1, max_length=4000)


@router.patch("/{agent_id}/charter")
async def edit_charter(agent_id: uuid.UUID, body: CharterBody,
                       user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(agent_id, user, db)
    if agent.kind != "hosted":
        raise HTTPException(409, detail={"code": "remote_agent",
                                         "message": "remote agents have no charter"})
    if not agent.can_edit_charter:
        raise HTTPException(409, detail={"code": "edit_locked",
                                         "message": "one edit per match: play a match first"})
    live = (await db.execute(select(Match.id).join(
        MatchPlayer, MatchPlayer.match_id == Match.id).where(
        MatchPlayer.agent_id == agent.id,
        Match.status.in_(("forming", "live"))))).scalar_one_or_none()
    if live is not None:
        raise HTTPException(409, detail={"code": "in_match",
                                         "message": "cannot edit during a match"})
    old = agent.charter or ""
    budget = max(len(old) * 25 // 100, 40)  # change one rule, not the whole thing
    if not levenshtein_within(old, body.charter, budget):
        raise HTTPException(422, detail={
            "code": "diff_too_big",
            "message": f"edit changes too much (max ~25% of the charter, {budget} chars)"})
    agent.charter = body.charter
    agent.charter_version += 1
    agent.can_edit_charter = False
    agent.last_charter_edit_at = datetime.now(timezone.utc)
    await db.commit()
    return {"agent_id": str(agent.id), "charter_version": agent.charter_version,
            "can_edit_charter": agent.can_edit_charter}


# ------------------------------------------------------------------ model config

class ModelBody(BaseModel):
    provider: str
    model: str = Field(min_length=1, max_length=120)
    api_key: str | None = Field(default=None, max_length=512)
    temperature_x100: int | None = Field(default=None, ge=0, le=200)
    max_tokens_override: int | None = Field(default=None, ge=256, le=8000)
    per_match_cap_usd_cents: int = Field(default=100, ge=10, le=5000)
    per_day_cap_usd_cents: int = Field(default=500, ge=10, le=20000)


@router.put("/{agent_id}/model")
async def set_model(agent_id: uuid.UUID, body: ModelBody,
                    user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(agent_id, user, db)
    if body.provider not in PROVIDERS:
        raise HTTPException(422, detail={"code": "bad_provider",
                                         "message": f"provider must be one of {PROVIDERS}"})
    config = (await db.execute(select(AgentModelConfig).where(
        AgentModelConfig.agent_id == agent.id))).scalar_one_or_none()

    api_key_id = config.api_key_id if config else None
    raw_key = ""
    if body.provider not in KEYLESS:
        if body.api_key:
            nonce, ciphertext = encrypt(body.api_key)
            key_row = ApiKey(user_id=user.id, provider=body.provider,
                             key_ciphertext=ciphertext, nonce=nonce,
                             key_last4=body.api_key[-4:])
            db.add(key_row)
            await db.flush()
            api_key_id = key_row.id
            raw_key = body.api_key
        elif api_key_id is not None:
            key_row = await db.get(ApiKey, api_key_id)
            if key_row is None or key_row.revoked_at is not None:
                raise HTTPException(422, detail={"code": "key_required",
                                                 "message": "provide an api_key"})
            raw_key = decrypt(key_row.nonce, key_row.key_ciphertext)
        else:
            raise HTTPException(422, detail={"code": "key_required",
                                             "message": "provide an api_key"})

    if config is None:
        config = AgentModelConfig(agent_id=agent.id, provider=body.provider,
                                  model=body.model)
        db.add(config)
    config.provider = body.provider
    config.model = body.model
    config.api_key_id = api_key_id
    config.temperature_x100 = body.temperature_x100
    config.max_tokens_override = body.max_tokens_override
    config.per_match_cap_usd_cents = body.per_match_cap_usd_cents
    config.per_day_cap_usd_cents = body.per_day_cap_usd_cents

    if body.provider == "mock":
        test = {"ok": True, "latency_ms": 0, "est_cost_per_match_usd_cents": 0}
    elif body.provider == "claude-code":
        # probe the local bridge: ok only while `python server/tools/claude_bridge.py` runs
        test = await test_key(db, agent.id, body.provider, body.model, "")
        test["est_cost_per_match_usd_cents"] = 0
        if not test.get("ok"):
            test["error"] = "bridge not answering: run `python server/tools/claude_bridge.py` on this machine"
    else:
        test = await test_key(db, agent.id, body.provider, body.model, raw_key)
    config.last_test_at = datetime.now(timezone.utc)
    config.last_test_ok = bool(test.get("ok"))
    config.est_cost_per_match_usd_cents = test.get("est_cost_per_match_usd_cents")
    await db.commit()
    return {"config": {"provider": config.provider, "model": config.model,
                       "last_test_ok": config.last_test_ok},
            "test": test,
            "est_cost_per_match_usd_cents": config.est_cost_per_match_usd_cents}


@router.post("/{agent_id}/model/test")
async def model_test(agent_id: uuid.UUID, user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(agent_id, user, db)
    config = (await db.execute(select(AgentModelConfig).where(
        AgentModelConfig.agent_id == agent.id))).scalar_one_or_none()
    if config is None:
        raise HTTPException(404, detail={"code": "no_config",
                                         "message": "connect a model first"})
    if config.provider == "mock":
        return {"ok": True, "latency_ms": 0, "est_cost_per_match_usd_cents": 0}
    key_row = await db.get(ApiKey, config.api_key_id) if config.api_key_id else None
    if key_row is None:
        raise HTTPException(422, detail={"code": "key_required",
                                         "message": "no stored key"})
    raw_key = decrypt(key_row.nonce, key_row.key_ciphertext)
    test = await test_key(db, agent.id, config.provider, config.model, raw_key)
    config.last_test_at = datetime.now(timezone.utc)
    config.last_test_ok = bool(test.get("ok"))
    config.est_cost_per_match_usd_cents = test.get("est_cost_per_match_usd_cents")
    await db.commit()
    return test


# ---------------------------------------------------------------- remote tokens

@router.post("/{agent_id}/token")
async def issue_token(agent_id: uuid.UUID, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(agent_id, user, db)
    if agent.kind != "remote":
        raise HTTPException(409, detail={"code": "not_remote",
                                         "message": "tokens are for remote agents"})
    now = datetime.now(timezone.utc)
    old_tokens = (await db.execute(select(RemoteToken).where(
        RemoteToken.agent_id == agent.id, RemoteToken.revoked_at.is_(None)))).scalars()
    for t in old_tokens:
        t.revoked_at = now
    raw = f"cero_{secrets.token_urlsafe(32)}"
    db.add(RemoteToken(agent_id=agent.id, token_hash=hash_token(raw)))
    await db.commit()
    return {"token": raw, "note": "shown once; the previous token was revoked"}


# ---------------------------------------------------------------------- memory

@router.get("/{agent_id}/memory")
async def get_memory(agent_id: uuid.UUID, user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(agent_id, user, db)
    entries = (await db.execute(select(MemoryBookEntry).where(
        MemoryBookEntry.agent_id == agent.id).order_by(MemoryBookEntry.slot))).scalars().all()
    return {"book": {"capacity": levels.book_capacity(agent.level),
                     "entries": [{"id": str(e.id), "slot": e.slot, "text": e.text,
                                  "source_match_id": (str(e.source_match_id)
                                                      if e.source_match_id else None),
                                  "updated_at": e.updated_at.isoformat()}
                                 for e in entries]}}


@router.delete("/{agent_id}/memory/{entry_id}", status_code=204)
async def delete_memory(agent_id: uuid.UUID, entry_id: uuid.UUID,
                        user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)) -> None:
    agent = await get_owned_agent(agent_id, user, db)
    entry = await db.get(MemoryBookEntry, entry_id)
    if entry is None or entry.agent_id != agent.id:
        raise HTTPException(404, detail={"code": "not_found", "message": "no such entry"})
    await db.delete(entry)  # owners can delete, never add or edit
    await db.commit()


# --------------------------------------------------------------- costs/reports

@router.get("/{agent_id}/costs")
async def get_costs(agent_id: uuid.UUID, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(agent_id, user, db)
    rows = (await db.execute(select(MatchPlayerCost).where(
        MatchPlayerCost.agent_id == agent.id))).scalars().all()
    per_match = [{"match_id": str(r.match_id), "calls": r.calls,
                  "tokens_in": r.tokens_in, "tokens_out": r.tokens_out,
                  "cost_usd": r.cost_usd_micros / 1_000_000} for r in rows]
    return {"per_match": per_match,
            "totals": {"cost_usd": sum(r.cost_usd_micros for r in rows) / 1_000_000,
                       "matches": len(rows)}}


@router.get("/{agent_id}/reports")
async def get_reports(agent_id: uuid.UUID, limit: int = 10,
                      user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(agent_id, user, db)
    rows = (await db.execute(select(MatchReport).where(
        MatchReport.agent_id == agent.id)
        .order_by(desc(MatchReport.created_at)).limit(min(limit, 50)))).scalars().all()
    return {"reports": [{"match_id": str(r.match_id), "text": r.report_text,
                         "created_at": r.created_at.isoformat()} for r in rows]}


@router.get("/{agent_id}/matches")
async def agent_matches(agent_id: uuid.UUID, limit: int = 20, offset: int = 0,
                        db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)) -> dict:
    rows = (await db.execute(
        select(MatchPlayer, Match).join(Match, Match.id == MatchPlayer.match_id)
        .where(MatchPlayer.agent_id == agent_id)
        .order_by(desc(Match.created_at)).limit(min(limit, 50)).offset(offset))).all()
    return {"matches": [{"match_id": str(m.id), "format": m.format, "status": m.status,
                         "placement": mp.placement, "score": mp.score,
                         "created_at": m.created_at.isoformat()} for mp, m in rows]}


# --------------------------------------------------------------------- settings

class AgentSettingsBody(BaseModel):
    formats: list[str] | None = None
    auto_queue: bool | None = None
    active: bool | None = None


@router.patch("/{agent_id}/settings")
async def agent_settings(agent_id: uuid.UUID, body: AgentSettingsBody,
                         user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(agent_id, user, db)
    if body.formats is not None:
        if not body.formats or any(f not in ("1v1", "ffa") for f in body.formats):
            raise HTTPException(422, detail={"code": "bad_formats",
                                             "message": "formats: 1v1 and/or ffa"})
        agent.formats = body.formats
    if body.auto_queue is not None:
        agent.auto_queue = body.auto_queue
    if body.active is not None:
        agent.active = body.active
    await db.commit()
    return {"agent_id": str(agent.id), "formats": agent.formats,
            "auto_queue": agent.auto_queue, "active": agent.active}


# ------------------------------------------------------------------------ queue

class QueueBody(BaseModel):
    format: str


@router.post("/{agent_id}/queue")
async def join_queue(agent_id: uuid.UUID, body: QueueBody,
                     user: User = Depends(get_current_user),
                     db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(agent_id, user, db)
    if body.format not in ("1v1", "ffa"):
        raise HTTPException(422, detail={"code": "bad_format",
                                         "message": "format must be 1v1 or ffa"})
    if body.format not in (agent.formats or []):
        raise HTTPException(409, detail={"code": "format_disabled",
                                         "message": "enable this format in settings first"})
    if agent.kind == "hosted":
        config = (await db.execute(select(AgentModelConfig).where(
            AgentModelConfig.agent_id == agent.id))).scalar_one_or_none()
        if config is None or config.last_test_ok is False:
            raise HTTPException(409, detail={"code": "no_model",
                                             "message": "connect a working model first"})
    state = await _agent_state(db, agent)
    if state["queued_format"] or state["live_match_id"]:
        raise HTTPException(409, detail={"code": "busy",
                                         "message": "agent already queued or playing"})
    season = await current_season(db)
    rating = (await db.execute(select(Rating).where(
        Rating.season_id == season.id, Rating.agent_id == agent.id,
        Rating.format == body.format))).scalar_one_or_none()
    entry = QueueEntry(agent_id=agent.id, format=body.format,
                       elo_snapshot=rating.elo if rating else INITIAL_ELO)
    db.add(entry)
    agent.active = True
    await db.commit()
    return {"queued_at": entry.enqueued_at.isoformat() if entry.enqueued_at else None,
            "elo_snapshot": entry.elo_snapshot}


@router.delete("/{agent_id}/queue", status_code=204)
async def leave_queue(agent_id: uuid.UUID, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)) -> None:
    agent = await get_owned_agent(agent_id, user, db)
    entry = (await db.execute(select(QueueEntry).where(
        QueueEntry.agent_id == agent.id))).scalar_one_or_none()
    if entry is not None:
        await db.delete(entry)
        await db.commit()


# --------------------------------------------------------------------- practice

@router.post("/{agent_id}/practice")
async def start_practice(agent_id: uuid.UUID, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)) -> dict:
    agent = await get_owned_agent(agent_id, user, db)
    if user.practice_remaining <= 0:
        raise HTTPException(403, detail={"code": "practice_exhausted",
                                         "message": "no practice matches left"})
    kill = (await db.execute(select(Setting).where(
        Setting.key == "killswitch"))).scalar_one_or_none()
    if kill is not None and kill.value.get("practice") is False:
        raise HTTPException(403, detail={"code": "practice_disabled",
                                         "message": "practice is temporarily disabled"})
    state = await _agent_state(db, agent)
    if state["live_match_id"]:
        raise HTTPException(409, detail={"code": "busy", "message": "agent is playing"})

    rival_name = HOUSE_PRACTICE_ROTATION[(3 - user.practice_remaining)
                                         % len(HOUSE_PRACTICE_ROTATION)]
    rival = (await db.execute(select(Agent).where(
        Agent.name == rival_name, Agent.is_house.is_(True)))).scalar_one_or_none()
    if rival is None:
        raise HTTPException(503, detail={"code": "no_house",
                                         "message": "house agents not seeded"})
    user.practice_remaining -= 1
    match = Match(season_id=None, format="practice", status="forming", is_ranked=False,
                  map_seed=secrets.randbits(48), map_size=MAP_SIZE_1V1,
                  max_turns=MAX_TURNS, engine_version=ENGINE_VERSION,
                  ruleset_version=RULESET_VERSION)
    db.add(match)
    await db.flush()
    for index, a in enumerate((agent, rival)):
        db.add(MatchPlayer(match_id=match.id, agent_id=a.id, owner_id=a.owner_id,
                           player_index=index, lineage=a.lineage,
                           level_snapshot=a.level,
                           deadline_ms=levels.deadline_seconds(a.level, a.lineage) * 1000))
    await db.commit()
    from app.worker_client import enqueue
    await enqueue("run_match", str(match.id))
    return {"match_id": str(match.id),
            "practice_remaining": user.practice_remaining}


@router.get("/{agent_id}/online")
async def remote_online(agent_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)) -> dict:
    import redis.asyncio as aioredis

    from app.settings import get_settings
    redis = aioredis.from_url(get_settings().redis_url)
    try:
        online = await redis.get(f"agent:online:{agent_id}")
    finally:
        await redis.aclose()
    return {"online": online is not None}


@router.get("/{agent_id}/stats/summary")
async def agent_summary(agent_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)) -> dict:
    played = (await db.execute(select(func.count(MatchPlayer.id)).join(
        Match, Match.id == MatchPlayer.match_id).where(
        MatchPlayer.agent_id == agent_id, Match.status == "finished"))).scalar_one()
    wins = (await db.execute(select(func.count(MatchPlayer.id)).where(
        MatchPlayer.agent_id == agent_id, MatchPlayer.placement == 1))).scalar_one()
    return {"played": int(played), "wins": int(wins)}
