"""Deterministic symmetric map generation (PCG32-seeded).

Fairness comes from symmetry: 1v1 maps are 180-degree symmetric, FFA maps are
90-degree symmetric with 4 slots (ffa3 leaves one slot empty; its resources stay
neutral on the map).

NOMAD START (s2.0, the AoE2 "Nomad" opening): nobody owns a building. Each slot
gets a crew of workers plus one striker standing on cleared ground, next to the
resources a well-placed core banks instantly: a wild pod cluster (energy) two
tiles east of the ideal core site and a metal vein two tiles west of it. A
second pod cluster and a second vein sit further out - the "back" resources a
depot unlocks - and the middle of the map holds the contested El Dorado.
"""

from __future__ import annotations

from cero_engine import rules
from cero_engine.fog import update_fog
from cero_engine.pcg import PCG32
from cero_engine.state import Entity, Player, State, tk
from cero_engine.stats import unit_max_hp

# Layout of one start zone, relative to the IDEAL core anchor (the 2x2 core
# would occupy (0,0)..(1,1)). Nothing is placed on that footprint or its ring.
START_WORKER_OFFSETS = [(-1, 3), (0, 3), (1, 3), (2, 3)]
START_ESCORT_OFFSET = (3, 3)
NEAR_PODS = [(3, -1), (3, 0), (3, 1), (3, 2)]        # bankable from the ring tile (2, y)
NEAR_VEINS = [(-2, 0), (-2, 1)]                      # bankable from the ring tile (-1, y)
FAR_PODS = [(-3, 7), (-2, 8), (-3, 8)]
FAR_VEINS = [(7, 7), (8, 7)]
START_CLEAR_RADIUS = 10
EXPANSION_POD_SHAPE = [(0, 0), (1, 0), (0, 1)]


def start_anchor(size: int) -> tuple[int, int]:
    """Ideal core anchor of slot 0; the other slots are symmetry transforms."""
    return size // 4, size // 4


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


def _n_slots(fmt: str) -> int:
    return 2 if fmt == "1v1" else 4


def _n_players(fmt: str) -> int:
    return {"1v1": 2, "ffa3": 3, "ffa4": 4}[fmt]


