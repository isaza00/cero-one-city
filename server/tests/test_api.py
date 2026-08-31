"""API tests: auth, agents, charter guard, model config (mock), queue, shouts."""

import pytest

pytestmark = pytest.mark.anyio


async def test_health(client):
    r = await client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["db"] and body["redis"]


async def test_auth_flow(client):
    r = await client.post("/api/auth/register", json={
        "email": "flow@example.com", "password": "password123",
        "display_name": "Flow"})
    assert r.status_code == 200
    tokens = r.json()
    assert tokens["user"]["practice_remaining"] == 3

    r = await client.post("/api/auth/login", json={
        "email": "flow@example.com", "password": "password123"})
    assert r.status_code == 200
    tokens = r.json()

    r = await client.post("/api/auth/refresh",
                          json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    rotated = r.json()
    # Rotation: the old refresh token is now dead.
    r = await client.post("/api/auth/refresh",
                          json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 401

    client.headers["authorization"] = f"Bearer {rotated['access_token']}"
    r = await client.get("/api/auth/me")
    assert r.status_code == 200

    r = await client.post("/api/auth/login", json={
        "email": "flow@example.com", "password": "wrong-password"})
    assert r.status_code == 401


async def test_agent_lifecycle_and_charter_guard(user_client):
    c = user_client
    r = await c.post("/api/agents", json={
        "name": "TestBot", "lineage": "forge", "kind": "hosted",
        "charter": "Be cautious. Prioritize metal over energy. Never trust a truce."})
    assert r.status_code == 200, r.text
    agent = r.json()["agent"]

    # Hosted agent without charter is rejected.
    r = await c.post("/api/agents", json={"name": "NoCharter", "lineage": "swarm",
                                          "kind": "hosted"})
    assert r.status_code == 422

    # Small charter edit passes the 25% diff guard; a rewrite does not.
    r = await c.patch(f"/api/agents/{agent['id']}/charter", json={
        "charter": "Be cautious. Prioritize metal over energy. Never trust a truce!!"})
    assert r.status_code == 200
    # Second edit locked until a match is played.
    r = await c.patch(f"/api/agents/{agent['id']}/charter", json={
        "charter": "Be cautious. Prioritize metal over energy. Never trust anyone."})
    assert r.status_code == 409

    r = await c.get(f"/api/agents/{agent['id']}")
    assert r.status_code == 200
    assert r.json()["interventions_count"] == 1  # one charter edit


async def test_charter_rewrite_rejected(user_client):
    c = user_client
    r = await c.post("/api/agents", json={
        "name": "Rewriter", "lineage": "oracle", "kind": "hosted",
        "charter": "A" * 400})
    agent = r.json()["agent"]
    r = await c.patch(f"/api/agents/{agent['id']}/charter",
                      json={"charter": "B" * 400})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "diff_too_big"


async def test_mock_model_config_and_queue(user_client):
    c = user_client
    r = await c.post("/api/agents", json={
        "name": "MockPlayer", "lineage": "swarm", "kind": "hosted",
        "charter": "Attack early and often."})
    agent = r.json()["agent"]
    r = await c.put(f"/api/agents/{agent['id']}/model", json={
        "provider": "mock", "model": "boom"})
    assert r.status_code == 200
    assert r.json()["test"]["ok"] is True

    r = await c.post(f"/api/agents/{agent['id']}/queue", json={"format": "1v1"})
    assert r.status_code == 200
    r = await c.post(f"/api/agents/{agent['id']}/queue", json={"format": "1v1"})
    assert r.status_code == 409  # already queued
    r = await c.delete(f"/api/agents/{agent['id']}/queue")
    assert r.status_code == 204


async def test_remote_token_rotation(user_client):
    c = user_client
    r = await c.post("/api/agents", json={"name": "RemoteOne", "lineage": "parasite",
                                          "kind": "remote"})
    agent = r.json()["agent"]
    r = await c.post(f"/api/agents/{agent['id']}/token")
    assert r.status_code == 200
    token1 = r.json()["token"]
    r = await c.post(f"/api/agents/{agent['id']}/token")
    token2 = r.json()["token"]
    assert token1 != token2 and token2.startswith("cero_")


async def test_leaderboard_and_seasons(client):
    r = await client.get("/api/leaderboard?format=1v1")
    assert r.status_code == 200
    r = await client.get("/api/seasons/current")
    assert r.status_code == 200
    assert r.json()["season"]["number"] >= 1


async def test_admin_requires_role(user_client):
    r = await user_client.get("/api/admin/model-prices")
    assert r.status_code == 403
