"""Control modes (app/game/modes.py): the owner picks, per seat, how much it
steers the agent - manual (the chat IS the controller), copilot (guidance) or
autonomous (the chat is closed) - and the API enforces the pick."""

import uuid

import pytest

pytestmark = pytest.mark.anyio


async def _agent(c, name: str) -> dict:
    r = await c.post("/api/agents", json={
        "name": name, "lineage": "forge", "kind": "hosted", "charter": "Do as told."})
    assert r.status_code == 200, r.text
    return r.json()["agent"]


async def _set_match(match_id: str, **fields) -> None:
    from app.db.models import Match
    from app.db.session import session_factory
    async with session_factory()() as db:
        match = await db.get(Match, uuid.UUID(match_id))
        for key, value in fields.items():
            setattr(match, key, value)
        await db.commit()


async def test_practice_seats_carry_the_mode(user_client):
    c = user_client
    agent = await _agent(c, "ModeSeat")
    r = await c.post(f"/api/agents/{agent['id']}/practice", json={"mode": "autonomous"})
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "autonomous"
    match_id = r.json()["match_id"]
    r = await c.get(f"/api/matches/{match_id}")
    modes = {p["agent_id"]: p["control_mode"] for p in r.json()["players"]}
    assert modes[agent["id"]] == "autonomous"
    assert all(m == "autonomous" for m in modes.values())  # the house plays alone
    await _set_match(match_id, status="cancelled")


async def test_practice_defaults_to_copilot_and_rejects_unknown_modes(user_client):
    c = user_client
    agent = await _agent(c, "ModeDefault")
    r = await c.post(f"/api/agents/{agent['id']}/practice", json={"mode": "pilot"})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "bad_mode"
    r = await c.post(f"/api/agents/{agent['id']}/practice")  # no body: copilot
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "copilot"
    match_id = r.json()["match_id"]
    r = await c.get(f"/api/matches/{match_id}")
    mine = next(p for p in r.json()["players"] if p["agent_id"] == agent["id"])
    assert mine["control_mode"] == "copilot"
    await _set_match(match_id, status="cancelled")


async def test_autonomous_closes_the_chat(user_client):
    c = user_client
    agent = await _agent(c, "ModeSilent")
    r = await c.post(f"/api/agents/{agent['id']}/practice", json={"mode": "autonomous"})
    match_id = r.json()["match_id"]
    await _set_match(match_id, status="live")
    r = await c.post(f"/api/matches/{match_id}/shout", json={
        "agent_id": agent["id"], "text": "Attack!"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "mode_autonomous"
    r = await c.get(f"/api/matches/{match_id}/shouts?agent_id={agent['id']}")
    assert r.json()["mode"] == "autonomous"
    assert r.json()["shouts"] == []
    await _set_match(match_id, status="cancelled")


async def test_manual_chat_is_the_controller(user_client):
    """Manual: one message per turn, EVERY turn (no per-match cap), and the
    messages are not interventions (the season counter stays put)."""
    c = user_client
    agent = await _agent(c, "ModeManual")
    r = await c.post(f"/api/agents/{agent['id']}/practice", json={"mode": "manual"})
    match_id = r.json()["match_id"]
    await _set_match(match_id, status="live")
    from app.routers.matches import MATCH_SHOUT_LIMIT
    r = await c.get(f"/api/matches/{match_id}")
    max_turns = r.json()["match"]["max_turns"]
    r = await c.get(f"/api/matches/{match_id}/shouts?agent_id={agent['id']}")
    assert r.json()["mode"] == "manual"
    assert r.json()["limit"] == max_turns
    for turn in range(MATCH_SHOUT_LIMIT + 1):
        await _set_match(match_id, current_turn=turn)
        r = await c.post(f"/api/matches/{match_id}/shout", json={
            "agent_id": agent["id"], "text": f"all workers on the pods ({turn})"})
        assert r.status_code == 200, r.text
        assert r.json()["shout"]["mode"] == "manual"
        assert r.json()["shout"]["match_limit"] == max_turns
    # Still one per turn: the agent reads the chat once per turn.
    r = await c.post(f"/api/matches/{match_id}/shout", json={
        "agent_id": agent["id"], "text": "twice in one turn"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "turn_limit"
    r = await c.get(f"/api/agents/{agent['id']}")
    assert r.json()["interventions_count"] == 0
    await _set_match(match_id, status="cancelled")


async def test_queue_carries_the_mode(user_client):
    c = user_client
    agent = await _agent(c, "ModeQueue")
    r = await c.put(f"/api/agents/{agent['id']}/model",
                    json={"provider": "mock", "model": "boom"})
    assert r.status_code == 200, r.text
    r = await c.post(f"/api/agents/{agent['id']}/queue",
                     json={"format": "1v1", "mode": "manual"})
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "manual"
    r = await c.get(f"/api/agents/{agent['id']}")
    assert r.json()["queued_format"] == "1v1"
    assert r.json()["queued_mode"] == "manual"
    r = await c.delete(f"/api/agents/{agent['id']}/queue")
    assert r.status_code == 204
    r = await c.post(f"/api/agents/{agent['id']}/queue",
                     json={"format": "1v1", "mode": "nope"})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "bad_mode"


async def test_custom_join_carries_the_mode(user_client):
    c = user_client
    agent = await _agent(c, "ModeCustom")
    r = await c.post("/api/matches/custom", json={"format": "1v1"})
    code = r.json()["code"]
    r = await c.post(f"/api/matches/custom/{code}/join",
                     json={"agent_id": agent["id"], "mode": "autonomous"})
    assert r.status_code == 200, r.text
    match_id = r.json()["match_id"]
    r = await c.get(f"/api/matches/{match_id}")
    assert r.json()["players"][0]["control_mode"] == "autonomous"
    await _set_match(match_id, status="cancelled")


async def test_identity_block_states_the_mode():
    from app.llm.prompts import system_block_identity
    kw = dict(name="x", lineage="forge", level=1, deadline_s=5, history_turns=3,
              band="A", diplo=["propose_truce"], charter=None, book_entries=[])
    assert "CONTROL MODE: COPILOT" in system_block_identity(**kw)
    manual = system_block_identity(**kw, control_mode="manual")
    assert "CONTROL MODE: MANUAL" in manual
    assert "never act on your own initiative" in manual
    assert "CONTROL MODE: AUTONOMOUS" in system_block_identity(**kw, control_mode="autonomous")


async def test_manual_seat_waits_for_the_first_instruction():
    """No model call (and no orders) in manual mode until the owner speaks;
    once it has, the agent keeps acting on the standing instructions."""
    from app.game.match_runner import Seat, owner_has_spoken
    seat = Seat(mp=None, agent=None, kind="hosted", mode="manual")
    assert owner_has_spoken(seat, {"shouts_from_owner": []}) is False
    assert owner_has_spoken(seat, {"shouts_from_owner": ["found the city"]}) is True
    assert owner_has_spoken(seat, {"shouts_from_owner": []}) is True  # sticky
