"""Movement/action audit log for a finished match.

Run inside the api container:
    docker compose exec api python tools/match_log.py <match_id> [--verbose]

For every stored turn: each player's submitted orders, rejected orders,
resolved events, and how many units actually changed position. Ends with a
per-player audit summary (orders by type, rejections by code, movement stats)
so anomalies like "this team never moved" are visible at a glance.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from collections import Counter, defaultdict

from sqlalchemy import select

from app.db.models import Match, MatchPlayer, Agent, Turn
from app.db.session import session_factory


def unit_positions(state: dict) -> dict[int, tuple[int, int, str, int]]:
    """entity_id -> (x, y, type, owner) for units only."""
    out = {}
    for e in state["entities"].values():
        if e.get("kind") == "unit":
            out[e["id"]] = (e["x"], e["y"], e["type"], e["owner"])
    return out


async def main(match_id: str, verbose: bool) -> None:
    async with session_factory()() as db:
        match = await db.get(Match, uuid.UUID(match_id))
        if match is None:
            print(f"no match {match_id}")
            return
        players = (await db.execute(
            select(MatchPlayer).where(MatchPlayer.match_id == match.id)
            .order_by(MatchPlayer.player_index))).scalars().all()
        names = {}
        for mp in players:
            agent = await db.get(Agent, mp.agent_id)
            names[mp.player_index] = agent.name
        turns = (await db.execute(
            select(Turn).where(Turn.match_id == match.id)
            .order_by(Turn.turn_number))).scalars().all()

    print(f"match {match_id}  status={match.status}  turns={len(turns)}")
    for idx, name in names.items():
        print(f"  P{idx} = {name}")
    print()

    order_types: dict[int, Counter] = defaultdict(Counter)
    error_codes: dict[int, Counter] = defaultdict(Counter)
    moved_turns: dict[int, int] = defaultdict(int)     # turns with >=1 unit moved
    units_moved: dict[int, int] = defaultdict(int)     # total unit-moves
    no_orders_turns: dict[int, int] = defaultdict(int)
    prev_pos: dict[int, tuple] | None = None

    for t in turns:
        pos = unit_positions(t.state)
        moved_by_owner: Counter = Counter()
        if prev_pos:
            for eid, (x, y, utype, owner) in pos.items():
                if eid in prev_pos and (prev_pos[eid][0], prev_pos[eid][1]) != (x, y):
                    moved_by_owner[owner] += 1
        prev_pos = pos

        line = [f"T{t.turn_number:>2}"]
        for idx in names:
            orders = (t.orders or {}).get(str(idx), [])
            errs = (t.order_errors or {}).get(str(idx), [])
            for o in orders:
                if isinstance(o, dict):
                    order_types[idx][o.get("type", "?")] += 1
            for e in errs:
                error_codes[idx][f"{e.get('type')}:{e.get('code')}"] += 1
            if not orders:
                no_orders_turns[idx] += 1
            if moved_by_owner.get(idx):
                moved_turns[idx] += 1
                units_moved[idx] += moved_by_owner[idx]
            summary = Counter(o.get("type", "?") for o in orders if isinstance(o, dict))
            otxt = ",".join(f"{k}x{v}" for k, v in summary.most_common()) or "-"
            line.append(f"P{idx}[{otxt}|moved:{moved_by_owner.get(idx, 0)}"
                        f"{'|ERR:' + str(len(errs)) if errs else ''}]")
        events = t.events or []
        etxt = ",".join(sorted({e.get("type", "?") for e in events})) if events else ""
        line.append(etxt)
        print("  ".join(line))
        if verbose:
            for idx in names:
                for e in (t.order_errors or {}).get(str(idx), []):
                    print(f"      P{idx} REJECTED {e.get('type')}"
                          f" actor={e.get('actor_id')} [{e.get('code')}] {e.get('message')}")

    print("\n=== per-player audit ===")
    for idx, name in names.items():
        print(f"\nP{idx} {name}")
        print(f"  orders by type : {dict(order_types[idx].most_common())}")
        print(f"  rejections     : {dict(error_codes[idx].most_common()) or 'none'}")
        print(f"  turns with no orders submitted: {no_orders_turns[idx]}/{len(turns)}")
        print(f"  turns where >=1 unit moved    : {moved_turns[idx]}/{len(turns)}"
              f"  (total unit-moves: {units_moved[idx]})")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    asyncio.run(main(sys.argv[1], "--verbose" in sys.argv))
