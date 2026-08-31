"""Live end-to-end test of the remote-agent path against the running stack.

Run inside the api container (worker must be running for matchmaking):
    docker compose exec api python tools/e2e_remote.py

Flow: register two users -> hosted mock agent queues via REST, remote agent
queues via WS -> the matchmaking cron pairs them -> the remote plays a full
match through the gateway -> assert match_end; then a second match where the
remote disconnects mid-match -> assert abandonment.
"""

from __future__ import annotations

import asyncio
import json
import secrets
import sys

import httpx
import websockets

BASE = "http://localhost:8000"
WS = "ws://localhost:8000/ws/agent"


def bot_orders(obs: dict) -> list[dict]:
    """Reuse the engine's boom bot as the remote brain (available in-container)."""
    from cero_engine.bots import BOTS
    bot = getattr(bot_orders, "_bot", None)
    if bot is None or getattr(bot_orders, "_pid", None) != obs["you"]["player_index"]:
        bot = BOTS["boom"](obs["you"]["player_index"], 1)
        bot_orders._bot = bot
        bot_orders._pid = obs["you"]["player_index"]
    return bot.act(obs)


async def register_and_agent(client: httpx.AsyncClient, kind: str) -> tuple[dict, dict]:
    email = f"e2e-{secrets.token_hex(4)}@example.com"
    r = await client.post(f"{BASE}/api/auth/register", json={
        "email": email, "password": "password123", "display_name": "E2E"})
    r.raise_for_status()
    tokens = r.json()
    headers = {"authorization": f"Bearer {tokens['access_token']}"}
    body = {"name": f"e2e-{kind}-{secrets.token_hex(3)}", "lineage": "forge",
            "kind": kind}
    if kind == "hosted":
        body["charter"] = "Win with a balanced game."
    r = await client.post(f"{BASE}/api/agents", json=body, headers=headers)
    r.raise_for_status()
    return tokens, {"agent": r.json()["agent"], "headers": headers}


async def play_full_match() -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        _, hosted = await register_and_agent(client, "hosted")
        r = await client.put(f"{BASE}/api/agents/{hosted['agent']['id']}/model",
                             json={"provider": "mock", "model": "rush"},
                             headers=hosted["headers"])
        r.raise_for_status()
        r = await client.post(f"{BASE}/api/agents/{hosted['agent']['id']}/queue",
                              json={"format": "1v1"}, headers=hosted["headers"])
        r.raise_for_status()

        _, remote = await register_and_agent(client, "remote")
        r = await client.post(f"{BASE}/api/agents/{remote['agent']['id']}/token",
                              headers=remote["headers"])
        token = r.json()["token"]

        match_id = None
        async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
            await ws.send(json.dumps({"type": "hello", "token": token}))
            hello = json.loads(await ws.recv())
            assert hello["type"] == "hello_ok", hello
            await ws.send(json.dumps({"type": "queue_join", "format": "1v1"}))

            async with asyncio.timeout(240):
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg["type"] == "ping":
                        await ws.send('{"type":"pong"}')
                    elif msg["type"] == "match_start":
                        match_id = msg["match_id"]
                        print(f"  match_start {match_id} as P{msg['your_player_index']}")
                    elif msg["type"] == "observation":
                        await ws.send(json.dumps({
                            "type": "orders", "match_id": msg["match_id"],
                            "turn": msg["turn"], "orders": bot_orders(msg["obs"]),
                            "locker_b64": "ZTJlLW1lbW9yeQ=="}))
                    elif msg["type"] == "match_end":
                        print(f"  match_end placement={msg['placement']} "
                              f"score={msg['score']} elo={msg['elo_delta']:+d}")
                        await ws.send(json.dumps({"type": "report",
                                                  "match_id": msg["match_id"],
                                                  "text": "e2e remote report"}))
                        await asyncio.sleep(0.5)
                        break

        r = await client.get(f"{BASE}/api/matches/{match_id}")
        body = r.json()
        assert body["match"]["status"] == "finished", body["match"]["status"]
        assert any(p["kind"] == "remote" for p in body["players"])
        print(f"  REST confirms finished in {body['match']['summary']['turns']} turns")
        return match_id


async def abandonment_check() -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        _, hosted = await register_and_agent(client, "hosted")
        await client.put(f"{BASE}/api/agents/{hosted['agent']['id']}/model",
                         json={"provider": "mock", "model": "turtle"},
                         headers=hosted["headers"])
        await client.post(f"{BASE}/api/agents/{hosted['agent']['id']}/queue",
                          json={"format": "1v1"}, headers=hosted["headers"])
        _, remote = await register_and_agent(client, "remote")
        r = await client.post(f"{BASE}/api/agents/{remote['agent']['id']}/token",
                              headers=remote["headers"])
        token = r.json()["token"]

        match_id = None
        async with websockets.connect(WS) as ws:
            await ws.send(json.dumps({"type": "hello", "token": token}))
            await ws.recv()
            await ws.send(json.dumps({"type": "queue_join", "format": "1v1"}))
            async with asyncio.timeout(120):
                async for raw in ws:
                    msg = json.loads(raw)
                    if msg["type"] == "ping":
                        await ws.send('{"type":"pong"}')
                    elif msg["type"] == "match_start":
                        match_id = msg["match_id"]
                    elif msg["type"] == "observation":
                        print("  got first observation - disconnecting mid-match")
                        break
        # Socket closed: the runner should abandon us after 3 missed turns.
        async with asyncio.timeout(240):
            while True:
                await asyncio.sleep(5)
                r = await client.get(f"{BASE}/api/matches/{match_id}")
                body = r.json()
                if body["match"]["status"] == "finished":
                    remote_seat = next(p for p in body["players"] if p["kind"] == "remote")
                    assert remote_seat["status"] == "abandoned", remote_seat
                    print(f"  abandonment confirmed at turn "
                          f"{body['match']['summary']['turns']}")
                    return


async def main() -> None:
    print("1) full remote match through the gateway")
    await play_full_match()
    print("2) mid-match disconnect => abandonment")
    await abandonment_check()
    print("E2E REMOTE: OK")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except AssertionError as exc:
        print(f"E2E REMOTE: FAILED - {exc}")
        sys.exit(1)
