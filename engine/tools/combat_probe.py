"""Quick diagnostic: how much combat actually happens in a bot match."""

from __future__ import annotations

import sys

from cero_engine.bots import BOTS
from cero_engine.mapgen import generate_map
from cero_engine.observe import observe
from cero_engine.phases import advance


def main() -> None:
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    a = sys.argv[2] if len(sys.argv) > 2 else "rush"
    b = sys.argv[3] if len(sys.argv) > 3 else "boom"
    state = generate_map(seed, "1v1", ["forge", "swarm"])
    bots = [BOTS[a](0, seed), BOTS[b](1, seed)]
    kills = 0
    events_seen: set[str] = set()
    while not state.finished:
        orders = {p.id: bots[p.id].act(observe(state, p.id, "C"))
                  for p in state.players if p.alive}
        _, events, _ = advance(state, orders)
        for e in events:
            events_seen.add(e["type"])
            if e["type"] == "unit_killed":
                kills += 1
    print(f"winner=P{state.winner} turns={state.turn}")
    print(f"kills={kills} damage={[p.damage_dealt for p in state.players]}")
    print(f"events={sorted(events_seen)}")
    for p in state.players:
        counts: dict[str, int] = {}
        for u in state.units_of(p.id):
            counts[u.type] = counts.get(u.type, 0) + 1
        orders = [(u.type, u.standing_order) for u in state.units_of(p.id)
                  if u.type != "worker"]
        print(f"P{p.id} units={counts} army_orders={orders[:6]}")


if __name__ == "__main__":
    main()
