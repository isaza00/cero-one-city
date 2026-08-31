"""Regenerate the golden replay fixtures (PLAN.md §11).

Run whenever rules change, in the same PR that bumps RULESET_VERSION:
  python engine/tools/make_goldens.py
"""

from __future__ import annotations

import json
import pathlib

from cero_engine.cli import play_match

GOLDEN_DIR = pathlib.Path(__file__).resolve().parent.parent / "tests" / "goldens"

FIXTURES = [
    dict(seed=101, fmt="1v1", bots=["boom", "boom"], lineages=["forge", "swarm"]),
    dict(seed=202, fmt="1v1", bots=["rush", "boom"], lineages=["swarm", "forge"]),
    dict(seed=303, fmt="1v1", bots=["turtle", "rush"], lineages=["oracle", "parasite"]),
    dict(seed=404, fmt="ffa3", bots=["boom", "rush", "turtle"],
         lineages=["forge", "swarm", "oracle"]),
    dict(seed=505, fmt="ffa4", bots=["boom", "rush", "turtle", "random"],
         lineages=["forge", "swarm", "oracle", "parasite"]),
    dict(seed=606, fmt="ffa4", bots=["random", "random", "random", "random"],
         lineages=["parasite", "oracle", "swarm", "forge"]),
]


def main() -> None:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    for old in GOLDEN_DIR.glob("*.json"):
        old.unlink()
    for fx in FIXTURES:
        replay = play_match(fx["seed"], fx["fmt"], fx["bots"], fx["lineages"])
        name = f"{fx['fmt']}_{fx['seed']}_{'-'.join(fx['bots'])}.json"
        (GOLDEN_DIR / name).write_text(json.dumps(replay, indent=1))
        print(f"{name}: turns={replay['turns']} winner=P{replay['winner']}")


if __name__ == "__main__":
    main()
