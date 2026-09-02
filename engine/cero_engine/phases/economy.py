"""Phase 1 (maintenance/upkeep) and phase 9 (gathering, drop-offs, repair).

The AoE2 gather cycle, at turn scale: a worker next to its resource fills its
cargo; whenever a loaded worker stands next to one of its own finished
drop-offs (core or depot) the cargo is banked on the spot; a full worker with
no drop-off in reach walks home (`phase: "return"`, movement phase), banks, and
walks back. A worker parked between a depot and a vein therefore banks every
turn - exactly the "mining camp next to the gold" efficiency of AoE2.
"""

from __future__ import annotations

from cero_engine import rules, stats
from cero_engine.state import State, tk, untk
from cero_engine.stats import building_max_hp


def maintenance_phase(state: State, ctx) -> None:
    # Cocoon accumulators charge passively (they only matter when the cocoon dies).
    for e in state.entities_sorted():
        if e.type == "cocoon" and not e.build_progress:
            player = state.players[e.owner] if e.owner >= 0 else None
            battery = player is not None and "cocoon_battery" in player.techs
            rate = rules.COCOON_ACCUM_PER_TURN_BATTERY if battery else rules.COCOON_ACCUM_PER_TURN
            cap = rules.COCOON_ACCUM_MAX_BATTERY if battery else rules.COCOON_ACCUM_MAX
            if player is not None and player.lineage == "photon":
                rate += rules.PHOTON_ACCUM_BONUS
            e.accumulator = min(e.accumulator + rate, cap)

    # Units of players eliminated on a previous turn power down into scrap now.
    for e in state.entities_sorted():
        if e.is_unit and e.owner >= 0 and not state.players[e.owner].alive:
            _drop_unit_scrap(state, e)
            state.remove_entity(e.id)

    # Upkeep: 1 energy per unit, paid in ascending id order; unpaid units go stiff.
    blackout: dict[int, int] = {}
    for player in state.players:
        if not player.alive:
            continue
        for unit in state.units_of(player.id):
            unit.stiff = False
            if unit.type in rules.UPKEEP_EXEMPT:
                continue
            if player.energy >= rules.UPKEEP_PER_UNIT:
                player.energy -= rules.UPKEEP_PER_UNIT
            else:
                unit.stiff = True
                blackout[player.id] = blackout.get(player.id, 0) + 1
    for pid, count in sorted(blackout.items()):
        ctx.emit(type="blackout", player=pid, units=count)


def _drop_unit_scrap(state: State, unit) -> None:
    if unit.type == "colossus":
        metal = rules.COLOSSUS_SCRAP
    else:
        metal = max(rules.UNITS[unit.type]["cost_m"] * rules.SCRAP_FROM_UNIT_PCT // 100,
                    rules.SCRAP_FROM_UNIT_MIN)
    key = tk(unit.x, unit.y)
    pile = state.scrap.setdefault(key, {"e": 0, "m": 0})
    pile["m"] += metal + unit.cargo_m   # a loaded worker spills its cargo too
    pile["e"] += unit.cargo_e


def near_dropoff(worker, dropoff_tiles: list[tuple[int, int]]) -> bool:
    return any(max(abs(worker.x - fx), abs(worker.y - fy)) <= 1 for fx, fy in dropoff_tiles)


def deposit(state: State, ctx, player, worker) -> None:
    """Bank the worker's cargo (emits a `deposit` event for the renderer)."""
    e, m = worker.cargo_e, worker.cargo_m
    if not e and not m:
        return
    player.energy += e
    player.metal += m
    worker.cargo_e = 0
    worker.cargo_m = 0
    ctx.emit(type="deposit", player=player.id, unit=worker.id, x=worker.x, y=worker.y,
             energy=e, metal=m)


