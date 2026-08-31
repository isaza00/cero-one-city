"""Balance harness (PLAN.md §11): lineage x lineage x strategy win-rate matrix.

  python engine/tools/balance.py --seeds 20 --out balance.csv

Alarm thresholds: any lineage global win rate outside 42-58%, or any strategy
above 65%, exits non-zero so nightly CI flags it.
"""

from __future__ import annotations

import argparse
import csv
import io
import sys

from cero_engine.cli import play_match
from cero_engine.rules import LINEAGES

STRATEGIES = ("rush", "boom", "turtle")


def run_matrix(seeds: int) -> tuple[list[dict], dict, dict]:
    rows: list[dict] = []
    lineage_wins: dict[str, list[int]] = {ln: [0, 0] for ln in LINEAGES}
    strategy_wins: dict[str, list[int]] = {s: [0, 0] for s in STRATEGIES}

    for la in LINEAGES:
        for lb in LINEAGES:
            for sa in STRATEGIES:
                for sb in STRATEGIES:
                    if (la, sa) == (lb, sb):
                        continue
                    for seed in range(1, seeds + 1):
                        replay = play_match(seed * 1000 + hash((la, lb, sa, sb)) % 997,
                                            "1v1", [sa, sb], [la, lb])
                        winner = replay["winner"]
                        rows.append({"lineage_a": la, "lineage_b": lb, "strat_a": sa,
                                     "strat_b": sb, "seed": seed, "winner": winner,
                                     "turns": replay["turns"]})
                        for idx, (ln, st) in enumerate(((la, sa), (lb, sb))):
                            lineage_wins[ln][1] += 1
                            strategy_wins[st][1] += 1
                            if winner == idx:
                                lineage_wins[ln][0] += 1
                                strategy_wins[st][0] += 1
    return rows, lineage_wins, strategy_wins


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seeds", type=int, default=2)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    rows, lineage_wins, strategy_wins = run_matrix(args.seeds)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    if args.out:
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            f.write(buf.getvalue())

    failed = False
    print(f"matches: {len(rows)}")
    for ln, (w, n) in sorted(lineage_wins.items()):
        pct = w * 100 // max(n, 1)
        flag = ""
        if not 42 <= pct <= 58:
            flag = "  <-- OUT OF 42-58% BAND"
            failed = True
        print(f"lineage {ln:9s}: {pct:3d}% ({w}/{n}){flag}")
    for st, (w, n) in sorted(strategy_wins.items()):
        pct = w * 100 // max(n, 1)
        flag = ""
        if pct > 65:
            flag = "  <-- DOMINANT (>65%)"
            failed = True
        print(f"strategy {st:8s}: {pct:3d}% ({w}/{n}){flag}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
