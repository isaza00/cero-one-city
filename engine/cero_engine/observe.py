"""Per-player observation (PLAN.md §6.3): fog-filtered, detail-banded.

Built entirely by the engine so the fog invariant is testable in pure code.
The server merges in history, shouts, memory notes and the agent level.
Bands: A = direction + fuzzy strength; B = types, counts, approximate area;
C = exact positions, hp and heading.
"""

from __future__ import annotations

from cero_engine import rules
from cero_engine.fog import entity_visible_to, pack, visible_tiles
from cero_engine.score import score
from cero_engine.state import State, tk
from cero_engine.stats import compute_cap, compute_used

BANDS = ("A", "B", "C")


def observe(state: State, player_id: int, band: str = "C",
            diplo_actions: list[str] | None = None) -> dict:
    player = state.players[player_id]
    if player.lineage == "oracle":  # oracle sees one band better (capped at C)
        band = BANDS[min(BANDS.index(band) + 1, len(BANDS) - 1)]
    tiles = visible_tiles(state, player_id)
    explored = set(player.explored)

    units = []
    buildings = []
    for e in state.entities_sorted():
        if e.owner != player_id:
            continue
        if e.is_unit:
            status = []
            if e.stiff:
                status.append("stiff")
            if (e.standing_order or {}).get("type") == "fusing":
                status.append("fusing")
            units.append({"id": e.id, "type": e.type, "x": e.x, "y": e.y, "hp": e.hp,
                          "status": status, "standing_order": e.standing_order})
        else:
            b: dict = {"id": e.id, "type": e.type, "x": e.x, "y": e.y, "hp": e.hp}
            if e.build_progress:
                b["building_turns_left"] = e.build_progress
            if e.production:
                b["producing"] = {"unit": e.production["unit"],
                                  "turns_left": e.production["turns_left"]}
            if e.research:
                b["researching"] = {"tech": e.research["tech"],
                                    "turns_left": e.research["turns_left"]}
            if e.type == "cocoon":
                b["accumulator"] = e.accumulator
            if e.capture:
                b["disputed_by"] = e.capture["by"]
                b["dispute_counter"] = e.capture["counter"]
            buildings.append(b)

    visible_notables = []
    for (x, y) in sorted(tiles):
        terrain = state.tiles[y][x]
        key = tk(x, y)
        entry: dict = {}
        if terrain == "vein":
            entry = {"x": x, "y": y, "terrain": "vein", "vein_left": state.veins.get(key, 0)}
        elif terrain in ("rubble", "blocked"):
            entry = {"x": x, "y": y, "terrain": terrain}
        if key in state.scrap:
            entry = entry or {"x": x, "y": y, "terrain": terrain}
            entry["scrap"] = dict(state.scrap[key])
        if entry:
            visible_notables.append(entry)

    explored_only = []
    for key, seen in sorted(player.last_seen.items()):
        x, y = (int(v) for v in key.split(","))
        if (x, y) in tiles:
            continue
        explored_only.append({"x": x, "y": y, "last_seen_building": seen["type"],
                              "owner": seen["owner"]})

    enemies = _enemies_view(state, player_id, band, tiles)
    camps = []
    for e in state.entities_sorted():
        if e.type == "camp" and (e.x, e.y) in tiles:
            camps.append({"id": e.id, "x": e.x, "y": e.y, "hp": e.hp,
                          "hostile_to_you": player_id in e.camp_hostile_to})

    upkeep_next = len(state.units_of(player_id)) * rules.UPKEEP_PER_UNIT
    income = _income_estimate(state, player)

    research_view: dict = {"firmware": player.firmware,
                           "done": [t for t in player.techs
                                    if t not in ("firmware_v2", "firmware_v3")],
                           "in_progress": None}
    for b in state.buildings_of(player_id):
        if b.research:
            research_view["in_progress"] = {"tech": b.research["tech"],
                                            "turns_left": b.research["turns_left"]}
            break

    diplo = state.diplomacy
    truces = [{"with": (t["a"] if t["b"] == player_id else t["b"]),
               "turns_left": t["until_turn"] - state.turn}
              for t in diplo["truces"] if player_id in (t["a"], t["b"])]
    proposals_in = [{"from": p["from"], "kind": p["kind"], "against": p.get("against")}
                    for p in diplo["proposals"] if p["to"] == player_id]
    joint = [{"with": (j["a"] if j["b"] == player_id else j["b"]), "against": j["against"],
              "turns_left": j["until_turn"] - state.turn}
             for j in diplo["joint"] if player_id in (j["a"], j["b"])]

    scores = score(state)
    rival_estimate = _visible_rival_estimate(state, player_id, tiles)

    return {
        "turn": state.turn,
        "max_turns": state.max_turns,
        "you": {"player_index": player_id, "lineage": player.lineage},
        "resources": {
            "energy": player.energy, "metal": player.metal,
            "compute_used": compute_used(state, player_id),
            "compute_cap": compute_cap(state, player_id),
            "upkeep_next": upkeep_next,
            "income_estimate": income,
        },
        "research": research_view,
        "units": units,
        "buildings": buildings,
        "visible_map": {
            "size": state.size,
            "notable_tiles": visible_notables,
            "explored_only": explored_only,
            "explored_pct": len(explored) * 100 // (state.size * state.size),
        },
        "enemies_visible": enemies,
        "diplomacy": {"truces": truces, "proposals_in": proposals_in, "joint_pacts": joint,
                      "available_actions": diplo_actions or []},
        "camps": camps,
        "score_estimate": {"you": scores[player_id], "visible_best_rival": rival_estimate},
    }


