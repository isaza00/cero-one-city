"""Scoring and final placements (PLAN.md §3.11).

S = bank (E+M)
  + sum of base costs of living units (colossus counts 175)
  + 2 x sum of base costs of standing buildings (core counts 200)
  + 25 x researched techs
  + total damage dealt (post core-cap)
  + 100 x enemy cores destroyed (last hit)
  + 50 x captured racks still held
"""

from __future__ import annotations

from cero_engine import rules
from cero_engine.state import State


def _unit_value(utype: str) -> int:
    if utype == "colossus":
        return rules.COLOSSUS_SCORE_COST
    spec = rules.UNITS[utype]
    return spec["cost_e"] + spec["cost_m"]


def _building_value(btype: str) -> int:
    if btype == "core":
        return rules.CORE_SCORE_COST
    spec = rules.BUILDINGS[btype]
    return spec["cost_e"] + spec["cost_m"]


def score(state: State) -> dict[int, int]:
    out: dict[int, int] = {}
    for player in state.players:
        total = player.energy + player.metal
        for e in state.entities_sorted():
            if e.owner != player.id:
                continue
            if e.is_unit:
                total += _unit_value(e.type)
            else:
                total += rules.SCORE_BUILDING_MULT * _building_value(e.type)
                if e.type == "rack" and e.was_captured:
                    total += rules.SCORE_PER_HELD_CAPTURED_RACK
        total += rules.SCORE_PER_TECH * len(player.techs)
        total += player.damage_dealt
        total += rules.SCORE_PER_CORE_KILL * player.core_kills
        out[player.id] = total
    return out


def placements(state: State) -> list[int]:
    """Player ids ordered best to worst: survivors first (score, damage, id),
    then eliminated players by elimination turn (later = better), score, damage."""
    scores = score(state)
    alive = sorted([p for p in state.players if p.alive],
                   key=lambda p: (-scores[p.id], -p.damage_dealt, p.id))
    dead = sorted([p for p in state.players if not p.alive],
                  key=lambda p: (-(p.eliminated_turn or 0), -scores[p.id],
                                 -p.damage_dealt, p.id))
    return [p.id for p in alive + dead]
