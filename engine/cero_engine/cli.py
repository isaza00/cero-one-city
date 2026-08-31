"""Engine CLI.

  python -m cero_engine.cli play --seed 42 --format 1v1 --bots rush,boom --dump replay.json
  python -m cero_engine.cli verify replay.json
  python -m cero_engine.cli bench
"""

from __future__ import annotations

import argparse
import json
import time

from cero_engine import ENGINE_VERSION
from cero_engine.bots import BOTS
from cero_engine.hashing import chain_hash, hash_state
from cero_engine.mapgen import generate_map
from cero_engine.observe import observe
from cero_engine.phases import advance
from cero_engine.rules import RULESET_VERSION
from cero_engine.score import placements, score

DEFAULT_LINEAGES = ["forge", "swarm", "oracle", "parasite"]


def play_match(seed: int, fmt: str, bot_names: list[str],
               lineages: list[str] | None = None, record_orders: bool = False) -> dict:
    """Run a full bots-vs-bots match; returns a replay dict with the hash chain."""
    n = {"1v1": 2, "ffa3": 3, "ffa4": 4}[fmt]
    if len(bot_names) != n:
        raise SystemExit(f"format {fmt} needs {n} bots")
    lineages = lineages or DEFAULT_LINEAGES[:n]
    state = generate_map(seed, fmt, lineages)
    bots = [BOTS[name](player_id=i, seed=seed) for i, name in enumerate(bot_names)]

    chain = ""
    hashes = [hash_state(state)]
    chain = chain_hash(chain, hashes[0])
    orders_log: list[dict] = []

    while not state.finished:
        orders_by_player: dict[int, list] = {}
        for player in state.players:
            if not player.alive:
                continue
            obs = observe(state, player.id, band="C",
                          diplo_actions=["propose_truce", "accept_truce", "break_truce",
                                         "propose_joint_attack", "accept_joint_attack"])
            orders_by_player[player.id] = bots[player.id].act(obs)
        if record_orders:
            orders_log.append({str(k): v for k, v in orders_by_player.items()})
        advance(state, orders_by_player)
        h = hash_state(state)
        hashes.append(h)
        chain = chain_hash(chain, h)

    return {
        "engine_version": ENGINE_VERSION,
        "ruleset_version": RULESET_VERSION,
        "seed": seed,
        "format": fmt,
        "lineages": lineages,
        "bots": bot_names,
        "turns": state.turn,
        "winner": state.winner,
        "placements": placements(state),
        "scores": {str(k): v for k, v in score(state).items()},
        "hashes": hashes,
        "chain": chain,
        "orders": orders_log if record_orders else None,
    }


def verify_replay(replay: dict) -> bool:
    """Re-run a replay (from recorded orders if present, else the same bots) and
    compare the hash chain."""
    if replay.get("orders"):
        state = generate_map(replay["seed"], replay["format"], replay["lineages"])
        hashes = [hash_state(state)]
        chain = chain_hash("", hashes[0])
        for turn_orders in replay["orders"]:
            advance(state, {int(k): v for k, v in turn_orders.items()})
            h = hash_state(state)
            hashes.append(h)
            chain = chain_hash(chain, h)
        return chain == replay["chain"] and hashes == replay["hashes"]
    rerun = play_match(replay["seed"], replay["format"], replay["bots"], replay["lineages"])
    return rerun["chain"] == replay["chain"] and rerun["hashes"] == replay["hashes"]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cero_engine", description="Cero One City engine")
    parser.add_argument("--version", action="store_true")
    sub = parser.add_subparsers(dest="command")

    p_play = sub.add_parser("play", help="play a bots-vs-bots match")
    p_play.add_argument("--seed", type=int, default=42)
    p_play.add_argument("--format", default="1v1", choices=["1v1", "ffa3", "ffa4"])
    p_play.add_argument("--bots", default="boom,boom")
    p_play.add_argument("--lineages", default=None)
    p_play.add_argument("--dump", default=None, help="write replay JSON to this path")
    p_play.add_argument("--record-orders", action="store_true")

    p_verify = sub.add_parser("verify", help="re-run a replay and compare hashes")
    p_verify.add_argument("replay")

    sub.add_parser("bench", help="benchmark turn resolution")

    args = parser.parse_args(argv)
    if args.version or args.command is None:
        print(f"cero_engine {ENGINE_VERSION} (ruleset {RULESET_VERSION})")
        return 0

    if args.command == "play":
        lineages = args.lineages.split(",") if args.lineages else None
        t0 = time.perf_counter()
        replay = play_match(args.seed, args.format, args.bots.split(","), lineages,
                            record_orders=args.record_orders or bool(args.dump))
        dt = time.perf_counter() - t0
        print(f"seed={args.seed} format={args.format} bots={args.bots} "
              f"turns={replay['turns']} winner=P{replay['winner']} "
              f"scores={replay['scores']} ({dt:.2f}s)")
        if args.dump:
            with open(args.dump, "w", encoding="utf-8") as f:
                json.dump(replay, f, indent=1)
            print(f"replay written to {args.dump}")
        return 0

    if args.command == "verify":
        with open(args.replay, encoding="utf-8") as f:
            replay = json.load(f)
        ok = verify_replay(replay)
        print("OK: hash chain reproduced" if ok else "FAIL: hash chain mismatch")
        return 0 if ok else 1

    if args.command == "bench":
        t0 = time.perf_counter()
        replay = play_match(7, "1v1", ["boom", "boom"])
        dt = time.perf_counter() - t0
        print(f"{replay['turns']} turns in {dt:.3f}s "
              f"({dt / max(replay['turns'], 1) * 1000:.1f} ms/turn)")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