def gathering_phase(state: State, ctx) -> None:
    for player in state.players:
        if not player.alive:
            continue
        mine_rate = stats.mine_rate(player)
        harvest = stats.harvest_rate(player)
        pod_rate = stats.pod_rate(player)
        repair_rate = (rules.REPAIR_HP_SERVOS if "cargo_servos" in player.techs
                       else rules.REPAIR_HP)
        capacity = stats.carry_capacity(player)
        dropoff_tiles = [t for b in state.dropoffs_of(player.id) for t in b.footprint()]
        cocoon_workers: dict[int, int] = {}  # cocoon id -> workers harvesting this turn

        for worker in state.units_of(player.id):
            if worker.type != "worker" or worker.stiff:
                continue
            order = worker.standing_order
            at_drop = near_dropoff(worker, dropoff_tiles)

            # Banking happens whenever a loaded worker stands next to a drop-off,
            # whatever it is doing (a builder walking past its core banks too).
            if worker.cargo and at_drop:
                deposit(state, ctx, player, worker)
                if order and order.get("type") == "gather" and order.get("phase") == "return":
                    order["phase"] = "work"   # home: walk back to the resource next turn

            if not order:
                continue

            if order["type"] == "repair":
                target = state.ent(order["target_id"])
                if target is None or not target.is_building or target.owner != player.id:
                    worker.standing_order = None
                    continue
                if not _adjacent_to_footprint(worker, target):
                    continue  # still travelling
                max_hp = building_max_hp(player, target.type)
                if target.hp >= max_hp:
                    worker.standing_order = None
                    continue
                if player.metal < rules.REPAIR_METAL_COST:
                    continue
                player.metal -= rules.REPAIR_METAL_COST
                target.hp = min(target.hp + repair_rate, max_hp)
                continue

            if order["type"] != "gather":
                continue
            if order.get("phase") == "return":
                continue  # walking a full load home (movement phase)

            gx, gy = order["target"]
            if max(abs(worker.x - gx), abs(worker.y - gy)) > 1:
                continue  # still travelling (movement phase walks them in)
            room = capacity - worker.cargo
            if room <= 0:
                order["phase"] = "return"
                continue

            key = tk(gx, gy)
            terrain = state.tiles[gy][gx]

            # Scrap piles (unit scrap or elimination ruins): metal first, then energy.
            if key in state.scrap:
                pile = state.scrap[key]
                budget = rules.SCRAP_COLLECT_RATE
                if player.lineage == "parasite":
                    budget = budget * (100 + rules.PARASITE_SCRAP_BONUS_PCT) // 100
                budget = min(budget, room)
                take_m = min(pile["m"], budget)
                pile["m"] -= take_m
                worker.cargo_m += take_m
                budget -= take_m
                take_e = min(pile["e"], budget)
                pile["e"] -= take_e
                worker.cargo_e += take_e
                if pile["m"] <= 0 and pile["e"] <= 0:
                    del state.scrap[key]
                    _retarget(state, worker, order, "scrap", gx, gy, cocoon_workers)
            elif terrain == "vein":
                remaining = state.veins.get(key, 0)
                take = min(remaining, mine_rate, room)
                worker.cargo_m += take
                remaining -= take
                if remaining <= 0:
                    state.veins.pop(key, None)
                    state.tiles[gy][gx] = "plain"
                    ctx.emit(type="vein_depleted", x=gx, y=gy)
                    _retarget(state, worker, order, "vein", gx, gy, cocoon_workers)
                else:
                    state.veins[key] = remaining
            elif terrain == "pod":
                remaining = state.pods.get(key, 0)
                take = min(remaining, pod_rate, room)
                worker.cargo_e += take
                remaining -= take
                if remaining <= 0:
                    state.pods.pop(key, None)
                    state.tiles[gy][gx] = "plain"
                    ctx.emit(type="pod_depleted", x=gx, y=gy)
                    _retarget(state, worker, order, "pod", gx, gy, cocoon_workers)
                else:
                    state.pods[key] = remaining
            elif terrain == "rubble":
                order["progress"] = order.get("progress", 0) + 1
                if order["progress"] >= rules.RUBBLE_CLEAR_TURNS:
                    state.tiles[gy][gx] = "plain"
                    worker.cargo_m += rules.RUBBLE_METAL
                    ctx.emit(type="rubble_cleared", player=player.id, x=gx, y=gy)
                    worker.standing_order = None
            else:
                # Harvesting an own finished cocoon on that tile (max 2 workers each).
                cocoon = next((e for e in state.entities_sorted()
                               if e.type == "cocoon" and e.owner == player.id
                               and not e.build_progress and (e.x, e.y) == (gx, gy)), None)
                if cocoon is None:
                    worker.standing_order = None  # nothing to gather there
                    continue
                used = cocoon_workers.get(cocoon.id, 0)
                if used >= rules.MAX_WORKERS_PER_COCOON:
                    _retarget(state, worker, order, "cocoon", gx, gy, cocoon_workers)
                    continue
                cocoon_workers[cocoon.id] = used + 1
                worker.cargo_e += min(harvest, room)

            # Camped next to a drop-off: bank every turn. Otherwise walk home when full.
            if worker.cargo and at_drop:
                deposit(state, ctx, player, worker)
            elif worker.cargo >= capacity and worker.standing_order is order:
                order["phase"] = "return"


