"""Phase 1 (maintenance/upkeep) and phase 9 (gathering/repair)."""

from __future__ import annotations

from cero_engine import rules
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
    pile["m"] += metal


def gathering_phase(state: State, ctx) -> None:
    cocoon_workers: dict[int, int] = {}  # cocoon id -> workers already harvesting this turn

    for player in state.players:
        if not player.alive:
            continue
        mine_rate = rules.MINE_METAL_FAST if "fast_mining" in player.techs else rules.MINE_METAL
        harvest_rate = (rules.HARVEST_ENERGY_RICH if "rich_harvest" in player.techs
                        else rules.HARVEST_ENERGY)
        repair_rate = (rules.REPAIR_HP_SERVOS if "cargo_servos" in player.techs
                       else rules.REPAIR_HP)

        for worker in state.units_of(player.id):
            if worker.type != "worker" or worker.stiff or not worker.standing_order:
                continue
            order = worker.standing_order

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
            gx, gy = order["target"]
            key = tk(gx, gy)
            dist = max(abs(worker.x - gx), abs(worker.y - gy))
            if dist > 1:
                continue  # still travelling (movement phase walks them in)

            # Scrap piles (unit scrap or elimination ruins): metal first, then energy.
            if key in state.scrap:
                pile = state.scrap[key]
                budget = rules.SCRAP_COLLECT_RATE
                if player.lineage == "parasite":
                    budget = budget * (100 + rules.PARASITE_SCRAP_BONUS_PCT) // 100
                take_m = min(pile["m"], budget)
                pile["m"] -= take_m
                player.metal += take_m
                budget -= take_m
                take_e = min(pile["e"], budget)
                pile["e"] -= take_e
                player.energy += take_e
                if pile["m"] <= 0 and pile["e"] <= 0:
                    del state.scrap[key]
                    worker.standing_order = None
                continue

            terrain = state.tiles[gy][gx]
            if terrain == "vein":
                remaining = state.veins.get(key, 0)
                take = min(remaining, mine_rate)
                player.metal += take
                remaining -= take
                if remaining <= 0:
                    state.veins.pop(key, None)
                    state.tiles[gy][gx] = "plain"
                    ctx.emit(type="vein_depleted", x=gx, y=gy)
                    worker.standing_order = None
                else:
                    state.veins[key] = remaining
                continue

            if terrain == "rubble":
                order["progress"] = order.get("progress", 0) + 1
                if order["progress"] >= rules.RUBBLE_CLEAR_TURNS:
                    state.tiles[gy][gx] = "plain"
                    player.metal += rules.RUBBLE_METAL
                    ctx.emit(type="rubble_cleared", player=player.id, x=gx, y=gy)
                    worker.standing_order = None
                continue

            # Harvesting an own finished cocoon on that tile (max 2 workers each).
            cocoon = next((e for e in state.entities_sorted()
                           if e.type == "cocoon" and e.owner == player.id
                           and not e.build_progress and (e.x, e.y) == (gx, gy)), None)
            if cocoon is not None:
                used = cocoon_workers.get(cocoon.id, 0)
                if used >= rules.MAX_WORKERS_PER_COCOON:
                    continue
                cocoon_workers[cocoon.id] = used + 1
                player.energy += harvest_rate
                continue

            worker.standing_order = None  # nothing to gather there


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


__all__ = ["maintenance_phase", "gathering_phase", "ruin_building", "untk"]
