"""Phase 5: movement. Units are processed one at a time in ascending id order.

Paths are BFS over static terrain, preferring routes around other units; steps
are validated against live occupancy, so a unit stops when its next tile is
taken. Fliers ignore terrain but may not end the turn on an occupied tile.
"""

from __future__ import annotations

from cero_engine import rules
from cero_engine.fog import entity_visible_to, visible_tiles
from cero_engine.orders import has_truce
from cero_engine.state import Entity, State
from cero_engine.stats import is_combat_unit, unit_move, unit_range, unit_vision

STEP_ORDER = ((0, -1), (1, 0), (0, 1), (-1, 0))  # N, E, S, W tie-break
HEADINGS = {(0, -1): "N", (1, 0): "E", (0, 1): "S", (-1, 0): "W"}


def movement_phase(state: State, ctx) -> None:
    building_tiles: set[tuple[int, int]] = set()
    for e in state.entities_sorted():
        if e.is_building:
            building_tiles.update(e.footprint())
    unit_pos: dict[tuple[int, int], int] = {
        (e.x, e.y): e.id for e in state.entities_sorted() if e.is_unit}
    vision_cache: dict[int, set[tuple[int, int]]] = {}

    def vision_of(pid: int) -> set[tuple[int, int]]:
        if pid not in vision_cache:
            vision_cache[pid] = visible_tiles(state, pid)
        return vision_cache[pid]

    for unit in state.entities_sorted():
        if not unit.is_unit or unit.stiff:
            continue
        order = unit.standing_order or {}
        if order.get("type") == "fusing":
            continue

        goal = _goal_tiles(state, ctx, unit, order, vision_of, building_tiles)
        if goal is None:
            continue
        goal_set, stop_adjacent = goal
        if (unit.x, unit.y) in goal_set:
            _finish_arrival(unit, order)
            continue

        player = state.players[unit.owner] if unit.owner >= 0 else None
        mov = unit_move(player, unit.type) if player else rules.UNITS[unit.type]["mov"]
        path = _path(state, building_tiles, unit_pos, unit, goal_set)
        if not path:
            continue

        del unit_pos[(unit.x, unit.y)]
        last_free: tuple[int, int] = (unit.x, unit.y)
        heading = unit.heading
        pos = (unit.x, unit.y)
        for step in path[:mov]:
            occupied = step in unit_pos or step in building_tiles
            if unit.is_air:
                if not occupied:
                    last_free = step
                heading = HEADINGS.get((step[0] - pos[0], step[1] - pos[1]), heading)
                pos = step
                if step in goal_set and not occupied:
                    break
            else:
                if occupied:
                    break
                heading = HEADINGS.get((step[0] - pos[0], step[1] - pos[1]), heading)
                pos = step
                last_free = step
                if step in goal_set:
                    break
        final = last_free if unit.is_air else pos
        unit.x, unit.y = final
        unit.heading = heading
        unit_pos[final] = unit.id
        if final in goal_set:
            _finish_arrival(unit, order)


def _finish_arrival(unit: Entity, order: dict) -> None:
    if order.get("type") == "move":
        unit.standing_order = None
    elif order.get("type") == "attack_move" and not order.get("target_id"):
        # Destination reached with nothing left to fight: the sweep is over.
        unit.standing_order = None


