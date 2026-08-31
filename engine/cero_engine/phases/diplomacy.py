"""Phase 2: structured diplomacy (no free text between agents).

Timeline: proposals registered on turn T are visible to the target on T+1 and
expire after 2 turns. Accepting activates the truce/pact the same turn. Breaking
a truce is announced and takes effect the following turn.
"""

from __future__ import annotations

from cero_engine import rules
from cero_engine.state import State


def _truce(state: State, a: int, b: int):
    for t in state.diplomacy["truces"]:
        if {t["a"], t["b"]} == {a, b}:
            return t
    return None


def diplomacy_phase(state: State, ctx) -> None:
    diplo = state.diplomacy

    # Expire stale proposals, truces and joint pacts.
    diplo["proposals"] = [p for p in diplo["proposals"]
                          if p["created_turn"] + rules.PROPOSAL_EXPIRES_TURNS >= state.turn
                          and state.players[p["from"]].alive and state.players[p["to"]].alive]
    diplo["truces"] = [t for t in diplo["truces"] if t["until_turn"] >= state.turn]
    diplo["joint"] = [j for j in diplo["joint"] if j["until_turn"] >= state.turn]

    # Announced breaks become effective now.
    remaining_breaks = []
    for br in diplo["breaks"]:
        if br["effective_turn"] > state.turn:
            remaining_breaks.append(br)
            continue
        t = _truce(state, br["from"], br["against"])
        if t is not None:
            diplo["truces"].remove(t)
        had_joint = any({j["a"], j["b"]} == {br["from"], br["against"]} for j in diplo["joint"])
        diplo["joint"] = [j for j in diplo["joint"]
                         if {j["a"], j["b"]} != {br["from"], br["against"]}]
        ctx.emit(type="treason" if had_joint else "truce_broken",
                 by=br["from"], against=br["against"])
    diplo["breaks"] = remaining_breaks

    # This turn's diplomacy intents, processed by player id then submission order.
    for pid in sorted(ctx.intakes):
        for action in ctx.intakes[pid].diplomacy:
            _apply_action(state, ctx, action)


def _apply_action(state: State, ctx, action: dict) -> None:
    diplo = state.diplomacy
    kind = action["action"]
    by, target, against = action["by"], action["target"], action.get("against")

    if kind == "propose_truce":
        reverse = next((p for p in diplo["proposals"]
                        if p["kind"] == "truce" and p["from"] == target and p["to"] == by), None)
        if reverse is not None:
            diplo["proposals"].remove(reverse)
            _activate_truce(state, ctx, by, target)
            return
        if _truce(state, by, target) is None:
            diplo["proposals"].append({"kind": "truce", "from": by, "to": target,
                                       "created_turn": state.turn})

    elif kind == "accept_truce":
        prop = next((p for p in diplo["proposals"]
                     if p["kind"] == "truce" and p["from"] == target and p["to"] == by), None)
        if prop is None:
            ctx.errors[by].append({"actor_id": None, "type": "diplomacy", "code": "no_proposal",
                                   "message": "no truce proposal from that player"})
            return
        diplo["proposals"].remove(prop)
        _activate_truce(state, ctx, by, target)

    elif kind == "break_truce":
        if _truce(state, by, target) is None:
            ctx.errors[by].append({"actor_id": None, "type": "diplomacy", "code": "no_truce",
                                   "message": "no active truce with that player"})
            return
        if not any(b["from"] == by and b["against"] == target for b in diplo["breaks"]):
            diplo["breaks"].append({"from": by, "against": target,
                                    "effective_turn": state.turn + 1})
            ctx.emit(type="truce_break_announced", by=by, against=target)

    elif kind == "propose_joint_attack":
        reverse = next((p for p in diplo["proposals"]
                        if p["kind"] == "joint" and p["from"] == target and p["to"] == by
                        and p.get("against") == against), None)
        if reverse is not None:
            diplo["proposals"].remove(reverse)
            _activate_joint(state, ctx, by, target, against)
            return
        diplo["proposals"].append({"kind": "joint", "from": by, "to": target,
                                   "against": against, "created_turn": state.turn})

    elif kind == "accept_joint_attack":
        prop = next((p for p in diplo["proposals"]
                     if p["kind"] == "joint" and p["from"] == target and p["to"] == by), None)
        if prop is None:
            ctx.errors[by].append({"actor_id": None, "type": "diplomacy", "code": "no_proposal",
                                   "message": "no joint-attack proposal from that player"})
            return
        diplo["proposals"].remove(prop)
        _activate_joint(state, ctx, by, target, prop.get("against", against))


def _activate_truce(state: State, ctx, a: int, b: int) -> None:
    if _truce(state, a, b) is None:
        state.diplomacy["truces"].append({"a": min(a, b), "b": max(a, b),
                                          "until_turn": state.turn + rules.TRUCE_TURNS})
    ctx.emit(type="truce_accepted", a=min(a, b), b=max(a, b))


def _activate_joint(state: State, ctx, a: int, b: int, against: int | None) -> None:
    if against is None:
        return
    _activate_truce(state, ctx, a, b)
    state.diplomacy["joint"].append({"a": min(a, b), "b": max(a, b), "against": against,
                                     "until_turn": state.turn + rules.JOINT_ATTACK_TURNS})
    ctx.emit(type="joint_pact", a=min(a, b), b=max(a, b), against=against)
