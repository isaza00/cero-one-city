"""Hand-built micro states for system tests."""

from __future__ import annotations

from cero_engine.fog import update_fog
from cero_engine.state import Entity, Player, State


def blank_state(size: int = 12, players: int = 2,
                lineages: list[str] | None = None) -> State:
    lineages = lineages or ["forge", "swarm", "oracle", "parasite"][:players]
    state = State(
        turn=0, format="1v1", size=size, max_turns=40, next_entity_id=1,
        tiles=[["plain" for _ in range(size)] for _ in range(size)],
        veins={}, scrap={},
        players=[Player(id=i, lineage=lineages[i], energy=200, metal=200)
                 for i in range(players)],
    )
    return state


def add(state: State, owner: int, kind: str, etype: str, x: int, y: int,
        hp: int | None = None, **extra) -> Entity:
    from cero_engine import rules
    if hp is None:
        hp = rules.UNITS[etype]["hp"] if kind == "unit" else rules.BUILDINGS[etype]["hp"]
    e = Entity(id=state.new_id(), owner=owner, kind=kind, type=etype, x=x, y=y, hp=hp)
    for k, v in extra.items():
        setattr(e, k, v)
    state.add_entity(e)
    return e


def with_cores(state: State) -> State:
    """Give each player a core in opposite corners so nobody is eliminated."""
    add(state, 0, "building", "core", 0, 0)
    if len(state.players) > 1:
        add(state, 1, "building", "core", state.size - 2, state.size - 2)
    for i in range(2, len(state.players)):
        add(state, i, "building", "core", state.size - 2, 0)
    update_fog(state)
    return state
