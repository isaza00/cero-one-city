"""Determinism, no-floats, map symmetry, fog invariant and fuzz invariants."""

import json
import pathlib

import pytest

from cero_engine.bots import BOTS
from cero_engine.cli import play_match, verify_replay
from cero_engine.fog import visible_tiles
from cero_engine.hashing import assert_no_floats, hash_state
from cero_engine.mapgen import generate_map
from cero_engine.observe import observe
from cero_engine.phases import advance

GOLDEN_DIR = pathlib.Path(__file__).parent / "goldens"


def test_double_run_identical_hashes():
    a = play_match(1234, "1v1", ["boom", "rush"])
    b = play_match(1234, "1v1", ["boom", "rush"])
    assert a["hashes"] == b["hashes"]
    assert a["chain"] == b["chain"]


def test_state_serialization_roundtrip():
    from cero_engine.state import State
    state = generate_map(5, "1v1", ["forge", "swarm"])
    d = state.to_dict()
    assert_no_floats(d)
    restored = State.from_dict(json.loads(json.dumps(d)))
    assert hash_state(restored) == hash_state(state)


def test_map_symmetry_and_contents():
    state = generate_map(99, "1v1", ["forge", "swarm"])
    # 2 start veins per slot + 4 center veins on a 1v1 map
    assert len(state.veins) == 8
    camps = [e for e in state.entities_sorted() if e.type == "camp"]
    assert len(camps) == 2
    cores = [e for e in state.entities_sorted() if e.type == "core"]
    assert len(cores) == 2
    for p in state.players:
        assert len(state.units_of(p.id)) == 5  # 4 workers + 1 striker

    ffa = generate_map(99, "ffa4", ["forge", "swarm", "oracle", "parasite"])
    assert len([e for e in ffa.entities_sorted() if e.type == "camp"]) == 4
    assert len([e for e in ffa.entities_sorted() if e.type == "core"]) == 4

    ffa3 = generate_map(99, "ffa3", ["forge", "swarm", "oracle"])
    assert len([e for e in ffa3.entities_sorted() if e.type == "core"]) == 3
    # the empty slot still contributes neutral start veins
    assert len(ffa3.veins) >= 8


def test_fog_observation_never_leaks():
    state = generate_map(3, "1v1", ["forge", "swarm"])
    for _ in range(12):
        advance(state, {0: [], 1: []})
        for pid in (0, 1):
            tiles = visible_tiles(state, pid)
            obs = observe(state, pid, band="C")
            for enemy in obs["enemies_visible"]:
                assert (enemy["x"], enemy["y"]) in tiles
            for t in obs["visible_map"]["notable_tiles"]:
                assert (t["x"], t["y"]) in tiles


@pytest.mark.parametrize("seed", [11, 22, 33])
def test_fuzz_invariants(seed):
    fmt = "ffa4" if seed % 2 else "1v1"
    n = 4 if fmt == "ffa4" else 2
    lineages = ["forge", "swarm", "oracle", "parasite"][:n]
    state = generate_map(seed, fmt, lineages)
    bots = [BOTS["random"](i, seed) for i in range(n)]
    while not state.finished:
        orders = {p.id: bots[p.id].act(observe(state, p.id, band="C"))
                  for p in state.players if p.alive}
        advance(state, orders)
        # Invariants after every turn:
        for p in state.players:
            assert p.energy >= 0 and p.metal >= 0
        seen: dict = {}
        for e in state.entities_sorted():
            for t in e.footprint():
                assert t not in seen, f"tile {t} occupied by {seen.get(t)} and {e.id}"
                seen[t] = e.id
            assert state.in_bounds(e.x, e.y)
        assert state.turn <= state.max_turns
    assert state.winner is not None


def test_golden_replays():
    goldens = sorted(GOLDEN_DIR.glob("*.json"))
    assert goldens, "golden replays missing - regenerate with tools/make_goldens.py"
    for path in goldens:
        replay = json.loads(path.read_text())
        rerun = play_match(replay["seed"], replay["format"], replay["bots"],
                           replay["lineages"])
        assert rerun["chain"] == replay["chain"], f"golden mismatch: {path.name}"
        assert rerun["hashes"] == replay["hashes"], f"golden mismatch: {path.name}"


def test_verify_replay_with_recorded_orders():
    replay = play_match(77, "1v1", ["rush", "turtle"], record_orders=True)
    assert verify_replay(replay)
