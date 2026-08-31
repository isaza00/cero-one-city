"""Fog of war: visibility, exploration memory and stealth (AoE2 model).

Black = never seen. Gray = explored (terrain + last building seen, frozen).
Visible = within Chebyshev vision radius of an own unit/building.
"""

from __future__ import annotations

from cero_engine.state import Entity, State, tk
from cero_engine.stats import entity_vision

STEALTH_DETECT_RADIUS = 2


def pack(size: int, x: int, y: int) -> int:
    return y * size + x


def visible_tiles(state: State, player_id: int) -> set[tuple[int, int]]:
    """Union of vision radii of the player's entities."""
    out: set[tuple[int, int]] = set()
    for e in state.entities_sorted():
        if e.owner != player_id:
            continue
        vis = entity_vision(state, e)
        for fx, fy in e.footprint():
            for y in range(max(0, fy - vis), min(state.size, fy + vis + 1)):
                for x in range(max(0, fx - vis), min(state.size, fx + vis + 1)):
                    out.add((x, y))
    return out


def entity_visible_to(state: State, e: Entity, viewer_id: int,
                      viewer_tiles: set[tuple[int, int]] | None = None) -> bool:
    """Is entity `e` visible to `viewer_id`? Handles stealth (recruited humans)."""
    if e.owner == viewer_id:
        return True
    tiles = viewer_tiles if viewer_tiles is not None else visible_tiles(state, viewer_id)
    if (e.x, e.y) not in tiles:
        return False
    if e.is_unit and e.type == "human" and e.owner >= 0:
        # Stealth: visible only within 2 tiles of a viewer entity, or shortly after attacking.
        if e.revealed_until >= state.turn:
            return True
        for v in state.entities_sorted():
            if v.owner != viewer_id:
                continue
            for fx, fy in v.footprint():
                if max(abs(fx - e.x), abs(fy - e.y)) <= STEALTH_DETECT_RADIUS:
                    return True
        return False
    return True


def update_fog(state: State) -> None:
    """Refresh each player's explored set and last-seen building memory."""
    for player in state.players:
        if not player.alive and state.turn > 0:
            continue
        tiles = visible_tiles(state, player.id)
        explored = set(player.explored)
        for (x, y) in tiles:
            explored.add(pack(state.size, x, y))
        player.explored = sorted(explored)

        # Refresh building memory on currently visible tiles.
        visible_buildings: dict[str, dict] = {}
        for e in state.entities_sorted():
            if not e.is_building or e.owner == player.id:
                continue
            for fx, fy in e.footprint():
                if (fx, fy) in tiles:
                    visible_buildings[tk(fx, fy)] = {"type": e.type, "owner": e.owner}
        for (x, y) in tiles:
            key = tk(x, y)
            if key in visible_buildings:
                player.last_seen[key] = visible_buildings[key]
            elif key in player.last_seen:
                del player.last_seen[key]
