"""Deterministic symmetric map generation (PCG32-seeded).

Fairness comes from symmetry: 1v1 maps are 180-degree symmetric, FFA maps are
90-degree symmetric with 4 slots (ffa3 leaves one slot empty; its resources stay
neutral on the map).
"""

from __future__ import annotations

from cero_engine import rules
from cero_engine.fog import update_fog
from cero_engine.pcg import PCG32
from cero_engine.state import Entity, Player, State, tk
from cero_engine.stats import building_max_hp, unit_max_hp

# Base layout for slot 0 (top-left corner); other slots are symmetry transforms.
CORE_ANCHOR = (3, 3)
COCOON_OFFSETS = [(5, 3), (3, 5)]
WORKER_OFFSETS = [(5, 4), (4, 5), (5, 5), (6, 6)]
STRIKER_OFFSET = (6, 5)
NEAR_VEIN = (8, 4)
FAR_VEIN = (10, 10)
START_CLEAR_RADIUS = 6


def _transforms(fmt: str, size: int):
    def ident(x: int, y: int) -> tuple[int, int]:
        return x, y

    def rot90(x: int, y: int) -> tuple[int, int]:
        return size - 1 - y, x

    def rot180(x: int, y: int) -> tuple[int, int]:
        return size - 1 - x, size - 1 - y

    def rot270(x: int, y: int) -> tuple[int, int]:
        return y, size - 1 - x

    if fmt == "1v1":
        return [ident, rot180]
    return [ident, rot90, rot180, rot270]


def _orbit(fmt: str, size: int, x: int, y: int) -> list[tuple[int, int]]:
    return [t(x, y) for t in _transforms(fmt, size)]


def _anchor_of(tiles: list[tuple[int, int]]) -> tuple[int, int]:
    return min(t[0] for t in tiles), min(t[1] for t in tiles)


def _n_slots(fmt: str) -> int:
    return 2 if fmt == "1v1" else 4


def _n_players(fmt: str) -> int:
    return {"1v1": 2, "ffa3": 3, "ffa4": 4}[fmt]


