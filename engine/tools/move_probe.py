"""Diagnostic: trace one unit's movement across turns."""

from __future__ import annotations

from cero_engine.mapgen import generate_map
from cero_engine.phases import advance


def main() -> None:
    state = generate_map(7, "1v1", ["forge", "swarm"])
    striker = next(u for u in state.units_of(0) if u.type == "striker")
    sid = striker.id
    print(f"start=({striker.x},{striker.y}) target=(28,28)")
    orders: dict[int, list] = {0: [{"actor_id": sid, "type": "move", "to": [28, 28]}]}
    for t in range(1, 16):
        advance(state, orders)
        orders = {}
        u = state.ent(sid)
        if u is None:
            print(f"T{t}: unit died")
            return
        print(f"T{t}: ({u.x},{u.y}) order={u.standing_order}")


if __name__ == "__main__":
    main()
