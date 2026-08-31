"""Elo (PLAN.md §8): K=32; K=16 when the pair includes a house agent; FFA is
decomposed into pairwise results by exit order, each pair using K/(n-1)."""

from __future__ import annotations

K_BASE = 32
K_HOUSE = 16
INITIAL_ELO = 1000


def expected(ra: int, rb: int) -> float:
    return 1.0 / (1.0 + 10 ** ((rb - ra) / 400.0))


def duel_delta(ra: int, rb: int, score_a: float, k: int) -> int:
    return round(k * (score_a - expected(ra, rb)))


def match_deltas(entries: list[dict], placements: list[int]) -> dict[int, int]:
    """entries: [{player_index, elo, is_house}]. Returns player_index -> delta.
    Every ordered pair (better placed vs worse placed) is a 1/0 duel."""
    n = len(entries)
    by_index = {e["player_index"]: e for e in entries}
    order = {pid: pos for pos, pid in enumerate(placements)}
    deltas: dict[int, int] = {e["player_index"]: 0 for e in entries}
    if n < 2:
        return deltas
    pair_k_scale = n - 1
    for i, a in enumerate(entries):
        for b in entries[i + 1:]:
            k = K_HOUSE if (a["is_house"] or b["is_house"]) else K_BASE
            k = max(k // pair_k_scale, 1) if pair_k_scale > 1 else k
            a_wins = order[a["player_index"]] < order[b["player_index"]]
            da = duel_delta(a["elo"], b["elo"], 1.0 if a_wins else 0.0, k)
            deltas[a["player_index"]] += da
            deltas[b["player_index"]] += duel_delta(b["elo"], a["elo"],
                                                    0.0 if a_wins else 1.0, k)
    _ = by_index
    return deltas
