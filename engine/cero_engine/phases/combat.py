"""Phase 6 (simultaneous combat) and phase 7 (destruction chain).

All damage is computed from the pre-phase state and applied at once; kill credit
follows attack application order (ascending attacker id). Racks cascade, cocoons
burst, the core has a per-turn damage cap, and eliminated players' buildings
become lootable ruins at closing.
"""

from __future__ import annotations

from cero_engine import rules
from cero_engine.fog import entity_visible_to, visible_tiles
from cero_engine.orders import has_truce
from cero_engine.state import Entity, State, tk
from cero_engine.stats import (
    is_combat_unit,
    turret_attack,
    turret_range,
    unit_armor,
    unit_attack,
    unit_range,
)


def combat_phase(state: State, ctx) -> None:
    attacks: list[tuple[int, Entity, Entity, int]] = []  # (attacker_id, attacker, target, dmg)
    vision_cache: dict[int, set] = {}

    def vision_of(pid: int) -> set:
        if pid not in vision_cache:
            vision_cache[pid] = visible_tiles(state, pid)
        return vision_cache[pid]

    # Unit attacks (standing attack orders whose target is in range after movement).
    for unit in state.entities_sorted():
        if not unit.is_unit or unit.stiff or unit.owner < 0:
            continue
        order = unit.standing_order or {}
        if order.get("type") != "attack":
            # AoE2-style stance: a military unit not committed to a target
            # automatically engages the nearest enemy inside its weapon range.
            target = _auto_target(state, unit, vision_of)
            if target is not None:
                dmg = _unit_damage(state, unit, target)
                if dmg > 0:
                    attacks.append((unit.id, unit, target, dmg))
                    if unit.type == "human":
                        unit.revealed_until = state.turn + 1
            continue
        target = state.ent(order.get("target_id", -1))
        if target is None or target.hp <= 0:
            unit.standing_order = None
            continue
        if target.owner >= 0 and has_truce(state, unit.owner, target.owner):
            continue
        player = state.players[unit.owner]
        rng = unit_range(player, unit.type)
        if not _in_range(unit, target, rng):
            continue
        dmg = _unit_damage(state, unit, target)
        if dmg <= 0:
            continue
        attacks.append((unit.id, unit, target, dmg))
        if unit.type == "human":
            unit.revealed_until = state.turn + 1

    # Camp guard attacks (neutral AI).
    for guard in state.entities_sorted():
        if not guard.is_unit or guard.owner >= 0 or guard.type != "human":
            continue
        target = _guard_target(state, guard)
        if target is None:
            continue
        dmg = _raw_damage(rules.UNITS["human"]["atk"], 0, target, ranged=True)
        attacks.append((guard.id, guard, target, dmg))

    # Turret auto-fire: nearest visible enemy unit, else nearest enemy building.
    for turret in state.entities_sorted():
        if turret.type != "turret" or turret.build_progress or turret.owner < 0:
            continue
        player = state.players[turret.owner]
        rng = turret_range(player)
        candidates: list[tuple[int, int, Entity]] = []
        for e in state.entities_sorted():
            if e.owner == turret.owner or e.hp <= 0:
                continue
            if e.owner >= 0 and has_truce(state, turret.owner, e.owner):
                continue
            if e.owner < 0 and e.type == "camp":
                continue  # turrets do not pick fights with neutral camps
            if e.type in ("wall", "survivor"):
                continue  # a turret never wastes shots on a palisade or a stray human
            if not _in_range(turret, e, rng):
                continue
            if e.is_unit and not entity_visible_to(state, e, turret.owner,
                                                   vision_of(turret.owner)):
                continue
            dist = min(max(abs(fx - turret.x), abs(fy - turret.y)) for fx, fy in e.footprint())
            candidates.append((0 if e.is_unit else 1, dist, e))
        if not candidates:
            continue
        candidates.sort(key=lambda c: (c[0], c[1], c[2].id))
        target = candidates[0][2]
        dmg = _raw_damage(turret_attack(player), 0, target, ranged=True)
        attacks.append((turret.id, turret, target, dmg))

    _apply_attacks(state, ctx, attacks)


