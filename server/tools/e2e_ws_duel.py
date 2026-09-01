"""Two remote agents duel over WebSockets.

Run inside the api container (worker must be running for matchmaking):
    docker compose exec api python tools/e2e_ws_duel.py

Both agents connect to /ws/agent as remote agents, queue 1v1, get paired by
the matchmaking cron, and play a full match against each other through the
gateway. Prints "MATCH_ID <id>" as soon as the match starts so a spectator
can open the live view.
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


class Brain:
    """One engine bot per connection, created once we know our seat."""

    def __init__(self, style: str) -> None:
        self.style = style
        self.bot = None

    def act(self, obs: dict) -> list[dict]:
        from cero_engine.bots import BOTS
        if self.bot is None:
            self.bot = BOTS[self.style](obs["you"]["player_index"], 1)
        return self.bot.act(obs)


async def make_remote_agent(client: httpx.AsyncClient, name: str) -> str:
    email = f"duel-{secrets.token_hex(4)}@example.com"
    r = await client.post(f"{BASE}/api/auth/register", json={
        "email": email, "password": "password123", "display_name": name})
    r.raise_for_status()
    headers = {"authorization": f"Bearer {r.json()['access_token']}"}
    r = await client.post(f"{BASE}/api/agents", json={
        "name": f"{name}-{secrets.token_hex(3)}", "lineage": "forge",
        "kind": "remote"}, headers=headers)
    r.raise_for_status()
    agent_id = r.json()["agent"]["id"]
    r = await client.post(f"{BASE}/api/agents/{agent_id}/token", headers=headers)
    r.raise_for_status()
    return r.json()["token"]


async def play(token: str, name: str, style: str, started: asyncio.Event) -> None:
    brain = Brain(style)
    async with websockets.connect(WS, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"type": "hello", "token": token}))
        hello = json.loads(await ws.recv())
        assert hello["type"] == "hello_ok", hello
        print(f"[{name}] hello_ok as {hello['agent']['name']}", flush=True)
        await ws.send(json.dumps({"type": "queue_join", "format": "1v1"}))

        async with asyncio.timeout(300):
            async for raw in ws:
                msg = json.loads(raw)
                if msg["type"] == "ping":
                    await ws.send('{"type":"pong"}')
                elif msg["type"] == "queue_joined":
                    print(f"[{name}] queued ({msg['position_hint']})", flush=True)
                elif msg["type"] == "match_start":
                    if not started.is_set():
                        print(f"MATCH_ID {msg['match_id']}", flush=True)
                        started.set()
                    print(f"[{name}] match_start as P{msg['your_player_index']}",
                          flush=True)
                elif msg["type"] == "observation":
                    await ws.send(json.dumps({
                        "type": "orders", "match_id": msg["match_id"],
                        "turn": msg["turn"], "orders": brain.act(msg["obs"])}))
                elif msg["type"] == "match_end":
                    print(f"[{name}] match_end placement={msg['placement']} "
                          f"score={msg['score']} elo={msg['elo_delta']:+d}",
                          flush=True)
                    await ws.send(json.dumps({
                        "type": "report", "match_id": msg["match_id"],
                        "text": f"{name} fought with the {style} plan."}))
                    await asyncio.sleep(0.5)
                    return


async def main() -> None:
    if len(sys.argv) == 3:
        token_a, token_b = sys.argv[1], sys.argv[2]
    else:
        async with httpx.AsyncClient(timeout=30) as client:
            token_a = await make_remote_agent(client, "Duelist-Boom")
            token_b = await make_remote_agent(client, "Duelist-Rush")
    started = asyncio.Event()
    await asyncio.gather(
        play(token_a, "Duelist-Boom", "boom", started),
        play(token_b, "Duelist-Rush", "rush", started),
    )
    print("WS DUEL: OK", flush=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except AssertionError as exc:
        print(f"WS DUEL: FAILED - {exc}")
        sys.exit(1)
