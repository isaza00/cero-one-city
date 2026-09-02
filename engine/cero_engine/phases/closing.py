"""Phase 10: camp recruiting, eliminations, victory check, fog refresh."""

from __future__ import annotations

from cero_engine import rules
from cero_engine.fog import update_fog
from cero_engine.phases.economy import ruin_building
from cero_engine.score import score
from cero_engine.state import State


def closing_phase(state: State, ctx) -> None:
    _resolve_recruits(state, ctx)

    # Elimination (the AoE2 rule adapted to the nomad start): a player who has
    # founded a city dies with its LAST core; a crew that never founded one dies
    # when it has neither a core site nor a worker left to build one.
    for player in state.players:
        if not player.alive or player.id in ctx.eliminated_now:
            continue
        cores = [b for b in state.buildings_of(player.id) if b.type == "core"]
        workers = [u for u in state.units_of(player.id) if u.type == "worker"]
        if player.founded and not cores:
            ctx.eliminated_now[player.id] = "core"
        elif not player.founded and not cores and not workers:
            ctx.eliminated_now[player.id] = "core"

    for pid in ctx.forfeits:
        if state.players[pid].alive:
            ctx.eliminated_now.setdefault(pid, "abandon")

    # Abandonment also kills the core so the elimination is visible on the map.
    for pid, cause in sorted(ctx.eliminated_now.items()):
        if cause != "abandon":
            continue
        for b in state.buildings_of(pid):
            if b.type == "core":
                for x, y in b.footprint():
                    state.tiles[y][x] = "rubble"
                state.remove_entity(b.id)

    for pid, cause in sorted(ctx.eliminated_now.items()):
        player = state.players[pid]
        if not player.alive:
            continue
        player.alive = False
        player.eliminated_turn = state.turn
        player.eliminated_cause = cause
        # Buildings become lootable ruins; units power down next maintenance.
        for b in state.buildings_of(pid):
            ruin_building(state, b)
            for x, y in b.footprint():
                state.tiles[y][x] = "plain"
            state.remove_entity(b.id)
        # Clean diplomacy involving the eliminated player.
        d = state.diplomacy
        d["truces"] = [t for t in d["truces"] if pid not in (t["a"], t["b"])]
        d["proposals"] = [p for p in d["proposals"] if pid not in (p["from"], p["to"])]
        d["joint"] = [j for j in d["joint"] if pid not in (j["a"], j["b"], j["against"])]
        d["breaks"] = [b for b in d["breaks"] if pid not in (b["from"], b["against"])]
        ctx.emit(type="eliminated", player=pid, cause=cause)

    update_fog(state)
    _check_victory(state, ctx)


def _resolve_recruits(state: State, ctx) -> None:
    recruited_camps: set[int] = set()
    for pid in sorted(ctx.intakes):
        player = state.players[pid]
        if not player.alive:
            continue
        for unit_id, camp_id in ctx.intakes[pid].recruit:
            camp = state.ent(camp_id)
            unit = state.ent(unit_id)
            if camp is None or camp.type != "camp" or camp_id in recruited_camps:
                ctx.errors[pid].append({"actor_id": unit_id, "type": "recruit",
                                        "code": "camp_gone", "message": "camp is gone"})
                continue
            if unit is None or max(abs(unit.x - camp.x), abs(unit.y - camp.y)) > 1:
                continue
            if pid in camp.camp_hostile_to or player.energy < rules.CAMP_RECRUIT_COST_E:
                continue
            player.energy -= rules.CAMP_RECRUIT_COST_E
            recruited = 0
            for guard in state.entities_sorted():
                if (guard.is_unit and guard.owner < 0 and guard.camp_home
                        and tuple(guard.camp_home) == (camp.x, camp.y)):
                    guard.owner = pid
                    guard.camp_home = None
                    guard.camp_hostile_to = []
                    recruited += 1
            recruited_camps.add(camp_id)
            state.remove_entity(camp_id)
            ctx.emit(type="camp_recruited", by=pid, x=camp.x, y=camp.y, humans=recruited)


def _check_victory(state: State, ctx) -> None:
    alive = state.alive_players()
    if len(alive) == 1 and len(state.players) > 1:
        state.finished = True
        state.winner = alive[0].id
        ctx.emit(type="match_end", winner=state.winner, reason="elimination")
        return
    if len(alive) == 0:
        # Mutual destruction on the same turn: rank by score among the last eliminated.
        last_turn = max(p.eliminated_turn or 0 for p in state.players)
        finalists = [p for p in state.players if p.eliminated_turn == last_turn]
        scores = score(state)
        finalists.sort(key=lambda p: (-scores[p.id], -p.damage_dealt, p.id))
        state.finished = True
        state.winner = finalists[0].id
        ctx.emit(type="match_end", winner=state.winner, reason="mutual_destruction")
        return
    if state.turn >= state.max_turns:
        scores = score(state)
        ranked = sorted(alive, key=lambda p: (-scores[p.id], -p.damage_dealt, p.id))
        state.finished = True
        state.winner = ranked[0].id
        ctx.emit(type="match_end", winner=state.winner, reason="points")
