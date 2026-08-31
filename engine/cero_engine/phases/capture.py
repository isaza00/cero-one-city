"""Phase 8: parasite rack capture (dispute counter 0 -> 3)."""

from __future__ import annotations

from cero_engine.rules import CAPTURE_COUNTER_TARGET
from cero_engine.state import State


def capture_phase(state: State, ctx) -> None:
    racks = [e for e in state.entities_sorted() if e.type == "rack" and not e.build_progress]
    for rack in racks:
        # Start a dispute: the lowest-id adjacent leech with a capture order on this rack.
        if rack.capture is None:
            for leech in state.entities_sorted():
                if (leech.is_unit and leech.type == "leech" and leech.owner >= 0
                        and leech.owner != rack.owner
                        and (leech.standing_order or {}).get("type") == "capture"
                        and (leech.standing_order or {}).get("target_id") == rack.id
                        and _adjacent(leech, rack)):
                    rack.capture = {"by": leech.owner, "counter": 0}
                    break
        if rack.capture is None:
            continue

        by = rack.capture["by"]
        attacker_adjacent = any(
            e.is_unit and e.type == "leech" and e.owner == by and _adjacent(e, rack)
            for e in state.entities_sorted())
        defender_adjacent = any(
            e.is_unit and e.owner == rack.owner and _adjacent(e, rack)
            for e in state.entities_sorted())

        if attacker_adjacent:
            rack.capture["counter"] += 1
        elif defender_adjacent:
            rack.capture["counter"] -= 1

        if rack.capture["counter"] >= CAPTURE_COUNTER_TARGET:
            old_owner = rack.owner
            rack.owner = by
            rack.capture = None
            rack.was_captured = True
            ctx.emit(type="capture_success", rack=rack.id, by=by, from_player=old_owner,
                     x=rack.x, y=rack.y)
        elif rack.capture["counter"] <= 0 and not attacker_adjacent:
            rack.capture = None
            ctx.emit(type="capture_repelled", rack=rack.id, owner=rack.owner,
                     x=rack.x, y=rack.y)


def _adjacent(unit, rack) -> bool:
    return max(abs(unit.x - rack.x), abs(unit.y - rack.y)) <= 1