def _income_estimate(state: State, player) -> dict:
    energy = 0
    metal = 0
    mine_rate = rules.MINE_METAL_FAST if "fast_mining" in player.techs else rules.MINE_METAL
    harvest = (rules.HARVEST_ENERGY_RICH if "rich_harvest" in player.techs
               else rules.HARVEST_ENERGY)
    for w in state.units_of(player.id):
        if w.type != "worker" or not w.standing_order:
            continue
        if w.standing_order.get("type") != "gather":
            continue
        gx, gy = w.standing_order["target"]
        if state.tiles[gy][gx] == "vein":
            metal += mine_rate
        elif any(e.type == "cocoon" and e.owner == player.id and (e.x, e.y) == (gx, gy)
                 for e in state.entities_sorted()):
            energy += harvest
    return {"energy": energy, "metal": metal}


def _enemies_view(state: State, player_id: int, band: str, tiles: set) -> list:
    visible = []
    for e in state.entities_sorted():
        if e.owner == player_id or e.owner < 0 or e.hp <= 0:
            continue
        if not state.players[e.owner].alive:
            continue
        if any((fx, fy) in tiles for fx, fy in e.footprint()) \
                and entity_visible_to(state, e, player_id, tiles):
            visible.append(e)
    if not visible:
        return []

    if band == "C":
        out = []
        for e in visible:
            entry = {"id": e.id, "owner": e.owner, "kind": e.kind, "type": e.type,
                     "x": e.x, "y": e.y, "hp": e.hp}
            if e.is_unit and e.heading:
                entry["heading"] = e.heading
            out.append(entry)
        return out

    if band == "B":
        groups: dict[tuple[int, str], list] = {}
        for e in visible:
            groups.setdefault((e.owner, e.type), []).append(e)
        out = []
        for (owner, etype), members in sorted(groups.items()):
            cx = sum(m.x for m in members) // len(members)
            cy = sum(m.y for m in members) // len(members)
            out.append({"owner": owner, "type": etype, "count": len(members),
                        "area": [cx // 4 * 4, cy // 4 * 4]})
        return out

    # Band A: direction from your core + fuzzy strength.
    anchor = next((e for e in state.entities_sorted()
                   if e.type == "core" and e.owner == player_id), None)
    ax, ay = (anchor.x, anchor.y) if anchor else (state.size // 2, state.size // 2)
    by_dir: dict[str, int] = {}
    for e in visible:
        dx, dy = e.x - ax, e.y - ay
        direction = ""
        if abs(dy) * 2 >= abs(dx):
            direction += "N" if dy < 0 else "S"
        if abs(dx) * 2 >= abs(dy):
            direction += "W" if dx < 0 else "E"
        by_dir[direction or "E"] = by_dir.get(direction or "E", 0) + 1
    strength = {1: "few", 2: "few", 3: "several", 4: "several", 5: "several"}
    return [{"direction": d, "strength": strength.get(n, "many")}
            for d, n in sorted(by_dir.items())]


def _visible_rival_estimate(state: State, player_id: int, tiles: set) -> int:
    best = 0
    for rival in state.players:
        if rival.id == player_id or not rival.alive:
            continue
        est = 0
        for e in state.entities_sorted():
            if e.owner != rival.id:
                continue
            if not any((fx, fy) in tiles for fx, fy in e.footprint()):
                continue
            if e.is_unit:
                est += rules.UNITS[e.type]["cost_e"] + rules.UNITS[e.type]["cost_m"]
            else:
                spec = rules.BUILDINGS[e.type]
                est += 2 * (spec["cost_e"] + spec["cost_m"])
                if e.type == "core":
                    est += rules.CORE_SCORE_COST * 2
        best = max(best, est)
    return best


def fog_pack(size: int, x: int, y: int) -> int:
    return pack(size, x, y)
