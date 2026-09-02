#!/usr/bin/env python3
"""Cero One City - THE GENERAL: a remote agent you command in plain language.

You are the general on the hill, not the chess player: you say "attack their
core", "defend", "more workers", "turrets", "truce with rust" - and the agent
turns that into the hundreds of concrete unit orders the game needs, every
turn, until you say otherwise. Under your directives runs the engine's own
Boom autopilot (economy, farms, houses, factories, ages), so the city keeps
growing while you shout.

Where the directives come from:
  * the in-game chat ("Talk to <agent>" on the live-match screen): each shout
    is delivered inside the next observation (obs.shouts_from_owner) - up to
    6 per match, one per turn;
  * a local text file (--orders-file): every NEW line you append is a
    directive, no limit - the general reads it every turn.

Directives (English or Spanish, several per line separated by ";" or ","):
  attack | push | all in | charge | ataca | avancen        army marches on the enemy city
  attack their workers|core|assembler|turrets|buildings    ...on that target kind
  workers attack | obreros al ataque                       the workers pile on too
  defend | hold | retreat | defiende | retirada            army comes home and guards the core
  raid the camp | saquea el campamento                     loot the nearest human camp
  more workers | boom | eco                                bigger worker target (+6)
  metal | energy                                           shift the crew toward that resource
  expand | depot | expansión                               drop a depot by the far vein
  farms | cocoons | granjas                                build a cocoon (needs a human)
  turrets | walls | torretas | muros                       fortify the front
  age up | tech up | firmware                              bank for the next firmware tier
  army: strikers|launchers|riders|wasps|towers|drones     production mix
  truce with <name> | accept truce | break truce          diplomacy
  autopilot | reset                                        forget every directive

Usage:
    python sdk/python/general_agent.py --server ws://localhost:8000 --token cero_... \
        [--format 1v1 | --no-queue] [--orders-file general_orders.txt] [--llm]

--llm: with ANTHROPIC_API_KEY set, each turn is decided by Claude (the same
rules digest hosted agents get, plus your directives); the scripted general
answers instead whenever the model is late or fails. Needs `pip install
websockets`; the engine package is imported from ../../engine.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import signal
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.insert(0, str(ROOT / "server"))

import websockets  # noqa: E402

from cero_engine.bots.base import cheb  # noqa: E402
from cero_engine.bots.boom import BoomBot  # noqa: E402

UNIT_WORDS = {
    "striker": r"strikers?|golpeadores?", "launcher": r"launchers?|lanzadores?|archers?|arqueros?",
    "rider": r"riders?|jinetes?|knights?|caballer", "wasp": r"wasps?|avispas?",
    "walking_tower": r"walking towers?|siege|asedio|torres? andantes?",
    "drone_swarm": r"drones?|enjambres?", "anvil": r"anvils?|yunques?",
    "spark": r"sparks?|chispas?", "prism": r"prisms?|prismas?", "leech": r"leech(es)?|sanguijuelas?",
}
TARGET_WORDS = {
    "workers": r"workers?|villagers?|obreros?|aldeanos?",
    "core": r"cores?|n[uú]cleos?|town cent(er|re)|base enemiga",
    "assembler": r"assemblers?|factor(y|ies)|f[aá]bricas?|barracks",
    "turret": r"turrets?|towers?|torretas?|torres?",
    "cocoon": r"cocoons?|farms?|granjas?|capullos?",
    "rack": r"racks?|houses?|casas?",
    "depot": r"depots?|dep[oó]sitos?",
    "building": r"buildings?|edificios?|city|ciudad|structures?",
}


def _has(pattern: str, text: str) -> bool:
    return re.search(rf"\b(?:{pattern})\b", text) is not None


class General(BoomBot):
    """Boom autopilot + a persistent stance set by plain-language directives."""

    name = "general"

    def __init__(self, player_id: int, seed: int = 0) -> None:
        super().__init__(player_id, seed)
        self.stance: str | None = None        # "attack" | "defend" | None
        self.target_kind: str | None = None   # workers | core | assembler | ... | None
        self.workers_attack = False
        self.raid = False
        self.diplomacy: list[dict] = []       # one-shot diplomacy orders
        self.names: dict[int, str] = {}       # player index -> name (from match_start)
        self.feedback: list[str] = []

    # ------------------------------------------------------------- directives
    def say(self, line: str) -> None:
        if self.feedback and self.feedback[-1] == line:
            return
        self.feedback.append(line)
        print(f"[general] {line}", flush=True)

    def directive(self, raw: str) -> None:
        """Parse one owner message into stance / preferences / one-shot orders."""
        before = len(self.feedback)
        for part in re.split(r"[;,]|\bthen\b|\by luego\b", raw.lower()):
            text = part.strip()
            if not text:
                continue
            said = set(self.feedback[before:])
            self._directive_one(text)
            if self.feedback[before:] and self.feedback[-1] in said:
                self.feedback.pop()  # "defend, everyone home" = one directive, one line

    def _directive_one(self, text: str) -> None:
        if _has(r"autopilot|reset|olvida todo|piloto autom[aá]tico", text):
            self.stance = None
            self.target_kind = None
            self.workers_attack = False
            self.raid = False
            self.prefs.clear()
            self.say("autopilot: every directive cleared")
            return

        # diplomacy first ("break truce" must not read as "attack")
        if _has(r"truce|tregua|peace|paz|cease ?fire", text):
            target = self._player_ref(text)
            if _has(r"break|romp|end|termina", text):
                action = "break_truce"
            elif _has(r"accept|acept", text):
                action = "accept_truce"
            else:
                action = "propose_truce"
            if target is None:
                target = next((i for i in self.names if i != self.player_id), None)
            if target is not None:
                self.diplomacy.append({"type": "diplomacy", "action": action,
                                       "target_player": target})
                self.say(f"diplomacy: {action.replace('_', ' ')} with "
                         f"{self.names.get(target, f'P{target}')}")
            return

        if _has(r"raid|loot|saquea|campamento|camp", text):
            self.raid = True
            self.say("raid: the army loots the nearest human camp")
            return

        wants_attack = _has(r"attack|push|all ?in|charge|assault|kill|destroy|raze|"
                            r"ataca|ataquen|ataque|avancen|avanza|carga|destru|mata|a por",
                            text)
        wants_defend = _has(r"defend|hold|retreat|fall back|regroup|guard|stay home|"
                            r"defiende|defiendan|retirada|ret[ií]rense|vuelvan|vuelve|"
                            r"aguanta|aguanten|guarda|resiste", text)
        if wants_defend:
            self.stance = "defend"
            self.workers_attack = False
            self.raid = False
            self.prefs["hold"] = True
            self.say("defend: the army comes home and guards the core")
            return
        if wants_attack:
            self.stance = "attack"
            self.raid = False
            self.prefs["hold"] = True  # the general drives the army, not the autopilot
            kind = next((k for k, pat in TARGET_WORDS.items() if _has(pat, text)), None)
            if _has(TARGET_WORDS["workers"], text) and re.search(
                    r"\b(?:workers?|obreros?|aldeanos?)\b.*\b(?:attack|atac|ataqu|fight|pele)",
                    text):
                # "workers attack ..." - OUR workers join in
                self.workers_attack = True
                kind = next((k for k, pat in TARGET_WORDS.items()
                             if k != "workers" and _has(pat, text)), None) or "building"
            self.target_kind = kind
            what = {None: "the enemy city", "building": "the nearest enemy buildings",
                    "workers": "the enemy workers"}.get(kind, f"the enemy {kind}")
            who = "workers and army" if self.workers_attack else "army"
            self.say(f"attack: the {who} go for {what}")
            return

        # economy / build preferences
        touched = []
        m = re.search(r"(\d+)\s*(?:workers?|obreros?|aldeanos?)", text)
        if m:
            self.prefs["workers"] = int(m.group(1))
            touched.append(f"{m.group(1)} workers")
        elif _has(r"more workers|m[aá]s obreros|boom|eco(?:nomy|nom[ií]a)?", text):
            self.prefs["workers"] = self.prefs.get("workers", 22) + 6
            touched.append(f"workers target {self.prefs['workers']}")
        if _has(r"metal|mine|mina|oro|gold", text) and not _has(r"energ", text):
            self.prefs["energy_pct"] = 30
            touched.append("crew shifts to metal")
        if _has(r"energ[yií]a?|food|comida|pods?", text) and not _has(r"metal", text):
            self.prefs["energy_pct"] = 60
            touched.append("crew shifts to energy")
        for building, pat in (("depot", r"expand|expansi[oó]n|depots?|dep[oó]sitos?"),
                              ("cocoon", r"farms?|cocoons?|granjas?|capullos?"),
                              ("turret", r"turrets?|torretas?|towers?|torres?"),
                              ("wall", r"walls?|muros?|murallas?|palisades?"),
                              ("lab", r"\blab\b|blacksmith|herrer[ií]a|upgrades?|mejoras?"),
                              ("rack", r"racks?|houses?|casas?|compute|c[oó]mputo"),
                              ("assembler", r"assemblers?|factor(?:y|ies)|f[aá]bricas?|barracks")):
            if _has(pat, text):
                self.prefs["want"] = building
                touched.append(f"build a {building}")
                break
        if _has(r"age up|tech up|firmware|advance|next age|siguiente era|sube de era|era", text):
            self.prefs["age_up"] = True
            touched.append("banking for the next firmware")
        mix = [u for u, pat in UNIT_WORDS.items() if _has(pat, text)]
        if mix and not wants_attack:
            self.prefs["wishlist"] = mix
            touched.append("army mix: " + ", ".join(mix))
        if touched:
            self.say("; ".join(touched))
        else:
            self.say(f"did not understand: \"{text}\" (try attack / defend / more workers / "
                     f"turrets / age up / truce with <name>)")

    def _player_ref(self, text: str) -> int | None:
        for idx, name in self.names.items():
            if idx != self.player_id and name.lower() in text:
                return idx
        m = re.search(r"\b(?:player|jugador|p)\s*(\d)\b", text)
        if m and int(m.group(1)) in self.names:
            return int(m.group(1))
        return None

    # ---------------------------------------------------------------- acting
    def act(self, obs: dict) -> list[dict]:
        for shout in obs.get("shouts_from_owner") or []:
            self.say(f"T{obs['turn']} order from the bench: \"{shout}\"")
            self.directive(shout)
        orders = super().act(obs)
        orders = self._apply_stance(obs, orders)
        orders.extend(self.diplomacy)
        self.diplomacy = []
        return orders

    def _apply_stance(self, obs: dict, orders: list[dict]) -> list[dict]:
        if self.raid and self.raid_camp(obs, orders, min_army=3):
            return orders
        army = self.army(obs)
        army_ids = {u["id"] for u in army}
        workers = self.units(obs, "worker")
        if self.stance is None and not self.workers_attack:
            return orders
        keep = [o for o in orders if o.get("actor_id") not in army_ids]
        if self.stance == "attack":
            target = self._resolve_target(obs, army)
            for u in army:
                so = u.get("standing_order") or {}
                if target.get("id") is not None:
                    if so.get("type") == "attack" and so.get("target_id") == target["id"]:
                        continue
                    keep.append({"actor_id": u["id"], "type": "attack", "target_id": target["id"]})
                else:
                    if so.get("type") == "attack_move" and so.get("to") == [target["x"], target["y"]]:
                        continue
                    keep.append({"actor_id": u["id"], "type": "attack_move",
                                 "to": [target["x"], target["y"]]})
            if self.workers_attack:
                wtarget = self._nearest_enemy(obs, workers, kinds=("building", "unit"))
                if wtarget is not None:
                    keep = [o for o in keep if o.get("actor_id") not in {w["id"] for w in workers}]
                    for w in workers:
                        so = w.get("standing_order") or {}
                        if so.get("type") == "attack" and so.get("target_id") == wtarget["id"]:
                            continue
                        keep.append({"actor_id": w["id"], "type": "attack",
                                     "target_id": wtarget["id"]})
        elif self.stance == "defend":
            hx, hy = self.base_center(obs)
            threats = [e for e in self.enemies(obs, "unit") if cheb(e["x"], e["y"], hx, hy) <= 12]
            for u in army:
                so = u.get("standing_order") or {}
                if threats:
                    t = self.nearest(u["x"], u["y"], threats)
                    if so.get("type") == "attack" and so.get("target_id") == t["id"]:
                        continue
                    keep.append({"actor_id": u["id"], "type": "attack", "target_id": t["id"]})
                elif cheb(u["x"], u["y"], hx, hy) > 5:
                    if so.get("type") == "move" and so.get("to") == [hx, hy]:
                        continue
                    keep.append({"actor_id": u["id"], "type": "move", "to": [hx, hy]})
        return keep

    def _nearest_enemy(self, obs: dict, group: list[dict], kinds=("unit", "building"),
                       types: tuple[str, ...] | None = None) -> dict | None:
        pool = [e for e in self.enemies(obs) if e.get("kind") in kinds
                and (types is None or e.get("type") in types)]
        if not pool or not group:
            return None
        cx = sum(u["x"] for u in group) // len(group)
        cy = sum(u["y"] for u in group) // len(group)
        return self.nearest(cx, cy, pool)

    def _resolve_target(self, obs: dict, army: list[dict]) -> dict:
        """What 'attack their X' means right now: a visible entity of that kind,
        else the last place we saw an enemy building, else the enemy corner."""
        kind = self.target_kind
        if kind == "workers":
            t = self._nearest_enemy(obs, army, kinds=("unit",), types=("worker",))
            if t is not None:
                return {"id": t["id"], "x": t["x"], "y": t["y"]}
        elif kind in ("core", "assembler", "turret", "cocoon", "rack", "depot"):
            t = self._nearest_enemy(obs, army, kinds=("building",), types=(kind,))
            if t is not None:
                return {"id": t["id"], "x": t["x"], "y": t["y"]}
        elif kind == "building":
            t = self._nearest_enemy(obs, army, kinds=("building",))
            if t is not None:
                return {"id": t["id"], "x": t["x"], "y": t["y"]}
        t = self._nearest_enemy(obs, army, kinds=("building", "unit"))
        if t is not None and kind is None:
            return {"id": t["id"], "x": t["x"], "y": t["y"]}
        # memory: last-seen enemy buildings (fog), prefer the kind asked for, then cores
        seen = [s for s in obs["visible_map"].get("explored_only", [])
                if s.get("owner") not in (None, self.player_id, -1)]
        if seen and army:
            cx = sum(u["x"] for u in army) // len(army)
            cy = sum(u["y"] for u in army) // len(army)
            want = kind if kind in ("core", "assembler", "turret", "cocoon", "rack", "depot") else "core"
            pick = [s for s in seen if s["last_seen_building"] == want] or seen
            best = min(pick, key=lambda s: (cheb(cx, cy, s["x"], s["y"]), s["x"], s["y"]))
            return {"id": None, "x": best["x"], "y": best["y"]}
        ex, ey = self.enemy_corner(obs)
        return {"id": None, "x": ex, "y": ey}


# ------------------------------------------------------------------ LLM mode

def llm_orders(obs: dict, directives: list[str], deadline_s: float, model: str) -> dict | None:
    """Ask Claude for this turn's orders (Anthropic Messages API, no SDK needed).
    Returns the parsed {"orders": [...]} or None (late / error / malformed)."""
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        return None
    try:
        from app.llm.prompts import system_block_rules  # the same digest hosted agents get
        rules = system_block_rules()
    except Exception:
        rules = ("You play CERO ONE CITY (Age of Empires with robots) by answering with JSON "
                 "orders only. Read obs.menus and obs.units/buildings for ids.")
    system = (rules + "\n\nYOU ARE THE GENERAL'S BRAIN. Standing directives from the owner "
              "(obey them, resolve every reference against the observation, never ask): "
              + (" | ".join(directives[-8:]) or "(none: play a strong, complete game)"))
    body = json.dumps({
        "model": model, "max_tokens": 1500, "system": system,
        "messages": [{"role": "user", "content":
                      f"Turn {obs['turn']}/{obs['max_turns']}. Reply ONLY with the orders JSON.\n"
                      + json.dumps(obs, separators=(",", ":"))}],
    }).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages", data=body, method="POST",
        headers={"content-type": "application/json", "x-api-key": key,
                 "anthropic-version": "2023-06-01"})
    try:
        with urllib.request.urlopen(req, timeout=max(1.0, deadline_s)) as r:
            payload = json.loads(r.read().decode())
        text = "".join(b.get("text", "") for b in payload.get("content", []))
        start, end = text.find("{"), text.rfind("}")
        parsed = json.loads(text[start:end + 1]) if start >= 0 else None
        return parsed if isinstance(parsed, dict) and isinstance(parsed.get("orders"), list) else None
    except Exception as exc:  # late, network, malformed: the scripted general answers
        print(f"[general] llm fallback: {type(exc).__name__}", flush=True)
        return None


# ------------------------------------------------------------------ the loop

class OrdersFile:
    """New lines appended to a text file become directives (no per-match cap)."""

    def __init__(self, path: str | None) -> None:
        self.path = Path(path) if path else None
        self.seen = 0
        if self.path is not None:
            self.path.touch()
            self.seen = len(self.path.read_text(encoding="utf-8").splitlines())

    def poll(self) -> list[str]:
        if self.path is None:
            return []
        lines = self.path.read_text(encoding="utf-8").splitlines()
        fresh = [ln.strip() for ln in lines[self.seen:] if ln.strip() and not ln.startswith("#")]
        self.seen = len(lines)
        return fresh


async def run(server: str, token: str, fmt: str | None, orders_file: str | None,
              llm_model: str | None) -> None:
    url = server.rstrip("/") + "/ws/agent"
    async with websockets.connect(url, max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"type": "hello", "token": token}))
        hello = json.loads(await ws.recv())
        if hello.get("type") != "hello_ok":
            raise SystemExit(f"auth failed: {hello}")
        agent = hello["agent"]
        print(f"[general] online as {agent['name']} (level {agent['level']}, "
              f"{hello['limits']['deadline_ms']}ms per turn)", flush=True)
        if fmt:
            await ws.send(json.dumps({"type": "queue_join", "format": fmt}))

        general: General | None = None
        files = OrdersFile(orders_file)
        directives: list[str] = []
        locker: str | None = None
        async for raw in ws:
            msg = json.loads(raw)
            mtype = msg.get("type")
            if mtype == "ping":
                await ws.send('{"type":"pong"}')
            elif mtype == "queue_joined":
                print(f"[general] queued for {msg['format']} (a house agent fills in after ~60s)",
                      flush=True)
            elif mtype == "match_start":
                idx = msg["your_player_index"]
                general = General(idx, seed=0)
                general.names = {p["player_index"]: p["name"] for p in msg["players"]}
                locker = msg.get("locker_b64")
                print(f"[general] match {msg['match_id']}: you are player {idx} vs "
                      f"{[p['name'] for p in msg['players'] if p['player_index'] != idx]}",
                      flush=True)
            elif mtype == "observation":
                obs = msg["obs"]
                t0 = time.perf_counter()
                if general is None:
                    general = General(obs["you"]["player_index"], seed=0)
                for line in files.poll():
                    print(f"[general] T{obs['turn']} order from file: \"{line}\"", flush=True)
                    general.directive(line)
                    directives.append(line)
                directives.extend(obs.get("shouts_from_owner") or [])
                orders = general.act(obs)
                if llm_model:
                    budget = msg["deadline_ms"] / 1000 - 1.2 - (time.perf_counter() - t0)
                    loop = asyncio.get_running_loop()
                    parsed = await loop.run_in_executor(
                        None, llm_orders, obs, directives, budget, llm_model)
                    if parsed:
                        orders = parsed["orders"]
                        print(f"[general] T{obs['turn']}: Claude issued {len(orders)} orders",
                              flush=True)
                await ws.send(json.dumps({
                    "type": "orders", "match_id": msg["match_id"], "turn": msg["turn"],
                    "orders": orders, "locker_b64": locker}))
                eco = obs.get("economy", {})
                if obs["turn"] % 5 == 0:
                    print(f"[general] T{obs['turn']} E{obs['resources']['energy']} "
                          f"M{obs['resources']['metal']} workers {eco.get('workers')} "
                          f"army {len(general.army(obs))} stance {general.stance or 'autopilot'} "
                          f"({(time.perf_counter() - t0) * 1000:.0f} ms)", flush=True)
            elif mtype == "match_end":
                print(f"[general] match over: placement {msg.get('placement')} "
                      f"score {msg.get('score')}", flush=True)
                if fmt:
                    await ws.send(json.dumps({"type": "queue_join", "format": fmt}))
                else:
                    return
            elif mtype == "error":
                print(f"[general] server error: {msg.get('code')}: {msg.get('message')}",
                      flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Cero One City - the general (remote agent)")
    parser.add_argument("--server", default="ws://localhost:8000")
    parser.add_argument("--token", required=True)
    parser.add_argument("--format", default="1v1", choices=["1v1", "ffa"])
    parser.add_argument("--no-queue", action="store_true",
                        help="do not queue; wait for a custom/practice match to start")
    parser.add_argument("--orders-file", default=None,
                        help="text file: every new line you append is a directive")
    parser.add_argument("--llm", action="store_true",
                        help="let Claude decide each turn (needs ANTHROPIC_API_KEY)")
    parser.add_argument("--model", default="claude-haiku-4-5")
    args = parser.parse_args()

    loop = asyncio.new_event_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, loop.stop)
        except NotImplementedError:
            pass  # Windows
    try:
        loop.run_until_complete(run(args.server, args.token,
                                    None if args.no_queue else args.format,
                                    args.orders_file, args.model if args.llm else None))
    except KeyboardInterrupt:
        print("bye - remember: dying mid-match forfeits by abandonment")


if __name__ == "__main__":
    main()