def _goal_tiles(state: State, ctx, unit: Entity, order: dict, vision_of, building_tiles: set):
    """Return (goal_tile_set, stop_adjacent) or None when the unit has no travel intent."""
    kind = order.get("type")

    def walkable(t: tuple[int, int]) -> bool:
        return (state.in_bounds(*t) and t not in building_tiles
                and _tile_walkable_static(state, unit, t))

    if unit.owner < 0:
        return _guard_goal(state, unit, building_tiles)

    if kind == "move":
        to = tuple(order["to"])
        if not walkable(to):
            # Aim for the nearest adjacent walkable tile instead.
            adj = {(to[0] + dx, to[1] + dy) for dx, dy in
                   ((0, -1), (1, 0), (0, 1), (-1, 0), (1, -1), (1, 1), (-1, 1), (-1, -1))}
            goals = {t for t in adj if walkable(t)}
            return (goals, False) if goals else None
        return {to}, False

    if kind == "attack_move":
        # AoE2 attack-move: advance to `to`, but engage any enemy that enters
        # this unit's vision on the way; when the fight ends, resume the march.
        player = state.players[unit.owner]
        rng = unit_range(player, unit.type)
        target = state.ent(order.get("target_id", -1)) if "target_id" in order else None
        if (target is None or target.hp <= 0
                or (target.owner >= 0 and has_truce(state, unit.owner, target.owner))
                or (target.is_unit and not entity_visible_to(
                    state, target, unit.owner, vision_of(unit.owner)))):
            order.pop("target_id", None)
            target = _acquire_target(state, unit, vision_of(unit.owner))
            if target is not None:
                order["target_id"] = target.id
        if target is not None:
            if (unit.x, unit.y) in _tiles_in_range_set(target, rng):
                return {(unit.x, unit.y)}, False  # in range: hold and fire
            in_range = {t for t in _tiles_in_range(state, target, rng) if walkable(t)}
            if in_range:
                return in_range, False
            order.pop("target_id", None)  # unreachable: keep marching
        to = tuple(order["to"])
        if not walkable(to):
            adj = {(to[0] + dx, to[1] + dy) for dx, dy in
                   ((0, -1), (1, 0), (0, 1), (-1, 0), (1, -1), (1, 1), (-1, 1), (-1, -1))}
            goals = {t for t in adj if walkable(t)}
            return (goals, False) if goals else None
        return {to}, False

    if kind == "attack":
        target = state.ent(order["target_id"])
        if target is None or target.hp <= 0:
            unit.standing_order = None
            return None
        if not entity_visible_to(state, target, unit.owner, vision_of(unit.owner)):
            unit.standing_order = None
            return None
        player = state.players[unit.owner]
        rng = unit_range(player, unit.type)
        if (unit.x, unit.y) in _tiles_in_range_set(target, rng):
            return {(unit.x, unit.y)}, False  # already in range: hold position
        in_range = {t for t in _tiles_in_range(state, target, rng) if walkable(t)}
        return (in_range, False) if in_range else None

    if kind in ("gather", "repair", "build"):
        if kind == "gather" and order.get("phase") == "return":
            # Full load: walk to the nearest own drop-off (core/depot) and bank it.
            target_tiles = [t for b in state.dropoffs_of(unit.owner) for t in b.footprint()]
            if not target_tiles:
                return None  # nowhere to bank yet (nomad crew): hold the cargo
        elif kind == "gather":
            tx, ty = order["target"]
            target_tiles = [(tx, ty)]
        else:
            target = state.ent(order["target_id"])
            if target is None or (kind == "build" and not target.build_progress):
                unit.standing_order = None
                return None
            target_tiles = target.footprint()
        if any(max(abs(unit.x - fx), abs(unit.y - fy)) <= 1 for fx, fy in target_tiles):
            return {(unit.x, unit.y)}, False  # already adjacent
        goals = set()
        for fx, fy in target_tiles:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    t = (fx + dx, fy + dy)
                    if walkable(t):
                        goals.add(t)
        return (goals, False) if goals else None

    if kind == "capture":
        target = state.ent(order["target_id"])
        if target is None or target.hp <= 0:
            unit.standing_order = None
            return None
        if any(max(abs(unit.x - fx), abs(unit.y - fy)) <= 1 for fx, fy in target.footprint()):
            return {(unit.x, unit.y)}, False
        goals = set()
        for fx, fy in target.footprint():
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    t = (fx + dx, fy + dy)
                    if walkable(t):
                        goals.add(t)
        return (goals, False) if goals else None

    return None