def generate_map(seed: int, fmt: str, lineages: list[str]) -> State:
    if fmt not in ("1v1", "ffa3", "ffa4"):
        raise ValueError(f"unknown format {fmt}")
    n_players = _n_players(fmt)
    if len(lineages) != n_players:
        raise ValueError("lineages length must match player count")
    size = rules.MAP_SIZE_1V1 if fmt == "1v1" else rules.MAP_SIZE_FFA
    rng = PCG32(seed)
    transforms = _transforms(fmt, size)
    n_slots = _n_slots(fmt)

    tiles = [["plain" for _ in range(size)] for _ in range(size)]

    # 1. Symmetric terrain noise: roll once per orbit (canonical = min member).
    for y in range(size):
        for x in range(size):
            orbit = _orbit(fmt, size, x, y)
            if (x, y) != min(orbit):
                continue
            r = rng.randint(100)
            val = "blocked" if r < 8 else ("rubble" if r < 12 else "plain")
            for ox, oy in orbit:
                tiles[oy][ox] = val

    # 2. Cellular-automaton smoothing of blocked blobs (2 passes, symmetric input
    #    with a rotation-invariant neighborhood stays symmetric).
    for _ in range(2):
        nxt = [row[:] for row in tiles]
        for y in range(size):
            for x in range(size):
                n = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0:
                            continue
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < size and 0 <= ny < size and tiles[ny][nx] == "blocked":
                            n += 1
                if tiles[y][x] == "blocked":
                    nxt[y][x] = "blocked" if n >= 2 else "plain"
                elif n >= 5:
                    nxt[y][x] = "blocked"
        tiles = nxt

    # 3. Clear the start zones.
    cx, cy = CORE_ANCHOR
    for t in transforms:
        ax, ay = t(cx, cy)
        for y in range(max(0, ay - START_CLEAR_RADIUS), min(size, ay + START_CLEAR_RADIUS + 1)):
            for x in range(max(0, ax - START_CLEAR_RADIUS), min(size, ax + START_CLEAR_RADIUS + 1)):
                tiles[y][x] = "plain"

    veins: dict[str, int] = {}

    def place_vein(x: int, y: int) -> None:
        tiles[y][x] = "vein"
        veins[tk(x, y)] = rules.VEIN_METAL

    # 4. Start veins for every slot (ffa3: the empty slot keeps its veins, neutral).
    for t in transforms:
        for vx, vy in (NEAR_VEIN, FAR_VEIN):
            x, y = t(vx, vy)
            place_vein(x, y)

    # 5. Center veins. 1v1: 2 rolled + mirrored (4). FFA: 1 rolled per orbit (4) + 2 fixed.
    center_lo, center_hi = size // 2 - 4, size // 2 + 3
    rolls = 2 if fmt == "1v1" else 1
    placed = 0
    attempts = 0
    while placed < rolls and attempts < 200:
        attempts += 1
        x = center_lo + rng.randint(center_hi - center_lo + 1)
        y = center_lo + rng.randint(center_hi - center_lo + 1)
        orbit = _orbit(fmt, size, x, y)
        if any(tiles[oy][ox] != "plain" for ox, oy in orbit):
            continue
        if len(set(orbit)) < len(orbit):
            continue
        for ox, oy in orbit:
            place_vein(ox, oy)
        placed += 1
    if fmt != "1v1":
        for x, y in ((size // 2 - 1, size // 2 - 1), (size // 2, size // 2)):
            if tiles[y][x] == "plain":
                place_vein(x, y)

    # 6. Camps: one roll, mirrored to every slot region (2 camps 1v1 / 4 FFA).
    camp_positions: list[tuple[int, int]] = []
    attempts = 0
    while not camp_positions and attempts < 200:
        attempts += 1
        x = 9 + rng.randint(size // 2 - 11)
        y = 9 + rng.randint(size // 2 - 11)
        orbit = _orbit(fmt, size, x, y)
        ok = True
        for ox, oy in orbit:
            if tiles[oy][ox] != "plain":
                ok = False
            # keep a 2-tile margin around start structures
            if max(abs(ox - cx), abs(oy - cy)) <= START_CLEAR_RADIUS - 2:
                ok = False
        if ok and len(set(orbit)) == len(orbit):
            camp_positions = list(dict.fromkeys(orbit))
    if not camp_positions:  # extremely unlikely fallback, still deterministic
        camp_positions = [t(size // 2 - 6, 8) for t in transforms]

    # 7. Build the state and place entities in a fixed, deterministic order.
    players = [Player(id=i, lineage=lineages[i], energy=rules.STARTING_ENERGY,
                      metal=rules.STARTING_METAL) for i in range(n_players)]
    state = State(turn=0, format=fmt, size=size, max_turns=rules.MAX_TURNS,
                  next_entity_id=1, tiles=tiles, veins=veins, scrap={}, players=players)

    for slot in range(n_slots):
        if slot >= n_players:
            continue  # ffa3: empty slot, resources stay neutral
        t = transforms[slot]
        player = players[slot]
        core_tiles = [t(cx + dx, cy + dy) for dy in range(2) for dx in range(2)]
        ax, ay = _anchor_of(core_tiles)
        state.add_entity(Entity(id=state.new_id(), owner=slot, kind="building", type="core",
                                x=ax, y=ay, hp=building_max_hp(player, "core")))
        for ox, oy in COCOON_OFFSETS:
            x, y = t(ox, oy)
            state.add_entity(Entity(id=state.new_id(), owner=slot, kind="building",
                                    type="cocoon", x=x, y=y,
                                    hp=building_max_hp(player, "cocoon")))
        for ox, oy in WORKER_OFFSETS:
            x, y = t(ox, oy)
            state.add_entity(Entity(id=state.new_id(), owner=slot, kind="unit", type="worker",
                                    x=x, y=y, hp=unit_max_hp(player, "worker")))
        x, y = t(*STRIKER_OFFSET)
        state.add_entity(Entity(id=state.new_id(), owner=slot, kind="unit", type="striker",
                                x=x, y=y, hp=unit_max_hp(player, "striker")))

    for camp_x, camp_y in sorted(camp_positions):
        camp = state.add_entity(Entity(id=state.new_id(), owner=-1, kind="building",
                                       type="camp", x=camp_x, y=camp_y, hp=rules.CAMP_HP))
        guards = 0
        for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0), (1, -1), (1, 1), (-1, 1), (-1, -1)):
            if guards >= rules.CAMP_GUARDS:
                break
            gx, gy = camp_x + dx, camp_y + dy
            if not state.in_bounds(gx, gy) or state.tiles[gy][gx] != "plain":
                continue
            if any(e.x == gx and e.y == gy for e in state.entities_sorted()):
                continue
            state.add_entity(Entity(id=state.new_id(), owner=-1, kind="unit", type="human",
                                    x=gx, y=gy, hp=rules.UNITS["human"]["hp"],
                                    camp_home=[camp.x, camp.y]))
            guards += 1

    # 8. Connectivity: every core must reach player 0's core over plain tiles.
    _ensure_connectivity(state)

    update_fog(state)
    return state


def _ensure_connectivity(state: State) -> None:
    occ = state.occupancy()

    def passable(x: int, y: int) -> bool:
        return state.tiles[y][x] == "plain" and (x, y) not in occ

    cores = [e for e in state.entities_sorted() if e.type == "core"]
    if len(cores) < 2:
        return

    def adjacent_open(core: Entity) -> tuple[int, int] | None:
        for fx, fy in core.footprint():
            for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
                x, y = fx + dx, fy + dy
                if state.in_bounds(x, y) and passable(x, y):
                    return x, y
        return None

    start = adjacent_open(cores[0])
    if start is None:
        return
    for core in cores[1:]:
        goal = adjacent_open(core)
        if goal is None or _reachable(state, occ, start, goal):
            continue
        _carve_line(state, occ, start, goal)


def _reachable(state: State, occ: dict, start: tuple[int, int], goal: tuple[int, int]) -> bool:
    seen = {start}
    frontier = [start]
    while frontier:
        nxt: list[tuple[int, int]] = []
        for x, y in frontier:
            if (x, y) == goal:
                return True
            for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
                nx, ny = x + dx, y + dy
                if (nx, ny) in seen or not state.in_bounds(nx, ny):
                    continue
                if state.tiles[ny][nx] != "plain" or (nx, ny) in occ:
                    continue
                seen.add((nx, ny))
                nxt.append((nx, ny))
        frontier = sorted(nxt)
    return False


def _carve_line(state: State, occ: dict, a: tuple[int, int], b: tuple[int, int]) -> None:
    """Integer line walk from a to b turning every non-entity tile into plain."""
    x, y = a
    bx, by = b
    while (x, y) != (bx, by):
        if x != bx:
            x += 1 if bx > x else -1
        elif y != by:
            y += 1 if by > y else -1
        if (x, y) in occ:
            continue
        if state.tiles[y][x] == "vein":
            state.veins.pop(tk(x, y), None)
        state.tiles[y][x] = "plain"