def start_zones(fmt: str, size: int) -> list[tuple[int, int]]:
    """Ideal core anchor per slot (the transform of slot 0's anchor)."""
    ax, ay = start_anchor(size)
    return [t(ax, ay) for t in _transforms(fmt, size)]


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
    ax, ay = start_anchor(size)

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

    # 3. Clear the start zones: the crews need room to found a city.
    for t in transforms:
        sx, sy = t(ax, ay)
        for y in range(max(0, sy - START_CLEAR_RADIUS), min(size, sy + START_CLEAR_RADIUS + 1)):
            for x in range(max(0, sx - START_CLEAR_RADIUS), min(size, sx + START_CLEAR_RADIUS + 1)):
                tiles[y][x] = "plain"

    veins: dict[str, int] = {}
    pods: dict[str, int] = {}

    def place_vein(x: int, y: int) -> None:
        tiles[y][x] = "vein"
        veins[tk(x, y)] = rules.VEIN_METAL

    def place_pod(x: int, y: int) -> None:
        tiles[y][x] = "pod"
        pods[tk(x, y)] = rules.POD_ENERGY

    # 4. Start resources for every slot (ffa3: the empty slot keeps them, neutral).
    for t in transforms:
        for ox, oy in NEAR_PODS + FAR_PODS:
            place_pod(*t(ax + ox, ay + oy))
        for ox, oy in NEAR_VEINS + FAR_VEINS:
            place_vein(*t(ax + ox, ay + oy))

    def near_any_start(x: int, y: int, margin: int) -> bool:
        for t in transforms:
            sx, sy = t(ax, ay)
            if max(abs(x - sx), abs(y - sy)) <= margin:
                return True
        return False

    # 5. Center veins: a contested El Dorado in the middle of the super map.
    #    Rolls scale with map size (96 -> 6 rolled orbits = 12 veins in 1v1).
    band = max(4, size // 8)
    center_lo, center_hi = size // 2 - band, size // 2 + band - 1
    rolls = max(2, size // 16) if fmt == "1v1" else max(1, size // 24)
    placed = 0
    attempts = 0
    while placed < rolls and attempts < 400:
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

    # 5b. Expansion veins scattered across the wasteland (outside the start
    #     zones), so the long march across the map has places worth stopping.
    expansions = size // 12
    placed = 0
    attempts = 0
    while placed < expansions and attempts < 600:
        attempts += 1
        x = 4 + rng.randint(size - 8)
        y = 4 + rng.randint(size - 8)
        orbit = _orbit(fmt, size, x, y)
        if len(set(orbit)) < len(orbit):
            continue
        if any(tiles[oy][ox] != "plain"
               or near_any_start(ox, oy, START_CLEAR_RADIUS + 2) for ox, oy in orbit):
            continue
        for ox, oy in orbit:
            place_vein(ox, oy)
        placed += 1

    # 5c. Expansion pod clusters: wild energy out in the wasteland (the forage
    #     and hunt you find while exploring; an expansion depot makes them pay).
    pod_rolls = max(2, size // 24)
    placed = 0
    attempts = 0
    pod_cluster_origins: list[tuple[int, int]] = []
    while placed < pod_rolls and attempts < 600:
        attempts += 1
        x = 4 + rng.randint(size - 10)
        y = 4 + rng.randint(size - 10)
        cluster = [(x + dx, y + dy) for dx, dy in EXPANSION_POD_SHAPE]
        orbits = [_orbit(fmt, size, cx, cy) for cx, cy in cluster]
        all_tiles = [tt for orb in orbits for tt in orb]
        if len(set(all_tiles)) < len(all_tiles):
            continue
        if any(tiles[oy][ox] != "plain" or near_any_start(ox, oy, START_CLEAR_RADIUS + 2)
               for ox, oy in all_tiles):
            continue
        for ox, oy in all_tiles:
            place_pod(ox, oy)
        pod_cluster_origins.append((x, y))
        placed += 1

    # 6. Camps, scaled with map size (96 -> 3 rolled orbits = 6 camps in 1v1),
    #    spread out with a minimum distance between them.
    camp_positions: list[tuple[int, int]] = []
    camp_rolls = max(1, size // 32)
    attempts = 0
    while len(camp_positions) < camp_rolls * len(transforms) and attempts < 600:
        attempts += 1
        x = 9 + rng.randint(size - 18)
        y = 9 + rng.randint(size - 18)
        orbit = _orbit(fmt, size, x, y)
        ok = len(set(orbit)) == len(orbit)
        for ox, oy in orbit:
            if tiles[oy][ox] != "plain" or near_any_start(ox, oy, START_CLEAR_RADIUS + 2):
                ok = False
                break
            if any(max(abs(ox - px), abs(oy - py)) < 10 for px, py in camp_positions):
                ok = False
                break
        if ok:
            camp_positions.extend(dict.fromkeys(orbit))
    if not camp_positions:  # extremely unlikely fallback, still deterministic
        camp_positions = [t(size // 2 - 6, 8) for t in transforms]

    # 7. Build the state and place entities in a fixed, deterministic order.
    players = [Player(id=i, lineage=lineages[i], energy=rules.STARTING_ENERGY,
                      metal=rules.STARTING_METAL) for i in range(n_players)]
    state = State(turn=0, format=fmt, size=size, max_turns=rules.MAX_TURNS,
                  next_entity_id=1, tiles=tiles, veins=veins, scrap={}, players=players,
                  pods=pods)

    for slot in range(n_slots):
        if slot >= n_players:
            continue  # ffa3: empty slot, resources stay neutral
        t = transforms[slot]
        player = players[slot]
        for ox, oy in START_WORKER_OFFSETS[:rules.START_WORKERS]:
            x, y = t(ax + ox, ay + oy)
            state.add_entity(Entity(id=state.new_id(), owner=slot, kind="unit", type="worker",
                                    x=x, y=y, hp=unit_max_hp(player, "worker")))
        for _ in range(rules.START_ESCORTS):
            x, y = t(ax + START_ESCORT_OFFSET[0], ay + START_ESCORT_OFFSET[1])
            state.add_entity(Entity(id=state.new_id(), owner=slot, kind="unit", type="striker",
                                    x=x, y=y, hp=unit_max_hp(player, "striker")))

    # Stray humans: two near every start zone, one beside each expansion pod
    # cluster (the sleepers a worker carries to the first cocoons).
    survivor_tiles: list[tuple[int, int]] = []
    for t in transforms:
        for ox, oy in rules.START_SURVIVORS:
            survivor_tiles.append(t(ax + ox, ay + oy))
    for cx, cy in pod_cluster_origins:
        for ox, oy in _orbit(fmt, size, cx - 1, cy - 1):
            survivor_tiles.append((ox, oy))
    occupied = {(e.x, e.y) for e in state.entities_sorted() if e.is_unit}
    for sx, sy in sorted(set(survivor_tiles)):
        if not state.in_bounds(sx, sy) or tiles[sy][sx] != "plain" or (sx, sy) in occupied:
            continue
        occupied.add((sx, sy))
        state.add_entity(Entity(id=state.new_id(), owner=-1, kind="unit", type="survivor",
                                x=sx, y=sy, hp=rules.UNITS["survivor"]["hp"]))

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

    # 8. Connectivity: every start zone must reach slot 0's over plain tiles.
    _ensure_connectivity(state, [t(ax, ay) for t in transforms][:n_players])

    update_fog(state)
    return state


def _ensure_connectivity(state: State, starts: list[tuple[int, int]]) -> None:
    occ = state.occupancy()

    def passable(x: int, y: int) -> bool:
        return state.tiles[y][x] == "plain" and (x, y) not in occ

    if len(starts) < 2:
        return
    first = starts[0]
    if not passable(*first):
        return
    for goal in starts[1:]:
        if not passable(*goal) or _reachable(state, occ, first, goal):
            continue
        _carve_line(state, occ, first, goal)


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
        if state.tiles[y][x] == "pod":
            state.pods.pop(tk(x, y), None)
        state.tiles[y][x] = "plain"