def _acquire_target(state: State, unit: Entity, vision: set) -> Entity | None:
    """Attack-move acquisition: nearest enemy inside this unit's vision
    (units before buildings, then distance, then id - deterministic).
    Non-combat units never acquire; they just travel."""
    if not is_combat_unit(unit.type):
        return None
    player = state.players[unit.owner]
    vis = unit_vision(player, unit.type)
    best_key: tuple[int, int, int] | None = None
    best: Entity | None = None
    for e in state.entities_sorted():
        if e.owner == unit.owner or e.owner < 0 or e.hp <= 0:
            continue
        if not state.players[e.owner].alive:
            continue
        if has_truce(state, unit.owner, e.owner):
            continue
        if e.type == "wall":
            continue  # walls are only chewed on explicit orders (AoE2 attack-move rule)
        d = min(max(abs(fx - unit.x), abs(fy - unit.y)) for fx, fy in e.footprint())
        if d > vis:
            continue
        if e.is_unit and not entity_visible_to(state, e, unit.owner, vision):
            continue
        if e.is_building and not any((fx, fy) in vision for fx, fy in e.footprint()):
            continue
        key = (0 if e.is_unit else 1, d, e.id)
        if best_key is None or key < best_key:
            best_key, best = key, e
    return best


def _guard_goal(state: State, guard: Entity, building_tiles: set):
    """Camp guard AI: chase hostiles near the camp (leashed), otherwise go home."""

    def walkable(t: tuple[int, int]) -> bool:
        return (state.in_bounds(*t) and t not in building_tiles
                and _tile_walkable_static(state, guard, t))

    hostiles = _guard_hostiles(state, guard)
    home = tuple(guard.camp_home) if guard.camp_home else (guard.x, guard.y)
    camp_alive = any(e.type == "camp" and (e.x, e.y) == home for e in state.entities_sorted())

    if hostiles:
        target = None
        best = None
        for h in sorted(hostiles, key=lambda e: e.id):
            d_home = max(abs(h.x - home[0]), abs(h.y - home[1]))
            if d_home > rules.CAMP_GUARD_VISION and camp_alive:
                continue
            d = max(abs(h.x - guard.x), abs(h.y - guard.y))
            if best is None or d < best:
                best, target = d, h
        if target is not None:
            if max(abs(guard.x - target.x), abs(guard.y - target.y)) <= rules.UNITS["human"]["range"]:
                return {(guard.x, guard.y)}, False
            goals = set()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    t = (target.x + dx, target.y + dy)
                    if (walkable(t)
                            and max(abs(t[0] - home[0]), abs(t[1] - home[1])) <= rules.CAMP_GUARD_LEASH):
                        goals.add(t)
            if goals:
                return goals, False
    if not camp_alive:
        return None  # camp gone: hold position
    if max(abs(guard.x - home[0]), abs(guard.y - home[1])) <= 1:
        return None
    goals = set()
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            t = (home[0] + dx, home[1] + dy)
            if walkable(t):
                goals.add(t)
    return (goals, False) if goals else None


def _guard_hostiles(state: State, guard: Entity) -> list[Entity]:
    home = tuple(guard.camp_home) if guard.camp_home else (guard.x, guard.y)
    camp = next((e for e in state.entities_sorted()
                 if e.type == "camp" and (e.x, e.y) == home), None)
    hostile_players = set(camp.camp_hostile_to) if camp else set(guard.camp_hostile_to)
    if not hostile_players:
        return []
    out = []
    for e in state.entities_sorted():
        if e.is_unit and e.owner in hostile_players:
            ref = camp if camp else guard
            if max(abs(e.x - ref.x), abs(e.y - ref.y)) <= rules.CAMP_GUARD_VISION + 2:
                out.append(e)
    return out


def _tiles_in_range(state: State, target: Entity, rng: int) -> list[tuple[int, int]]:
    tiles = []
    for fx, fy in target.footprint():
        for y in range(max(0, fy - rng), min(state.size, fy + rng + 1)):
            for x in range(max(0, fx - rng), min(state.size, fx + rng + 1)):
                tiles.append((x, y))
    return tiles


