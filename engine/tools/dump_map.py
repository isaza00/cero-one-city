"""Dump a generated map (turn 0 state) as JSON and print an ASCII overview.

  python engine/tools/dump_map.py 101 1v1 web/test-results/district-map.json

Streets show as '-', houses/jams/groves as '#', rubble as ':', veins 'M', pods 'o'.
The 3D client's verifier (web/tools/verify-district.mjs) renders the JSON.
"""

from __future__ import annotations

import json
import sys
from collections import Counter

from cero_engine.layout import is_road, road_layout
from cero_engine.mapgen import generate_map

LINEAGES = ["forge", "swarm", "oracle", "parasite"]
GLYPH = {"plain": ".", "blocked": "#", "rubble": ":", "vein": "M", "pod": "o"}


def main() -> None:
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 101
    fmt = sys.argv[2] if len(sys.argv) > 2 else "1v1"
    state = generate_map(seed, fmt, LINEAGES[:{"1v1": 2, "ffa3": 3, "ffa4": 4}[fmt]])
    rows, cols = road_layout(seed, fmt, state.size)
    counts = Counter(tile for row in state.tiles for tile in row)
    total = state.size * state.size
    print(fmt, state.size, {k: f"{v / total:.1%}" for k, v in counts.items()})
    print("rows", rows, "cols", cols)
    for y in range(0, state.size, 2):
        print("".join("-" if state.tiles[y][x] == "plain" and is_road(rows, cols, x, y)
                      else GLYPH[state.tiles[y][x]] for x in range(state.size)))
    if len(sys.argv) > 3:
        with open(sys.argv[3], "w", encoding="utf-8") as out:
            json.dump({"seed": seed, "format": fmt, "state": state.to_dict()}, out)


if __name__ == "__main__":
    main()
