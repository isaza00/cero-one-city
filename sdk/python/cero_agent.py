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
    """A tiny Age-of-Empires baseline: found the city, farm and mine, train
    workers, build an assembler, stream strikers, attack what it sees."""

    def act(self, obs: dict) -> list[dict]:
        orders: list[dict] = []
        res = obs["resources"]
        units = obs["units"]
        buildings = obs["buildings"]
        menus = obs["menus"]
        my_workers = [u for u in units if u["type"] == "worker"]
        finished = [b for b in buildings if not b.get("under_construction")]
        sites = [b for b in buildings if b.get("under_construction")]
        cores = [b for b in finished if b["type"] == "core"]

        # 1. Nomad start: every worker founds the core at the engine's suggestion.
        if not cores:
            site = next((s for s in sites if s["type"] == "core"), None)
            core_menu = next(m for m in menus["build"] if m["building"] == "core")
            for w in my_workers:
                if site is not None:
                    orders.append({"type": "build", "actor_id": w["id"],
                                   "target_id": site["id"]})
                elif core_menu["available"] and core_menu.get("suggested_anchor"):
                    orders.append({"type": "build", "actor_id": w["id"],
                                   "building": "core",
                                   "anchor": core_menu["suggested_anchor"]})
            return orders

        # 2. Idle workers: alternate energy (pods, then cocoons) and metal (veins).
        pods = [t for t in obs["visible_map"]["notable_tiles"] if t.get("terrain") == "pod"]
        veins = [t for t in obs["visible_map"]["notable_tiles"] if t.get("terrain") == "vein"]
        cocoons = [b for b in finished if b["type"] == "cocoon"]
        energy_tiles = pods + cocoons
        for i, wid in enumerate(obs["economy"]["idle_workers"]):
            w = next(u for u in units if u["id"] == wid)
            pool = energy_tiles if (i % 2 == 0 and energy_tiles) else veins
            if not pool:
                continue
            t = min(pool, key=lambda t: max(abs(t["x"] - w["x"]), abs(t["y"] - w["y"])))
            orders.append({"type": "gather", "actor_id": wid, "target": [t["x"], t["y"]]})

        # 3. Core: workers up to 12 (the menu says whether it is affordable).
        core = next((b for b in cores if not b.get("producing") and not b.get("researching")),
                    None)
        worker_menu = next(m for m in menus["units"] if m["unit"] == "worker")
        if core and len(my_workers) < 12 and worker_menu["available"] \
                and res["energy"] - res["upkeep_next"] >= 30:
            orders.append({"type": "produce", "actor_id": core["id"], "unit": "worker"})

        # 4. Buildings, one site at a time: rack when compute is short, cocoons
        #    hugging the core when the pods are gone, then the assembler.
        def can_build(name: str) -> bool:
            return next(m for m in menus["build"] if m["building"] == name)["available"]

        def free_anchor(w: int, near: dict) -> list[int] | None:
            taken = {(t["x"], t["y"]) for t in obs["visible_map"]["notable_tiles"]}
            for b in buildings:
                bw = 2 if b["type"] in ("core", "assembler", "lab") else 1
                for dx in range(-1, bw + 1):
                    for dy in range(-1, bw + 1):
                        taken.add((b["x"] + dx, b["y"] + dy))
            for u in units:
                taken.add((u["x"], u["y"]))
            for r in range(2, 9):
                for dx in range(-r, r + 1):
                    for dy in range(-r, r + 1):
                        ax, ay = near["x"] + dx, near["y"] + dy
                        tiles = [(ax + i, ay + j) for i in range(w) for j in range(w)]
                        if all(t not in taken and min(t) > 0 for t in tiles):
                            return [ax, ay]
            return None

        assembler = next((b for b in finished if b["type"] == "assembler"), None)
        if not sites and my_workers:
            builder = my_workers[-1]
            if res["compute_cap"] - res["compute_used"] < 2 and can_build("rack"):
                anchor = free_anchor(1, cores[0])
                if anchor:
                    orders.append({"type": "build", "actor_id": builder["id"],
                                   "building": "rack", "anchor": anchor})
            elif not pods and len(cocoons) < 4 and can_build("cocoon"):
                anchor = free_anchor(1, cores[0])
                if anchor:
                    orders.append({"type": "build", "actor_id": builder["id"],
                                   "building": "cocoon", "anchor": anchor})
            elif assembler is None and can_build("assembler"):
                anchor = free_anchor(2, cores[0])
                if anchor:
                    orders.append({"type": "build", "actor_id": builder["id"],
                                   "building": "assembler", "anchor": anchor})

        # 5. Strikers forever.
        striker_menu = next(m for m in menus["units"] if m["unit"] == "striker")
        if assembler is not None and not assembler.get("producing") \
                and striker_menu["available"]:
            orders.append({"type": "produce", "actor_id": assembler["id"],
                           "unit": "striker"})

        # Army: attack the nearest visible enemy, or push toward the far corner.
        enemies = [e for e in obs["enemies_visible"] if "id" in e]
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
