"""Determinism, no-floats, map symmetry, fog invariant and fuzz invariants."""

import json
import pathlib

import pytest

from cero_engine import rules
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
    # Super terrain (s1.2): start veins (2/slot) + scaled center + expansion
    # veins; every vein must have its 180-degree mirror.
    assert len(state.veins) >= 4 * 2  # at least starts + some center pairs
    assert len(state.veins) % 2 == 0
    for key in state.veins:
        x, y = map(int, key.split(","))
        mx, my = state.size - 1 - x, state.size - 1 - y
        assert f"{mx},{my}" in state.veins
    camps = [e for e in state.entities_sorted() if e.type == "camp"]
    assert len(camps) >= 2 and len(camps) % 2 == 0
    # Nomad start (s2.0): nobody owns a building; each crew is 4 workers + 1 striker.
    assert not [e for e in state.entities_sorted() if e.owner >= 0 and e.is_building]
    for p in state.players:
        assert len(state.units_of(p.id)) == rules.START_WORKERS + rules.START_ESCORTS
    # pods mirror too
    for key in state.pods:
        x, y = map(int, key.split(","))
        assert f"{state.size - 1 - x},{state.size - 1 - y}" in state.pods

    ffa = generate_map(99, "ffa4", ["forge", "swarm", "oracle", "parasite"])
    assert len([e for e in ffa.entities_sorted() if e.type == "camp"]) % 4 == 0
    assert len([p for p in ffa.players if state.units_of(p.id) is not None]) == 4
    assert all(len(ffa.units_of(p.id)) == 5 for p in ffa.players)

    ffa3 = generate_map(99, "ffa3", ["forge", "swarm", "oracle"])
    assert all(len(ffa3.units_of(p.id)) == 5 for p in ffa3.players)
    # the empty slot still contributes neutral start veins and pods
    assert len(ffa3.veins) >= 8 and len(ffa3.pods) >= 4 * 7


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