def _tiles_in_range_set(target: Entity, rng: int) -> set[tuple[int, int]]:
    out = set()
    for fx, fy in target.footprint():
        for dy in range(-rng, rng + 1):
            for dx in range(-rng, rng + 1):
                out.add((fx + dx, fy + dy))
    return out


def _tile_walkable_static(state: State, unit: Entity, tile: tuple[int, int]) -> bool:
    x, y = tile
    if not state.in_bounds(x, y):
        return False
    if unit.is_air:
        return True
    return state.tiles[y][x] == "plain"


def _path(state: State, building_tiles: set, unit_pos: dict, unit: Entity,
          goals: set[tuple[int, int]]) -> list[tuple[int, int]]:
    """BFS shortest path (N,E,S,W preference). First tries to route around other
    units; falls back to ignoring them (the step loop will bump and stop); if the
    goals are statically unreachable, approach the closest reachable tile."""
    for avoid_units in (True, False):
        path = _bfs(state, building_tiles, unit_pos, unit, goals, avoid_units)
        if path:
            return path
    return _bfs_closest(state, building_tiles, unit_pos, unit, goals)


def _bfs_closest(state: State, building_tiles: set, unit_pos: dict, unit: Entity,
                 goals: set[tuple[int, int]]) -> list[tuple[int, int]]:
    """Flood fill from the unit and walk toward the reachable tile nearest to the
    goal set (deterministic partial approach when goals are enclosed)."""
    samples = sorted(goals)[:24]
    if not samples:
        return []
    start = (unit.x, unit.y)
    prev: dict[tuple[int, int], tuple[int, int]] = {start: start}
    frontier = [start]
    best_tile = start
    best_d = min(max(abs(start[0] - gx), abs(start[1] - gy)) for gx, gy in samples)
    while frontier:
        nxt: list[tuple[int, int]] = []
        for tile in frontier:
            for dx, dy in STEP_ORDER:
                t = (tile[0] + dx, tile[1] + dy)
                if t in prev or not state.in_bounds(*t):
                    continue
                if not unit.is_air and state.tiles[t[1]][t[0]] != "plain":
                    continue
                if t in building_tiles or t in unit_pos:
                    continue
                prev[t] = tile
                d = min(max(abs(t[0] - gx), abs(t[1] - gy)) for gx, gy in samples)
                if d < best_d or (d == best_d and t < best_tile):
                    best_d, best_tile = d, t
                nxt.append(t)
        frontier = nxt
    if best_tile == start:
        return []
    path = []
    cur = best_tile
    while cur != start:
        path.append(cur)
        cur = prev[cur]
    path.reverse()
    return path


def _bfs(state: State, building_tiles: set, unit_pos: dict, unit: Entity,
         goals: set[tuple[int, int]], avoid_units: bool) -> list[tuple[int, int]]:
    start = (unit.x, unit.y)
    prev: dict[tuple[int, int], tuple[int, int]] = {start: start}
    frontier = [start]
    found: tuple[int, int] | None = None
    while frontier and found is None:
        nxt: list[tuple[int, int]] = []
        for tile in frontier:
            for dx, dy in STEP_ORDER:
                t = (tile[0] + dx, tile[1] + dy)
                if t in prev or not state.in_bounds(*t):
                    continue
                if not unit.is_air:
                    if state.tiles[t[1]][t[0]] != "plain":
                        continue
                if t in building_tiles and t not in goals:
                    continue
                if t in building_tiles and not unit.is_air and t in goals:
                    continue  # ground units cannot stand on buildings even as goals
                if avoid_units and t in unit_pos:
                    continue  # never route THROUGH a standing unit (bump-and-stop otherwise)
                prev[t] = tile
                if t in goals and (t not in unit_pos or unit.is_air) and t not in building_tiles:
                    found = t
                    break
                nxt.append(t)
            if found:
                break
        frontier = nxt
    if found is None:
        return []
    path = []
    cur = found
    while cur != start:
        path.append(cur)
        cur = prev[cur]
    path.reverse()
    return path
