"""Phase 3 (research) and phase 4 (production, construction crews, colossus fusion).

Both phases decrement running jobs first and then start jobs ordered this turn,
so a 1-turn job ordered on turn T completes on turn T+1 (PLAN.md §3.14 traces).

Construction is the AoE2 model: a `build` order drops a foundation (and pays for
it) at once; every worker holding a `build` order on that site and standing
next to it adds work points each turn (up to MAX_BUILDERS_PER_SITE); the
foundation's hp grows with the work done; when it completes, the crew is
released to the obvious job (farm the cocoon it just built, gather next to the
new depot).
"""

from __future__ import annotations

from cero_engine import rules, stats
from cero_engine.state import Entity, State, tk

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
                if building.type == "core" and not building.build_progress:
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
    # 1. Advance running production and spawn finished units (rally points apply).
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
            unit = state.add_entity(Entity(id=state.new_id(), owner=b.owner, kind="unit",
                                           type=utype, x=x, y=y,
                                           hp=stats.unit_max_hp(player, utype)))
            if b.rally is not None:
                unit.standing_order = {"type": "move", "to": [b.rally[0], b.rally[1]]}
            ctx.emit(type="unit_trained", player=b.owner, unit=unit.id, unit_type=utype,
                     x=x, y=y, building=b.id)
            remaining -= 1
        if remaining <= 0:
            b.production = None
        else:
            b.production["remaining"] = remaining
            b.production["turns_left"] = 0

    # 2. Drop the foundations ordered this turn (cost paid here; the ordering
    #    worker becomes its first builder, other workers on the same anchor join).
    for pid in sorted(ctx.intakes):
        player = state.players[pid]
        occ = state.occupancy()
        placed_now: dict[tuple[str, int, int], int] = {}
        for worker_id, btype, ax, ay in ctx.intakes[pid].build:
            worker = state.ent(worker_id)
            if worker is None or worker.stiff:
                continue
            site_id = placed_now.get((btype, ax, ay))
            if site_id is not None:
                worker.standing_order = {"type": "build", "target_id": site_id}
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
            work = stats.building_work(btype)
            max_hp = stats.building_max_hp(player, btype)
            site = state.add_entity(Entity(id=state.new_id(), owner=pid, kind="building",
                                           type=btype, x=ax, y=ay,
                                           hp=max(1, max_hp * rules.SITE_MIN_HP_PCT // 100),
                                           build_progress=work, build_total=work))
            for t in site.footprint():
                occ[t] = site.id
            placed_now[(btype, ax, ay)] = site.id
            worker.standing_order = {"type": "build", "target_id": site.id}
            ctx.emit(type="site_placed", player=pid, building=btype, x=ax, y=ay, site=site.id)

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


def construction_phase(state: State, ctx) -> None:
    """Phase 9a (after movement, like gathering): every adjacent worker holding
    a build order on a site adds work; the foundation's hp grows with the work
    done; finished sites release their crew."""
    for site in state.entities_sorted():
        if not site.is_site or site.owner < 0:
            continue
        player = state.players[site.owner]
        if not player.alive:
            continue
        crew = [u for u in state.units_of(site.owner)
                if u.type == "worker" and not u.stiff and _builds(u, site) and _adjacent(u, site)]
        if not crew:
            continue
        rate = stats.build_rate(player)
        total = max(site.build_total, 1)
        max_hp = stats.building_max_hp(player, site.type)
        done_before = total - site.build_progress
        work = min(len(crew), rules.MAX_BUILDERS_PER_SITE) * rate
        site.build_progress = max(0, site.build_progress - work)
        done_after = total - site.build_progress
        hp_gain = max_hp * done_after // total - max_hp * done_before // total
        site.hp = min(max_hp, site.hp + hp_gain)
        if site.build_progress == 0:
            ctx.emit(type="built", player=site.owner, building=site.type,
                     x=site.x, y=site.y, id=site.id)
            if site.type == "core" and not player.founded:
                player.founded = True
                ctx.emit(type="core_founded", player=site.owner, x=site.x, y=site.y)
            _release_crew(state, site)


def _builds(unit, site) -> bool:
    so = unit.standing_order or {}
    return so.get("type") == "build" and so.get("target_id") == site.id


def _adjacent(unit, building) -> bool:
    return any(max(abs(unit.x - fx), abs(unit.y - fy)) <= 1 for fx, fy in building.footprint())


def _release_crew(state: State, site) -> None:
    """A finished site releases its crew to the obvious next job (AoE2: the
    villager who built the farm farms it; a mill's builders gather beside it)."""
    crew = [u for u in state.units_of(site.owner) if u.type == "worker" and _builds(u, site)]
    farmers = 0
    if site.type in rules.DROPOFF_TYPES:
        # Spread the crew over the resources around the new drop-off, alternating
        # energy and metal (a fresh city needs both), at most two per tile.
        radius = 4 if site.type == "core" else 3
        pods = _resources_near(state, site, radius, ("pod",))
        veins = _resources_near(state, site, radius, ("vein",))
        scrap = _resources_near(state, site, radius, ("scrap",))
        plan: list[tuple[int, int]] = []
        while (pods or veins or scrap) and len(plan) < 2 * len(crew):
            for pool in (pods, veins, scrap):
                if pool:
                    plan.append(pool.pop(0))
        slots = [t for t in plan for _ in range(2)]  # two workers per tile
        for i, u in enumerate(crew):
            if i < len(slots):
                u.standing_order = {"type": "gather", "target": [slots[i][0], slots[i][1]],
                                    "phase": "work"}
            else:
                u.standing_order = None
        return
    for u in crew:
        u.standing_order = None
        if site.type == "cocoon" and farmers < rules.MAX_WORKERS_PER_COCOON:
            u.standing_order = {"type": "gather", "target": [site.x, site.y], "phase": "work"}
            farmers += 1


def _resources_near(state: State, site, radius: int, kinds: tuple[str, ...]) -> list[tuple[int, int]]:
    """Resource tiles of the given kinds around a drop-off's footprint, nearest
    first (deterministic: distance, x, y)."""
    fp = site.footprint()
    found: list[tuple[int, int, int]] = []
    for y in range(max(0, site.y - radius), min(state.size, site.y + radius + 2)):
        for x in range(max(0, site.x - radius), min(state.size, site.x + radius + 2)):
            terrain = state.tiles[y][x]
            kind = "scrap" if tk(x, y) in state.scrap else terrain
            if kind not in kinds:
                continue
            d = min(max(abs(x - fx), abs(y - fy)) for fx, fy in fp)
            if d > radius:
                continue
            found.append((d, x, y))
    found.sort()
    return [(x, y) for _, x, y in found]


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
