"""Turn resolution: order intake + the ten deterministic WEGO phases (PLAN.md §3.8).

`advance` mutates the state in place and also returns it. Every phase iterates
entities in ascending id order; there is no randomness anywhere in resolution.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from cero_engine.hashing import hash_state
from cero_engine.orders import Intake, validate_orders
from cero_engine.phases.capture import capture_phase
from cero_engine.phases.closing import closing_phase
from cero_engine.phases.combat import combat_phase, destruction_phase
from cero_engine.phases.diplomacy import diplomacy_phase
from cero_engine.phases.economy import gathering_phase, maintenance_phase
from cero_engine.phases.movement import movement_phase
from cero_engine.phases.production import (
    construction_phase,
    production_phase,
    research_phase,
)
from cero_engine.state import State


@dataclass
class TurnContext:
    events: list = field(default_factory=list)
    errors: dict[int, list] = field(default_factory=dict)
    intakes: dict[int, Intake] = field(default_factory=dict)
    core_damage: dict[int, int] = field(default_factory=dict)   # core id -> damage this turn
    kill_credit: dict[int, int | None] = field(default_factory=dict)  # entity id -> player
    core_hp_before: dict[int, int] = field(default_factory=dict)
    eliminated_now: dict[int, str] = field(default_factory=dict)  # player -> cause
    forfeits: tuple[int, ...] = ()

    def emit(self, **event: object) -> None:
        self.events.append(event)


def advance(state: State, orders_by_player: dict[int, list],
            diplo_allowed: dict[int, list[str]] | None = None,
            forfeits: tuple[int, ...] = ()) -> tuple[State, list, dict[int, list]]:
    """Resolve one turn. `orders_by_player` maps player index -> raw order list.
    `diplo_allowed` optionally restricts diplomacy actions per player (agent level).
    `forfeits` eliminates those players this turn (abandonment)."""
    if state.finished:
        return state, [], {}

    prev_hash = hash_state(state)
    state.turn += 1
    ctx = TurnContext(forfeits=tuple(forfeits))
    ctx.core_hp_before = {e.id: e.hp for e in state.entities_sorted() if e.type == "core"}

    for player in state.players:
        ctx.errors[player.id] = []
        if not player.alive or player.id in forfeits:
            ctx.intakes[player.id] = Intake()
            continue
        allowed = (diplo_allowed or {}).get(player.id)
        raw = orders_by_player.get(player.id, [])
        intake, errors = validate_orders(state, player.id, raw, allowed)
        ctx.intakes[player.id] = intake
        ctx.errors[player.id] = errors

    maintenance_phase(state, ctx)      # 1
    diplomacy_phase(state, ctx)        # 2
    research_phase(state, ctx)         # 3
    production_phase(state, ctx)       # 4
    movement_phase(state, ctx)         # 5
    combat_phase(state, ctx)           # 6
    destruction_phase(state, ctx)      # 7
    capture_phase(state, ctx)          # 8
    construction_phase(state, ctx)     # 9a: crews that arrived this turn hammer
    gathering_phase(state, ctx)        # 9b: gather / bank / repair
    closing_phase(state, ctx)          # 10

    state.events_last_turn = ctx.events
    state.hash_prev = prev_hash
    return state, ctx.events, ctx.errors
