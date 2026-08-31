"""Canonical serialization and hash chain (determinism verification)."""

from __future__ import annotations

import hashlib
import json

from cero_engine.state import State


def assert_no_floats(value: object, path: str = "$") -> None:
    """Raise if any float sneaks into a serialized state (ints only, PLAN.md P1)."""
    if isinstance(value, float):
        raise TypeError(f"float found in state at {path}: {value!r}")
    if isinstance(value, dict):
        for k, v in value.items():
            assert_no_floats(v, f"{path}.{k}")
    elif isinstance(value, list):
        for i, v in enumerate(value):
            assert_no_floats(v, f"{path}[{i}]")


def canonical_json(state: State) -> str:
    d = state.to_dict()
    assert_no_floats(d)
    return json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def hash_state(state: State) -> str:
    return hashlib.sha256(canonical_json(state).encode("ascii")).hexdigest()


def chain_hash(prev: str, state_hash: str) -> str:
    return hashlib.sha256(f"{prev}:{state_hash}".encode("ascii")).hexdigest()