def _retarget(state: State, worker, order: dict, kind: str, fx: int, fy: int,
              cocoon_workers: dict[int, int]) -> None:
    """The AoE2 villager reflex: when a tile runs dry, step to the nearest tile
    of the same kind within AUTO_RETARGET_RADIUS (deterministic: distance, x, y);
    otherwise stand idle so the owner notices."""
    r = rules.AUTO_RETARGET_RADIUS
    best: tuple[int, int, int] | None = None
    for y in range(max(0, fy - r), min(state.size, fy + r + 1)):
        for x in range(max(0, fx - r), min(state.size, fx + r + 1)):
            if (x, y) == (fx, fy):
                continue
            ok = False
            if kind == "vein":
                ok = state.tiles[y][x] == "vein"
            elif kind == "pod":
                ok = state.tiles[y][x] == "pod"
            elif kind == "scrap":
                ok = tk(x, y) in state.scrap
            elif kind == "cocoon":
                cocoon = next((e for e in state.entities_sorted()
                               if e.type == "cocoon" and e.owner == worker.owner
                               and not e.build_progress and (e.x, e.y) == (x, y)), None)
                ok = (cocoon is not None
                      and cocoon_workers.get(cocoon.id, 0) < rules.MAX_WORKERS_PER_COCOON)
            if not ok:
                continue
            key = (max(abs(x - fx), abs(y - fy)), x, y)
            if best is None or key < best:
                best = key
    if best is None:
        worker.standing_order = None
        return
    order["target"] = [best[1], best[2]]
    order["phase"] = "work"
    order.pop("progress", None)


def _adjacent_to_footprint(unit, building) -> bool:
    return any(max(abs(unit.x - fx), abs(unit.y - fy)) <= 1 for fx, fy in building.footprint())


def ruin_building(state: State, building) -> None:
    """Turn a building into a lootable ruin pile at its anchor tile (elimination)."""
    e_val = rules.BUILDINGS[building.type]["cost_e"] * rules.RUIN_ENERGY_PCT // 100
    m_val = rules.BUILDINGS[building.type]["cost_m"] * rules.RUIN_METAL_PCT // 100
    if e_val or m_val:
        pile = state.scrap.setdefault(tk(building.x, building.y), {"e": 0, "m": 0})
        pile["e"] += e_val
        pile["m"] += m_val


def collect_key(state: State, x: int, y: int) -> str:
    return tk(x, y)


__all__ = ["maintenance_phase", "gathering_phase", "ruin_building", "untk",
           "near_dropoff", "deposit"]
