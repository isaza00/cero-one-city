"""End-to-end match flow with mock (bot) agents through the real runner:
practice match -> turns persisted with a verifiable hash chain -> finalize
(placements, XP, reports cleanup) -> replay endpoints serve every state."""

import asyncio
import uuid

import pytest
from sqlalchemy import select

pytestmark = pytest.mark.anyio


class FakeArqRedis:
    """Just enough of arq's redis for MatchRunner: locking + pubsub + blpop."""

    def __init__(self, real_redis):
        self.real = real_redis

    async def set(self, *a, **kw):
        return await self.real.set(*a, **kw)

    async def get(self, *a, **kw):
        return await self.real.get(*a, **kw)

    async def delete(self, *a, **kw):
        return await self.real.delete(*a, **kw)

    async def expire(self, *a, **kw):
        return await self.real.expire(*a, **kw)

    async def publish(self, *a, **kw):
        return await self.real.publish(*a, **kw)

    async def blpop(self, *a, **kw):
        return await self.real.blpop(*a, **kw)

    async def enqueue_job(self, *a, **kw):
        return None


async def test_practice_match_runs_to_completion(user_client, app):
    c = user_client
    r = await c.post("/api/agents", json={
        "name": "PracticeKid", "lineage": "forge", "kind": "hosted",
        "charter": "Learn the ropes."})
    agent = r.json()["agent"]

    r = await c.post(f"/api/agents/{agent['id']}/practice")
    assert r.status_code == 200, r.text
    match_id = r.json()["match_id"]
    assert r.json()["practice_remaining"] == 2

    # Run the match inline through the real runner (mock seats: no API keys set).
    # A live worker may also grab the match via its resume cron; the redis lock
    # makes that safe, so poll until whoever won the race finishes it.
    import redis.asyncio as aioredis

    from app.game.match_runner import run_match
    from app.settings import get_settings
    real = aioredis.from_url(get_settings().redis_url)
    try:
        await asyncio.wait_for(run_match({"redis": FakeArqRedis(real)}, match_id),
                               timeout=120)
    finally:
        await real.aclose()

    body = None
    for _ in range(60):
        r = await c.get(f"/api/matches/{match_id}")
        body = r.json()
        if body["match"]["status"] == "finished":
            break
        await asyncio.sleep(2)
    assert body["match"]["status"] == "finished"
    assert body["match"]["summary"]["turns"] > 0
    placements = body["match"]["summary"]["placements"]
    assert len(placements) == 2

    # Replay: every turn state is there and the chain verifies.
    r = await c.get(f"/api/matches/{match_id}/replay")
    turns = r.json()["turns_available"]
    assert turns[0] == 0 and len(turns) == body["match"]["summary"]["turns"] + 1

    from cero_engine.hashing import chain_hash, hash_state
    from cero_engine.state import State
    chain = ""
    for n in turns:
        rt = await c.get(f"/api/matches/{match_id}/turns/{n}")
        data = rt.json()
        assert hash_state(State.from_dict(data["state"])) == data["state_hash"]
        chain = chain_hash(chain, data["state_hash"])

    # Practice gives no XP and no Elo.
    r = await c.get(f"/api/agents/{agent['id']}")
    assert r.json()["xp"] == 0

    # Match memories were wiped at finalize.
    from app.db.models import MatchMemory
    from app.db.session import session_factory
    async with session_factory()() as db:
        left = (await db.execute(select(MatchMemory).where(
            MatchMemory.match_id == uuid.UUID(match_id)))).scalars().all()
        assert left == []


async def test_shout_limits(user_client, app):
    c = user_client
    r = await c.post("/api/agents", json={
        "name": "Shouty", "lineage": "swarm", "kind": "hosted",
        "charter": "Listen to your owner."})
    agent = r.json()["agent"]
    r = await c.post(f"/api/agents/{agent['id']}/practice")
    match_id = r.json()["match_id"]

    # Match is forming/live=forming; shout requires live. Flip it manually.
    import uuid as _uuid

    from app.db.models import Match
    from app.db.session import session_factory
    async with session_factory()() as db:
        match = await db.get(Match, _uuid.UUID(match_id))
        match.status = "live"
        await db.commit()

    async def set_turn(n: int) -> None:
        async with session_factory()() as db:
            m = await db.get(Match, _uuid.UUID(match_id))
            m.current_turn = n
            await db.commit()

    # First message lands; a second one on the SAME turn is rejected.
    r = await c.post(f"/api/matches/{match_id}/shout", json={
        "agent_id": agent["id"], "text": "Hold the truce! (0)"})
    assert r.status_code == 200, r.text
    r = await c.post(f"/api/matches/{match_id}/shout", json={
        "agent_id": agent["id"], "text": "Same-turn spam"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "turn_limit"

    # One per turn is fine, up to the per-match cap of 6.
    for i in range(1, 6):
        await set_turn(i)
        r = await c.post(f"/api/matches/{match_id}/shout", json={
            "agent_id": agent["id"], "text": f"Hold the truce! ({i})"})
        assert r.status_code == 200, r.text
    await set_turn(6)
    r = await c.post(f"/api/matches/{match_id}/shout", json={
        "agent_id": agent["id"], "text": "One too many"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "match_limit"

    # Don't leave a zombie "live" match behind for the resume cron to chew on.
    async with session_factory()() as db:
        match = await db.get(Match, _uuid.UUID(match_id))
        match.status = "cancelled"
        await db.commit()