def _auto_target(state: State, unit: Entity, vision_of) -> Entity | None:
    """Nearest visible enemy within weapon range (units before buildings,
    then distance, then id - deterministic). Workers never auto-engage."""
    if not is_combat_unit(unit.type):
        return None
    if (unit.standing_order or {}).get("type") == "fusing":
        return None
    player = state.players[unit.owner]
    rng = unit_range(player, unit.type)
    best: tuple[int, int, int] | None = None
    best_target: Entity | None = None
    for e in state.entities_sorted():
        if e.owner == unit.owner or e.hp <= 0 or e.id == unit.id:
            continue
        if e.owner < 0:
            continue  # stances never pick fights with neutral camps
        if has_truce(state, unit.owner, e.owner):
            continue
        if e.type == "wall":
            continue  # walls only fall to explicit attack orders
        if not _in_range(unit, e, rng):
            continue
        if e.is_unit and not entity_visible_to(state, e, unit.owner,
                                               vision_of(unit.owner)):
            continue
        dist = min(max(abs(fx - unit.x), abs(fy - unit.y)) for fx, fy in e.footprint())
        key = (0 if e.is_unit else 1, dist, e.id)
        if best is None or key < best:
            best, best_target = key, e
    return best_target


def _guard_target(state: State, guard: Entity) -> Entity | None:
    home = tuple(guard.camp_home) if guard.camp_home else (guard.x, guard.y)
    camp = next((e for e in state.entities_sorted()
                 if e.type == "camp" and (e.x, e.y) == home), None)
    hostile = set(camp.camp_hostile_to) if camp else set(guard.camp_hostile_to)
    if not hostile:
        return None
    rng = rules.UNITS["human"]["range"]
    best: Entity | None = None
    best_d = None
    for e in state.entities_sorted():
        if not e.is_unit or e.owner not in hostile or e.hp <= 0:
            continue
        d = max(abs(e.x - guard.x), abs(e.y - guard.y))
        if d <= rng and (best_d is None or d < best_d):
            best, best_d = e, d
    return best


def _in_range(attacker: Entity, target: Entity, rng: int) -> bool:
    ax_tiles = attacker.footprint()
    for fx, fy in target.footprint():
        for ax, ay in ax_tiles:
            if max(abs(fx - ax), abs(fy - ay)) <= rng:
                return True
    return False


