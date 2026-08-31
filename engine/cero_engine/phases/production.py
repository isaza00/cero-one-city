"""Phase 3 (research) and phase 4 (production, construction, colossus fusion).

Both phases decrement running jobs first and then start jobs ordered this turn,
so a 1-turn job ordered on turn T completes on turn T+1 (PLAN.md §3.14 traces).
"""

from __future__ import annotations

from cero_engine import rules, stats
from cero_engine.state import Entity, State

NEIGHBOR_ORDER = ((0, -1), (1, 0), (0, 1), (-1, 0), (1, -1), (1, 1), (-1, 1), (-1, -1))


def research_phase(state: State, ctx) -> None:
    # 1. Advance running research.
    for b in state.entities_sorted():
        if not b.is_building or b.research is None or b.owner < 0:
            continue
        player = state.players[b.owner]
        if not player.alive:
            b.research = None
            continue
        b.research["turns_left"] -= 1
        if b.research["turns_left"] > 0:
            continue
        tech = b.research["tech"]
        b.research = None
        if tech in player.techs:
            continue
        player.techs = sorted(player.techs + [tech])
        if tech == "firmware_v2":
            player.firmware = "v2"
            ctx.emit(type="firmware", player=player.id, firmware="v2")
        elif tech == "firmware_v3":
            player.firmware = "v3"
            ctx.emit(type="firmware", player=player.id, firmware="v3")
        else:
            ctx.emit(type="tech_done", player=player.id, tech=tech)
        if tech == "reinforced_core":
            for building in state.buildings_of(player.id):
                if building.type == "core":
                    building.hp += rules.REINFORCED_CORE_HP
                elif building.type == "turret" and not building.build_progress:
                    building.hp += rules.REINFORCED_TURRET_HP

    # 2. Start research ordered this turn.
    for pid in sorted(ctx.intakes):
        player = state.players[pid]
        free = stats.compute_cap(state, pid) - stats.compute_used(state, pid)
        for bid, tech in ctx.intakes[pid].research:
            b = state.ent(bid)
            if b is None or b.research or b.production or tech in player.techs:
                continue
            spec = rules.TECHS[tech]
            if player.energy < spec["cost_e"] or player.metal < spec["cost_m"]:
                ctx.errors[pid].append({"actor_id": bid, "type": "research", "code": "no_resources",
                                        "message": f"{tech} costs {spec['cost_e']}E/{spec['cost_m']}M"})
                continue
            player.energy -= spec["cost_e"]
            player.metal -= spec["cost_m"]
            b.research = {"tech": tech, "turns_left": stats.research_turns(tech, free)}


