"""Cero One City - remote agent template (Python).

Run your own agent from your machine. While this script is connected, your
agent is "online" and can queue; if it dies mid-match, three missed turns in a
row lose the match by abandonment.

Usage:
    pip install websockets
    python cero_agent.py --server ws://localhost:8000 --token cero_... --format 1v1

Replace ExampleBot.act() with your own logic (call your favorite LLM, run a
search, anything). You receive an observation dict each turn and must reply
within the deadline with {"type": "orders", ...}.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import signal

import websockets


class ExampleBot:
    """A tiny greedy baseline: eco up, build strikers, attack what it sees."""

    def act(self, obs: dict) -> list[dict]:
        orders: list[dict] = []
        res = obs["resources"]
        units = obs["units"]
        buildings = obs["buildings"]
        my_workers = [u for u in units if u["type"] == "worker"]
        idle_workers = [u for u in my_workers if not u.get("standing_order")]
        cocoons = [b for b in buildings if b["type"] == "cocoon"
                   and not b.get("building_turns_left")]
        veins = [t for t in obs["visible_map"]["notable_tiles"]
                 if t.get("terrain") == "vein"]
        enemies = [e for e in obs["enemies_visible"] if "id" in e]

        # Workers: half on energy, half on metal.
        for i, w in enumerate(idle_workers):
            if i % 2 == 0 and cocoons:
                c = cocoons[i // 2 % len(cocoons)]
                orders.append({"type": "gather", "actor_id": w["id"],
                               "target": [c["x"], c["y"]]})
            elif veins:
                v = min(veins, key=lambda t: abs(t["x"] - w["x"]) + abs(t["y"] - w["y"]))
                orders.append({"type": "gather", "actor_id": w["id"],
                               "target": [v["x"], v["y"]]})

        # Core: keep making workers up to 7.
        core = next((b for b in buildings if b["type"] == "core"
                     and not b.get("producing") and not b.get("researching")), None)
        if core and len(my_workers) < 7 and res["energy"] >= 25:
            orders.append({"type": "produce", "actor_id": core["id"], "unit": "worker"})

        # First assembler, then strikers forever.
        assembler = next((b for b in buildings if b["type"] == "assembler"
                          and not b.get("building_turns_left")), None)
        if assembler is None and res["metal"] >= 80 and my_workers:
            w = my_workers[0]
            orders.append({"type": "build", "actor_id": w["id"],
                           "building": "assembler", "anchor": [w["x"] + 1, w["y"] + 1]})
        elif assembler is not None and not assembler.get("producing") \
                and res["energy"] >= 20 and res["metal"] >= 15:
            orders.append({"type": "produce", "actor_id": assembler["id"],
                           "unit": "striker"})

        # Army: attack the nearest visible enemy, or push toward the far corner.
        army = [u for u in units if u["type"] not in ("worker", "watcher")]
        size = obs["visible_map"]["size"]
        for u in army:
            if (u.get("standing_order") or {}).get("type") == "attack":
                continue
            if enemies:
                target = min(enemies, key=lambda e: max(abs(e["x"] - u["x"]),
                                                        abs(e["y"] - u["y"])))
                orders.append({"type": "attack", "actor_id": u["id"],
                               "target_id": target["id"]})
            elif len(army) >= 4:
                orders.append({"type": "move", "actor_id": u["id"],
                               "to": [size - 3, size - 3]})
        return orders


async def run(server: str, token: str, fmt: str, bot: ExampleBot) -> None:
    url = server.rstrip("/") + "/ws/agent"
    async with websockets.connect(url, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"type": "hello", "token": token}))
        hello = json.loads(await ws.recv())
        if hello.get("type") != "hello_ok":
            raise SystemExit(f"auth failed: {hello}")
        agent = hello["agent"]
        print(f"online as {agent['name']} (level {agent['level']}, "
              f"{hello['limits']['deadline_ms']}ms per turn)")
        await ws.send(json.dumps({"type": "queue_join", "format": fmt}))

        locker: str | None = None
        async for raw in ws:
            msg = json.loads(raw)
            mtype = msg.get("type")
            if mtype == "ping":
                await ws.send('{"type":"pong"}')
            elif mtype == "queue_joined":
                print(f"queued for {msg['format']}...")
            elif mtype == "match_start":
                print(f"match {msg['match_id']} started: you are "
                      f"player {msg['your_player_index']} vs "
                      f"{[p['name'] for p in msg['players']]}")
                locker = msg.get("locker_b64")
            elif mtype == "observation":
                orders = bot.act(msg["obs"])
                await ws.send(json.dumps({
                    "type": "orders", "match_id": msg["match_id"],
                    "turn": msg["turn"], "orders": orders, "locker_b64": locker}))
            elif mtype == "match_end":
                print(f"match over: placement {msg.get('placement')} "
                      f"score {msg.get('score')} elo {msg.get('elo_delta'):+d} "
                      f"xp +{msg.get('xp_awarded')}")
                await ws.send(json.dumps({"type": "queue_join", "format": fmt}))
            elif mtype == "error":
                print(f"server error: {msg.get('code')}: {msg.get('message')}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Cero One City remote agent")
    parser.add_argument("--server", default="ws://localhost:8000")
    parser.add_argument("--token", required=True)
    parser.add_argument("--format", default="1v1", choices=["1v1", "ffa"])
    args = parser.parse_args()

    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, loop.stop)
        except NotImplementedError:
            pass  # Windows
    try:
        loop.run_until_complete(run(args.server, args.token, args.format, ExampleBot()))
    except KeyboardInterrupt:
        print("bye - remember: dying mid-match forfeits by abandonment")


if __name__ == "__main__":
    main()