def _unit_damage(state: State, unit: Entity, target: Entity) -> int:
    player = state.players[unit.owner]
    spec = rules.UNITS[unit.type]
    atk = unit_attack(player, unit.type)
    bonus = spec["bonus"] if (target.is_unit and target.type in spec["bonus_vs"]) else 0
    if target.is_building and spec.get("building_bonus"):
        bonus += spec["building_bonus"]
    rng = unit_range(player, unit.type)
    is_ranged = rng > 1

    if target.is_unit and target.owner >= 0:
        armor = unit_armor(state.players[target.owner], target.type)
    elif target.is_unit:
        armor = rules.UNITS[target.type]["armor"]
    else:
        armor = 0

    # Anti-air rules: only AA attackers hit fliers; melee ground with anti_air at 50%.
    scale_pct = 100
    if target.is_unit and target.is_air:
        if spec.get("aa"):
            pass
        elif not unit.is_air and not is_ranged and "anti_air" in player.techs:
            scale_pct = rules.ANTI_AIR_MELEE_PCT
        else:
            return 0

    dmg = max(atk + bonus - armor, 1)
    if target.is_building and is_ranged and not spec.get("full_building_damage"):
        dmg = max(dmg // 2, 1)
    dmg = max(dmg * scale_pct // 100, 1)
    return dmg


def _raw_damage(atk: int, armor: int, target: Entity, ranged: bool) -> int:
    dmg = max(atk - armor, 1)
    if target.is_building and ranged:
        dmg = max(dmg // 2, 1)
    return dmg


def _apply_attacks(state: State, ctx, attacks: list) -> None:
    attacks.sort(key=lambda a: a[0])
    for _, attacker, target, dmg in attacks:
        if state.ent(target.id) is None:
            continue
        applied = _apply_damage(state, ctx, target, dmg,
                                attacker.owner if attacker.owner >= 0 else None)
        if (attacker.owner is not None and attacker.owner >= 0 and target.owner >= 0
                and target.owner != attacker.owner):
            state.players[attacker.owner].damage_dealt += applied
        # One event per landed hit so the renderer can draw the shot, the
        # impact, and the kill exactly where they happened.
        ranged = (attacker.is_building
                  or rules.UNITS[attacker.type]["range"] > 1)
        ctx.emit(type="attack", attacker=attacker.id, attacker_type=attacker.type,
                 owner=attacker.owner, target=target.id, target_type=target.type,
                 target_owner=target.owner, src=[attacker.x, attacker.y],
                 dst=[target.x, target.y], dmg=applied, ranged=ranged,
                 kill=target.hp <= 0)


def _apply_damage(state: State, ctx, target: Entity, dmg: int,
                  credit_player: int | None) -> int:
    """Apply damage respecting the core cap; record kill credit. Returns applied dmg."""
    if target.type == "core":
        already = ctx.core_damage.get(target.id, 0)
        dmg = min(dmg, rules.CORE_DAMAGE_CAP_PER_TURN - already)
        if dmg <= 0:
            return 0
        ctx.core_damage[target.id] = already + dmg
    was_alive = target.hp > 0
    target.hp -= dmg
    if was_alive and target.hp <= 0 and target.id not in ctx.kill_credit:
        ctx.kill_credit[target.id] = credit_player
    return dmg


def destruction_phase(state: State, ctx) -> None:
    while True:
        dead = [e for e in state.entities_sorted() if e.hp <= 0]
        if not dead:
            break
        e = dead[0]  # ascending id: entities_sorted is id-ordered
        _process_death(state, ctx, e)

    # Core visual stage transitions (cracks / fire) for the feed.
    for core in state.entities_sorted():
        if core.type != "core":
            continue
        before = ctx.core_hp_before.get(core.id, core.hp)
        if before > rules.CORE_STAGE_CRACKS_HP >= core.hp > rules.CORE_STAGE_FIRE_HP:
            ctx.emit(type="core_stage", player=core.owner, stage="cracks")
        elif before > rules.CORE_STAGE_FIRE_HP >= core.hp > 0:
            ctx.emit(type="core_stage", player=core.owner, stage="fire")


def _process_death(state: State, ctx, e: Entity) -> None:
    credit = ctx.kill_credit.get(e.id)

    if e.is_unit:
        if e.type == "colossus":
            metal = rules.COLOSSUS_SCRAP
        else:
            metal = max(rules.UNITS[e.type]["cost_m"] * rules.SCRAP_FROM_UNIT_PCT // 100,
                        rules.SCRAP_FROM_UNIT_MIN)
        pile = state.scrap.setdefault(tk(e.x, e.y), {"e": 0, "m": 0})
        pile["m"] += metal + e.cargo_m
        pile["e"] += e.cargo_e
        state.remove_entity(e.id)
        if e.cargo_h:
            from cero_engine.phases.economy import drop_human
            drop_human(state, e)
        ctx.emit(type="unit_killed", unit=e.id, unit_type=e.type, owner=e.owner,
                 by=credit, x=e.x, y=e.y)
        return

    # Buildings ------------------------------------------------------------
    footprint = e.footprint()
    state.remove_entity(e.id)

    if e.type == "camp":
        if credit is not None:
            player = state.players[credit]
            player.energy += rules.CAMP_LOOT_ENERGY
            player.metal += rules.CAMP_LOOT_METAL
            for guard in state.entities_sorted():
                if (guard.is_unit and guard.owner < 0 and guard.camp_home
                        and tuple(guard.camp_home) == (e.x, e.y)):
                    guard.camp_hostile_to = [credit]
            ctx.emit(type="camp_looted", by=credit, x=e.x, y=e.y,
                     energy=rules.CAMP_LOOT_ENERGY, metal=rules.CAMP_LOOT_METAL)
        return

    if e.type == "core":
        # Elimination is decided at closing: a city dies with its LAST core
        # (a second core, AoE2 Castle Age style, keeps the player alive).
        if credit is not None and credit != e.owner:
            state.players[credit].core_kills += 1
        ctx.emit(type="core_destroyed", player=e.owner, by=credit, x=e.x, y=e.y,
                 site=bool(e.build_progress))
        for x, y in footprint:
            state.tiles[y][x] = "rubble"
        return

    if e.type == "rack":
        ctx.emit(type="rack_destroyed", owner=e.owner, x=e.x, y=e.y, by=credit)
        for other in state.entities_sorted():
            if other.id == e.id or other.hp <= 0:
                continue
            if any(max(abs(fx - e.x), abs(fy - e.y)) <= 1 for fx, fy in other.footprint()):
                _apply_damage(state, ctx, other, rules.RACK_CASCADE_DAMAGE,
                              e.owner if e.owner >= 0 else None)
        ctx.emit(type="rack_cascade", x=e.x, y=e.y)
    elif e.type == "cocoon":
        burst = e.accumulator // 4
        if burst > 0:
            ctx.emit(type="cocoon_burst", owner=e.owner, x=e.x, y=e.y, damage=burst)
            for other in state.entities_sorted():
                if other.id == e.id or other.hp <= 0:
                    continue
                if max(abs(other.x - e.x), abs(other.y - e.y)) <= 1 or any(
                        max(abs(fx - e.x), abs(fy - e.y)) <= 1 for fx, fy in other.footprint()):
                    _apply_damage(state, ctx, other, burst,
                                  e.owner if e.owner >= 0 else None)
    else:
        ctx.emit(type="building_destroyed", owner=e.owner, building=e.type,
                 x=e.x, y=e.y, by=credit)

    for x, y in footprint:
        state.tiles[y][x] = "rubble"