def production_phase(state: State, ctx) -> None:
    # 1. Advance running production and spawn finished units.
    for b in state.entities_sorted():
        if not b.is_building or b.production is None or b.owner < 0:
            continue
        player = state.players[b.owner]
        if not player.alive:
            b.production = None
            continue
        if b.production["turns_left"] > 0:
            b.production["turns_left"] -= 1
        if b.production["turns_left"] > 0:
            continue
        utype = b.production["unit"]
        remaining = b.production.get("remaining", 1)
        cap = stats.compute_cap(state, b.owner)
        while remaining > 0:
            if stats.compute_used(state, b.owner) + rules.UNITS[utype]["compute"] > cap:
                break  # over the compute cap: hold until capacity frees up
            spot = _spawn_tile(state, b)
            if spot is None:
                break  # no free adjacent tile: hold until one frees up
            x, y = spot
            state.add_entity(Entity(id=state.new_id(), owner=b.owner, kind="unit", type=utype,
                                    x=x, y=y, hp=stats.unit_max_hp(player, utype)))
            remaining -= 1
        if remaining <= 0:
            b.production = None
        else:
            b.production["remaining"] = remaining
            b.production["turns_left"] = 0

    # 2. Advance construction sites (the bound worker must stay adjacent).
    for site in state.entities_sorted():
        if not site.is_building or not site.build_progress or site.owner < 0:
            continue
        builder = state.ent(site.builder_id) if site.builder_id is not None else None
        if (builder is None or builder.type != "worker" or builder.stiff
                or not _adjacent(builder, site)):
            continue  # construction paused
        site.build_progress -= 1
        if site.build_progress == 0:
            site.builder_id = None
            ctx.emit(type="built", player=site.owner, building=site.type,
                     x=site.x, y=site.y)

    # 3. Complete colossus fusion (ordered last turn, immobile for one turn).
    for lead in state.entities_sorted():
        if not lead.is_unit or lead.fusing is None:
            continue
        lead.fusing["turns_left"] -= 1
        if lead.fusing["turns_left"] > 0:
            continue
        ids = lead.fusing["unit_ids"]
        units = [state.ent(i) for i in ids]
        alive = [u for u in units if u is not None and u.hp > 0]
        if len(alive) < rules.COLOSSUS_FUSE_COUNT:
            for u in alive:  # fusion broken by casualties: release survivors
                u.standing_order = None
                u.fusing = None
            continue
        player = state.players[lead.owner]
        x, y = lead.x, lead.y
        owner = lead.owner
        for u in alive:
            state.remove_entity(u.id)
        colossus = state.add_entity(Entity(id=state.new_id(), owner=owner, kind="unit",
                                           type="colossus", x=x, y=y,
                                           hp=stats.unit_max_hp(player, "colossus")))
        ctx.emit(type="colossus_fused", player=owner, unit=colossus.id, x=x, y=y)

    # 4. Start production ordered this turn (cost is paid here).
    for pid in sorted(ctx.intakes):
        player = state.players[pid]
        for bid, utype in ctx.intakes[pid].produce:
            b = state.ent(bid)
            if b is None or b.production or b.research or b.build_progress:
                continue
            count = 2 if rules.UNITS[utype].get("pair_produced") else 1
            cap = stats.compute_cap(state, pid)
            used = stats.compute_used(state, pid)
            if used + rules.UNITS[utype]["compute"] * count > cap:
                ctx.errors[pid].append({"actor_id": bid, "type": "produce", "code": "no_compute",
                                        "message": "not enough free compute (build racks)"})
                continue
            cost_e, cost_m = stats.unit_cost(player, utype)
            if player.energy < cost_e or player.metal < cost_m:
                ctx.errors[pid].append({"actor_id": bid, "type": "produce", "code": "no_resources",
                                        "message": f"{utype} costs {cost_e}E/{cost_m}M"})
                continue
            player.energy -= cost_e
            player.metal -= cost_m
            free = cap - used
            b.production = {"unit": utype,
                            "turns_left": stats.production_turns(player, utype, free)}
            if count > 1:
                b.production["remaining"] = count

    # 5. Start construction sites ordered this turn (cost is paid here).
    for pid in sorted(ctx.intakes):
        player = state.players[pid]
        occ = state.occupancy()
        for worker_id, btype, ax, ay in ctx.intakes[pid].build:
            worker = state.ent(worker_id)
            if worker is None or worker.stiff:
                continue
            spec = rules.BUILDINGS[btype]
            tiles = [(ax + dx, ay + dy) for dy in range(spec["h"]) for dx in range(spec["w"])]
            if any(not state.in_bounds(x, y) or state.tiles[y][x] != "plain" or (x, y) in occ
                   for x, y in tiles):
                ctx.errors[pid].append({"actor_id": worker_id, "type": "build", "code": "bad_site",
                                        "message": "site became blocked"})
                continue
            cost_e, cost_m = stats.building_cost(player, btype)
            if player.energy < cost_e or player.metal < cost_m:
                ctx.errors[pid].append({"actor_id": worker_id, "type": "build",
                                        "code": "no_resources",
                                        "message": f"{btype} costs {cost_e}E/{cost_m}M"})
                continue
            player.energy -= cost_e
            player.metal -= cost_m
            site = state.add_entity(Entity(id=state.new_id(), owner=pid, kind="building",
                                           type=btype, x=ax, y=ay,
                                           hp=stats.building_max_hp(player, btype),
                                           build_progress=stats.build_turns(player, btype),
                                           builder_id=worker_id))
            for t in site.footprint():
                occ[t] = site.id


def _adjacent(unit, building) -> bool:
    return any(max(abs(unit.x - fx), abs(unit.y - fy)) <= 1 for fx, fy in building.footprint())


def _spawn_tile(state: State, building) -> tuple[int, int] | None:
    """First free plain tile adjacent to the footprint, canonical neighbor order."""
    occ = state.occupancy()
    for fx, fy in building.footprint():
        for dx, dy in NEIGHBOR_ORDER:
            x, y = fx + dx, fy + dy
            if not state.in_bounds(x, y) or (x, y) in occ:
                continue
            if state.tiles[y][x] != "plain":
                continue
            return x, y
    return None
