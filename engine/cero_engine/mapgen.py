"""Deterministic symmetric map generation (PCG32-seeded).

Fairness comes from symmetry: 1v1 maps are 180-degree symmetric, FFA maps are
90-degree symmetric with 4 slots (ffa3 leaves one slot empty; its resources stay
neutral on the map).

TERRAIN (s2.1, "the district"): the map is a dead suburb. A street grid of
3-tile avenues (recomputed from the seed by the client, see layout.py) organises
everything: blocks of houses stand beside the avenues, traffic jams of wrecked
cars sit on them, and groves and rock outcrops fill the wasteland in between.
Houses, jams, groves and rocks are all `blocked` (impassable for ground units,
fliers pass); collapsed houses and the debris around jams are `rubble` (a
worker clears it for metal). The client tells them apart by shape and by their
position relative to the streets, so the state keeps its five tile kinds.

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
from cero_engine.layout import is_road, road_layout
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
    """Ideal core anchor of slot 0; the other slots are symmetry transforms.
    A fifth of the way in from the corner: rivals are several blocks apart."""
    return size // 5, size // 5


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

    rows, cols = road_layout(seed, fmt, size)

    def stamp(x: int, y: int, kind: str) -> None:
        """Stamp a tile and its symmetric images (never over a street)."""
        for ox, oy in _orbit(fmt, size, x, y):
            if 0 <= ox < size and 0 <= oy < size and not is_road(rows, cols, ox, oy):
                tiles[oy][ox] = kind

    def along(horizontal: bool, a: int, b: int) -> tuple[int, int]:
        return (a, b) if horizontal else (b, a)

    # 1. Neighbourhoods: rows of houses (4-6 x 3-5 tiles) on one side of an
    #    avenue, one-tile alleys between them, a sidewalk along the street.
    #    One house in five collapsed: its footprint is rubble instead.
    for _ in range(max(3, size // 20)):
        horizontal = rng.randint(2) == 0
        centres = rows if horizontal else cols
        if not centres:
            continue
        centre = centres[rng.randint(len(centres))]
        side = 1 if rng.randint(2) else -1
        cursor = 3 + rng.randint(max(1, size - 6))
        for _ in range(5 + rng.randint(3)):
            # Every third lot is a bigger building (the one that ends up a ruin).
            large = rng.randint(3) == 0
            width = (5 + rng.randint(4)) if large else (4 + rng.randint(3))
            depth = (4 + rng.randint(3)) if large else (3 + rng.randint(3))
            kind = "rubble" if rng.randint(100) < 20 else "blocked"
            for i in range(width):
                for j in range(depth):
                    stamp(*along(horizontal, cursor + i, centre + side * (3 + j)), kind)
            cursor += width + 1 + rng.randint(2)

    # 2. Traffic jams: the war started at rush hour. Two lanes of wrecks on a
    #    stretch of avenue, the middle lane with gaps, debris on the sidewalks.
    for _ in range(max(4, size // 16)):
        horizontal = rng.randint(2) == 0
        centres = rows if horizontal else cols
        if not centres:
            continue
        centre = centres[rng.randint(len(centres))]
        start = 2 + rng.randint(max(1, size - 4))
        for k in range(5 + rng.randint(10)):
            for lane in (-1, 0, 1):
                if lane == 0 and rng.randint(100) < 40:
                    continue
                x, y = along(horizontal, start + k, centre + lane)
                for ox, oy in _orbit(fmt, size, x, y):
                    if 0 <= ox < size and 0 <= oy < size:
                        tiles[oy][ox] = "blocked"
            if rng.randint(100) < 35:
                stamp(*along(horizontal, start + k, centre + (2 if rng.randint(2) else -2)), "rubble")

    # 3. Groves and rock outcrops: round blobs off the streets (the client
    #    decides which blob is trees and which is stone).
    for _ in range(max(3, size // 20)):
        cx = 4 + rng.randint(max(1, size - 8))
        cy = 4 + rng.randint(max(1, size - 8))
        radius = 2 + rng.randint(3)
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                if dx * dx + dy * dy <= radius * radius - rng.randint(radius * 2):
                    stamp(cx + dx, cy + dy, "blocked")

    # 4. A little loose rubble in the wasteland.
    for _ in range(size * size // 300):
        stamp(rng.randint(size), rng.randint(size), "rubble")

    # 5. Clear the start zones: the crews need room to found a city.
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

    # 6. Start resources for every slot (ffa3: the empty slot keeps them, neutral).
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

    # 7. Center veins: a contested El Dorado in the middle of the super map.
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

    # 7b. Expansion veins scattered across the wasteland (outside the start
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

    # 7c. Expansion pod clusters: wild energy out in the wasteland (the forage
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

    # 8. Camps, scaled with map size (96 -> 3 rolled orbits = 6 camps in 1v1),
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

    # 9. Build the state and place entities in a fixed, deterministic order.
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

    # 10. Connectivity: every start zone must reach slot 0's over plain tiles.
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
