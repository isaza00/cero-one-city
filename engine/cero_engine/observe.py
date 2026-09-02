"""Per-player observation (PLAN.md §6.3): fog-filtered, detail-banded.

Built entirely by the engine so the fog invariant is testable in pure code.
The server merges in history, shouts, memory notes and the agent level.
Enemies inside your vision are always fully identified (AoE2 rule: you can
target anything you can see); bands only scale non-combat perks handled by
the server (history depth, deadline, output budget).

s2.0 adds the AoE2 "command panel": `menus` lists every building, unit and
tech with its cost and whether it can be ordered RIGHT NOW (and why not),
`economy` names idle workers and drop-offs, and construction sites report
their crews and progress.
"""

from __future__ import annotations

from cero_engine import rules, stats
from cero_engine.fog import entity_visible_to, pack, visible_tiles
from cero_engine.score import score
from cero_engine.state import State, tk

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
    idle_workers: list[int] = []
    builders = 0
    gathering = {"energy": 0, "metal": 0}
    for e in state.entities_sorted():
        if e.owner != player_id:
            continue
        if e.is_unit:
            status = []
            if e.stiff:
                status.append("stiff")
            if (e.standing_order or {}).get("type") == "fusing":
                status.append("fusing")
            u: dict = {"id": e.id, "type": e.type, "x": e.x, "y": e.y, "hp": e.hp,
                       "status": status, "standing_order": e.standing_order}
            if e.cargo:
                u["carrying"] = {"e": e.cargo_e, "m": e.cargo_m}
            units.append(u)
            if e.type == "worker":
                so = e.standing_order or {}
                if not so and not e.stiff:
                    idle_workers.append(e.id)
                elif so.get("type") == "build":
                    builders += 1
                elif so.get("type") == "gather":
                    kind = _gather_kind(state, player_id, so.get("target", [0, 0]))
                    if kind in ("pod", "cocoon"):
                        gathering["energy"] += 1
                    elif kind in ("vein", "scrap", "rubble"):
                        gathering["metal"] += 1
        else:
            b: dict = {"id": e.id, "type": e.type, "x": e.x, "y": e.y, "hp": e.hp}
            if e.build_progress:
                crew = sum(1 for u in state.units_of(player_id)
                           if u.type == "worker"
                           and (u.standing_order or {}).get("type") == "build"
                           and u.standing_order.get("target_id") == e.id)
                b["under_construction"] = {"work_left": e.build_progress,
                                           "work_total": e.build_total, "builders": crew}
            if e.is_dropoff:
                b["dropoff"] = True
            if e.production:
                b["producing"] = {"unit": e.production["unit"],
                                  "turns_left": e.production["turns_left"]}
            if e.research:
                b["researching"] = {"tech": e.research["tech"],
                                    "turns_left": e.research["turns_left"]}
            if e.rally is not None:
                b["rally"] = list(e.rally)
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
        elif terrain == "pod":
            entry = {"x": x, "y": y, "terrain": "pod", "pod_left": state.pods.get(key, 0)}
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

    upkeep_next = sum(rules.UPKEEP_PER_UNIT for u in state.units_of(player_id)
                      if u.type not in rules.UPKEEP_EXEMPT)
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
    dropoffs = [{"id": b.id, "type": b.type, "x": b.x, "y": b.y}
                for b in state.dropoffs_of(player_id)]
    workers = [u for u in state.units_of(player_id) if u.type == "worker"]

    return {
        "turn": state.turn,
        "max_turns": state.max_turns,
        "you": {"player_index": player_id, "lineage": player.lineage,
                "founded": player.founded},
        "resources": {
            "energy": player.energy, "metal": player.metal,
            "compute_used": stats.compute_used(state, player_id),
            "compute_cap": stats.compute_cap(state, player_id),
            "upkeep_next": upkeep_next,
            "income_estimate": income,
        },
        "economy": {
            "workers": len(workers),
            "idle_workers": idle_workers,
            "builders": builders,
            "gathering": gathering,
            "carry_capacity": stats.carry_capacity(player),
            "dropoffs": dropoffs,
        },
        "research": research_view,
        "units": units,
        "buildings": buildings,
        "menus": {
            "build": _build_menu(state, player, bool(workers)),
            "units": _unit_menu(state, player),
            "techs": _tech_menu(state, player),
        },
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


def _gather_kind(state: State, pid: int, target) -> str | None:
    if not isinstance(target, list) or len(target) != 2:
        return None
    gx, gy = target
    if not state.in_bounds(gx, gy):
        return None
    terrain = state.tiles[gy][gx]
    if terrain in ("vein", "pod", "rubble"):
        return terrain
    if tk(gx, gy) in state.scrap:
        return "scrap"
    if any(e.type == "cocoon" and e.owner == pid and (e.x, e.y) == (gx, gy)
           for e in state.entities_sorted()):
        return "cocoon"
    return None


def _income_estimate(state: State, player) -> dict:
    """Gross per-turn gather rates of every worker with a gather order (what
    reaches the bank depends on drop-off distance)."""
    energy = 0
    metal = 0
    for w in state.units_of(player.id):
        if w.type != "worker" or not w.standing_order:
            continue
        if w.standing_order.get("type") != "gather":
            continue
        kind = _gather_kind(state, player.id, w.standing_order.get("target"))
        if kind == "vein":
            metal += stats.mine_rate(player)
        elif kind == "pod":
            energy += stats.pod_rate(player)
        elif kind == "cocoon":
            energy += stats.harvest_rate(player)
    return {"energy": energy, "metal": metal}


# ------------------------------------------------------------------- menus

def _build_menu(state: State, player, has_worker: bool) -> list[dict]:
    pid = player.id
    has_core = any(b.type == "core" for b in state.buildings_of(pid))
    out = []
    for btype in rules.BUILDABLE:
        spec = rules.BUILDINGS[btype]
        e, m = stats.building_cost(player, btype)
        why: str | None = None
        if not rules.firmware_at_least(player.firmware, spec.get("requires_fw")):
            why = f"requires firmware {spec['requires_fw']}"
        elif btype == "turret" and player.lineage == "parasite":
            why = "parasite cannot build turrets"
        elif btype == "core" and has_core and not rules.firmware_at_least(
                player.firmware, rules.EXTRA_CORE_REQUIRES_FW):
            why = f"a second core requires firmware {rules.EXTRA_CORE_REQUIRES_FW}"
        elif not has_worker:
            why = "no worker"
        elif player.energy < e or player.metal < m:
            why = f"costs {e}E/{m}M"
        entry = {"building": btype, "cost_e": e, "cost_m": m,
                 "work": stats.building_work(btype), "size": [spec["w"], spec["h"]],
                 "available": why is None, "why": why}
        if spec.get("dropoff"):
            entry["dropoff"] = True
        if btype == "core" and not has_core:
            entry["suggested_anchor"] = suggest_core_site(state, player)
        out.append(entry)
    return out


def _unit_menu(state: State, player) -> list[dict]:
    pid = player.id
    cap = stats.compute_cap(state, pid)
    used = stats.compute_used(state, pid)
    finished = {b.type for b in state.buildings_of(pid) if not b.build_progress}
    out = []
    for utype, spec in rules.UNITS.items():
        if spec["prod_at"] is None:
            continue
        if spec.get("lineage") and spec["lineage"] != player.lineage:
            continue
        e, m = stats.unit_cost(player, utype)
        count = 2 if spec.get("pair_produced") else 1
        why: str | None = None
        if not rules.firmware_at_least(player.firmware, spec["fw"]):
            why = f"requires firmware {spec['fw']}"
        elif spec["prod_at"] not in finished:
            why = f"needs a finished {spec['prod_at']}"
        elif used + spec["compute"] * count > cap:
            why = "not enough free compute (build racks)"
        elif player.energy < e or player.metal < m:
            why = f"costs {e}E/{m}M"
        out.append({"unit": utype, "at": spec["prod_at"], "cost_e": e, "cost_m": m,
                    "compute": spec["compute"] * count, "turns": spec["prod_turns"],
                    "available": why is None, "why": why})
    return out


def _tech_menu(state: State, player) -> list[dict]:
    pid = player.id
    finished = [b.type for b in state.buildings_of(pid) if not b.build_progress]
    racks = finished.count("rack")
    out = []
    for tech, spec in rules.TECHS.items():
        if tech in player.techs:
            continue
        why: str | None = None
        missing = [r for r in spec["requires"] if r not in player.techs]
        missing_b = [b for b in spec.get("requires_buildings", ()) if b not in finished]
        if missing:
            why = f"requires {', '.join(missing)}"
        elif spec["at"] not in finished:
            why = f"needs a finished {spec['at']}"
        elif missing_b:
            why = f"needs a finished {', '.join(missing_b)}"
        elif spec.get("requires_racks") and racks < spec["requires_racks"]:
            why = f"needs {spec['requires_racks']} standing racks"
        elif player.energy < spec["cost_e"] or player.metal < spec["cost_m"]:
            why = f"costs {spec['cost_e']}E/{spec['cost_m']}M"
        out.append({"tech": tech, "at": spec["at"], "cost_e": spec["cost_e"],
                    "cost_m": spec["cost_m"], "turns": spec["turns"],
                    "available": why is None, "why": why})
    return out


def suggest_core_site(state: State, player) -> list[int] | None:
    """Best explored, free 2x2 anchor near the crew: the ring around a core there
    touches as many pods/veins as possible (so gathering banks on the spot)."""
    workers = [u for u in state.units_of(player.id) if u.type == "worker"]
    if not workers:
        return None
    cx = sum(u.x for u in workers) // len(workers)
    cy = sum(u.y for u in workers) // len(workers)
    explored = set(player.explored)
    occ = state.occupancy()
    resources = [(x, y) for y in range(max(0, cy - 12), min(state.size, cy + 13))
                 for x in range(max(0, cx - 12), min(state.size, cx + 13))
                 if state.tiles[y][x] in ("pod", "vein")]
    best: tuple[int, int, int, int] | None = None
    for ay in range(max(0, cy - 6), min(state.size - 1, cy + 7)):
        for ax in range(max(0, cx - 6), min(state.size - 1, cx + 7)):
            fp = [(ax, ay), (ax + 1, ay), (ax, ay + 1), (ax + 1, ay + 1)]
            if any(state.tiles[y][x] != "plain" or (x, y) in occ or tk(x, y) in state.scrap
                   or pack(state.size, x, y) not in explored for x, y in fp):
                continue
            # Resources reachable from the ring (distance 2 from the footprint)
            # count double; the rest weigh by distance so the site stays central.
            near = 0
            far = 0
            for rx, ry in resources:
                d = min(max(abs(rx - fx), abs(ry - fy)) for fx, fy in fp)
                if d <= 2:
                    near += 2
                elif d <= 5:
                    far += 1
            walk = max(abs(ax - cx), abs(ay - cy))
            key = (-(near * 4 + far), walk, ax, ay)
            if best is None or key < best:
                best = key
    return [best[2], best[3]] if best else None


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

    # AoE2 rule: what is inside your units' vision is always fully identified
    # (id, type, position, hp) at every band - you can target what you can see.
    # Bands only degrade the strategic summary appended alongside.
    out = []
    for e in visible:
        entry = {"id": e.id, "owner": e.owner, "kind": e.kind, "type": e.type,
                 "x": e.x, "y": e.y, "hp": e.hp}
        if e.is_unit and e.heading:
            entry["heading"] = e.heading
        if e.is_unit and e.cargo:
            entry["carrying"] = e.cargo
        if e.build_progress:
            entry["under_construction"] = True
        out.append(entry)
    return out


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
