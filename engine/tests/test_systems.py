"""System tests for combat, economy, production, capture, camps and diplomacy."""

from cero_engine import rules
from cero_engine.phases import advance
from cero_engine.score import placements, score
from tests.helpers import add, blank_state, with_cores


def turn(state, orders=None, **kw):
    return advance(state, orders or {}, **kw)


# ------------------------------------------------------------------- combat

def test_striker_kills_worker_and_leaves_scrap():
    state = with_cores(blank_state())
    striker = add(state, 0, "unit", "striker", 5, 5)
    worker = add(state, 1, "unit", "worker", 6, 5)
    turn(state, {0: [{"actor_id": striker.id, "type": "attack", "target_id": worker.id}]})
    # striker atk 8 - 0 armor = 8; worker 20 hp -> 3 hits
    assert state.ent(worker.id).hp == 12
    turn(state)  # standing order persists
    turn(state)
    assert state.ent(worker.id) is None
    assert state.scrap.get("6,5", {}).get("m", 0) >= rules.SCRAP_FROM_UNIT_MIN


def test_counter_triangle_damage():
    state = with_cores(blank_state(players=2, lineages=["forge", "forge"]))
    launcher = add(state, 0, "unit", "launcher", 5, 5)
    striker = add(state, 1, "unit", "striker", 7, 5)
    turn(state, {0: [{"actor_id": launcher.id, "type": "attack", "target_id": striker.id}]})
    # launcher 7 +4 vs infantry -1 armor = 10
    assert state.ent(striker.id).hp == rules.UNITS["striker"]["hp"] - 10


def test_melee_cannot_hit_air_without_tech():
    state = with_cores(blank_state())
    striker = add(state, 0, "unit", "striker", 5, 5)
    wasp = add(state, 1, "unit", "wasp", 6, 5)
    _, _, errors = turn(state, {0: [{"actor_id": striker.id, "type": "attack",
                                     "target_id": wasp.id}]})
    assert state.ent(wasp.id).hp == rules.UNITS["wasp"]["hp"] - rules.SWARM_HP_MALUS * 0  # untouched
    state.players[0].techs.append("anti_air")
    turn(state)
    assert state.ent(wasp.id).hp < rules.UNITS["wasp"]["hp"]  # 50% melee damage now applies


def test_mutual_kill_is_simultaneous():
    state = with_cores(blank_state())
    a = add(state, 0, "unit", "striker", 5, 5, hp=5)
    b = add(state, 1, "unit", "striker", 6, 5, hp=5)
    turn(state, {0: [{"actor_id": a.id, "type": "attack", "target_id": b.id}],
                 1: [{"actor_id": b.id, "type": "attack", "target_id": a.id}]})
    assert state.ent(a.id) is None and state.ent(b.id) is None


def test_core_damage_cap_and_elimination():
    state = blank_state()
    core0 = add(state, 0, "building", "core", 0, 0)
    add(state, 1, "building", "core", 10, 10)
    towers = [add(state, 1, "unit", "walking_tower", 2 + i, 3) for i in range(5)]
    orders = {1: [{"actor_id": t.id, "type": "attack", "target_id": core0.id} for t in towers]}
    turn(state, orders)
    # 5 towers x (20+20) = 200 raw, capped at 150/turn
    assert state.ent(core0.id).hp == rules.BUILDINGS["core"]["hp"] - rules.CORE_DAMAGE_CAP_PER_TURN
    turn(state)
    turn(state)
    assert state.ent(core0.id) is None
    assert not state.players[0].alive
    assert state.players[0].eliminated_turn == 3
    assert state.finished and state.winner == 1


def test_rack_cascade_chains():
    state = with_cores(blank_state())
    r1 = add(state, 1, "building", "rack", 5, 5, hp=5)
    r2 = add(state, 1, "building", "rack", 6, 5, hp=8)
    worker = add(state, 1, "unit", "worker", 5, 6, hp=15)
    striker = add(state, 0, "unit", "striker", 4, 5)
    turn(state, {0: [{"actor_id": striker.id, "type": "attack", "target_id": r1.id}]})
    assert state.ent(r1.id) is None
    assert state.ent(r2.id) is None       # 10 cascade kills the 8hp rack next to it
    assert state.ent(worker.id) is None   # adjacent to both racks: 20 cascade damage > 15 hp


def test_cocoon_burst_hits_attacker_too():
    state = with_cores(blank_state())
    cocoon = add(state, 1, "building", "cocoon", 6, 5, hp=8, accumulator=40)
    striker = add(state, 0, "unit", "striker", 5, 5)
    turn(state, {0: [{"actor_id": striker.id, "type": "attack", "target_id": cocoon.id}]})
    assert state.ent(cocoon.id) is None
    # burst = 40 // 4 = 10 damage to the adjacent attacker
    assert state.ent(striker.id).hp == rules.UNITS["striker"]["hp"] - 10


# ------------------------------------------------------------------ economy

def test_upkeep_blackout_makes_units_stiff():
    state = with_cores(blank_state())
    state.players[0].energy = 1
    u1 = add(state, 0, "unit", "striker", 5, 5)
    u2 = add(state, 0, "unit", "striker", 6, 6)
    turn(state)
    stiff = [state.ent(u1.id).stiff, state.ent(u2.id).stiff]
    assert stiff.count(True) == 1  # only one upkeep could be paid
    assert any(e["type"] == "blackout" for e in state.events_last_turn)


def test_harvest_mine_and_vein_depletion():
    state = with_cores(blank_state())
    state.tiles[5][5] = "vein"
    state.veins["5,5"] = 10
    w1 = add(state, 0, "unit", "worker", 6, 5)
    add(state, 0, "building", "cocoon", 2, 2)
    w2 = add(state, 0, "unit", "worker", 3, 2)
    e0, m0 = state.players[0].energy, state.players[0].metal
    turn(state, {0: [
        {"actor_id": w1.id, "type": "gather", "target": [5, 5]},
        {"actor_id": w2.id, "type": "gather", "target": [2, 2]},
    ]})
    p = state.players[0]
    upkeep = 2 * rules.UPKEEP_PER_UNIT
    assert p.metal == m0 + 6
    assert p.energy == e0 + rules.HARVEST_ENERGY - upkeep
    turn(state)  # mines the remaining 4, vein depletes
    assert "5,5" not in state.veins
    assert state.tiles[5][5] == "plain"


def test_repair_costs_metal():
    state = with_cores(blank_state())
    rack = add(state, 0, "building", "rack", 5, 5, hp=20)
    worker = add(state, 0, "unit", "worker", 6, 5)
    m0 = state.players[0].metal
    turn(state, {0: [{"actor_id": worker.id, "type": "repair", "target_id": rack.id}]})
    assert state.ent(rack.id).hp == 30  # +10, capped at max 40 next turn
    assert state.players[0].metal == m0 - rules.REPAIR_METAL_COST


# --------------------------------------------------------------- production

def test_worker_production_and_compute_cap():
    state = with_cores(blank_state())
    core = next(b for b in state.buildings_of(0) if b.type == "core")
    turn(state, {0: [{"actor_id": core.id, "type": "produce", "unit": "worker"}]})
    assert len(state.units_of(0)) == 0          # ordered T1, spawns T2
    turn(state)
    assert len(state.units_of(0)) == 1
    # Fill compute to the cap (core provides 8): 8 workers total.
    for _ in range(9):
        c = state.ent(core.id)
        if not c.production:
            turn(state, {0: [{"actor_id": core.id, "type": "produce", "unit": "worker"}]})
        else:
            turn(state)
    assert len(state.units_of(0)) <= rules.COMPUTE_CORE


def test_build_rack_takes_two_turns():
    state = with_cores(blank_state())
    worker = add(state, 0, "unit", "worker", 5, 5)
    turn(state, {0: [{"actor_id": worker.id, "type": "build", "building": "rack",
                      "anchor": [6, 5]}]})
    rack = next(b for b in state.buildings_of(0) if b.type == "rack")
    assert rack.build_progress == 2
    turn(state)
    turn(state)
    assert state.ent(rack.id).build_progress == 0


def test_research_firmware_and_unlock():
    state = with_cores(blank_state())
    core = next(b for b in state.buildings_of(0) if b.type == "core")
    add(state, 0, "building", "assembler", 4, 4)
    turn(state, {0: [{"actor_id": core.id, "type": "research", "tech": "firmware_v2"}]})
    assembler = next(b for b in state.buildings_of(0) if b.type == "assembler")
    _, _, errors = turn(state, {0: [{"actor_id": assembler.id, "type": "produce",
                                     "unit": "launcher"}]})
    assert any(e["code"] == "need_firmware" for e in errors[0])
    turn(state)  # research completes (2 turns after start... started turn1, done turn3)
    assert state.players[0].firmware == "v2"
    turn(state, {0: [{"actor_id": assembler.id, "type": "produce", "unit": "launcher"}]})
    turn(state)
    assert any(u.type == "launcher" for u in state.units_of(0))


def test_colossus_fusion():
    state = with_cores(blank_state())
    state.players[0].firmware = "v3"
    strikers = [add(state, 0, "unit", "striker", 4 + i, 4) for i in range(5)]
    ids = [s.id for s in strikers]
    turn(state, {0: [{"actor_id": ids[0], "type": "fuse", "unit_ids": ids}]})
    turn(state)
    units = state.units_of(0)
    assert [u.type for u in units] == ["colossus"]
    assert (units[0].x, units[0].y) == (4, 4)


# ------------------------------------------------------------------ capture

def test_parasite_captures_rack_in_three_turns():
    state = with_cores(blank_state(players=2, lineages=["parasite", "forge"]))
    rack = add(state, 1, "building", "rack", 6, 5)
    leech = add(state, 0, "unit", "leech", 5, 5)
    turn(state, {0: [{"actor_id": leech.id, "type": "capture", "target_id": rack.id}]})
    assert state.ent(rack.id).capture is not None
    turn(state)
    turn(state)
    assert state.ent(rack.id).owner == 0
    assert state.ent(rack.id).was_captured


def test_defender_repels_capture():
    state = with_cores(blank_state(players=2, lineages=["parasite", "forge"]))
    rack = add(state, 1, "building", "rack", 6, 5)
    leech = add(state, 0, "unit", "leech", 5, 5, hp=100)
    add(state, 1, "unit", "striker", 7, 5)
    turn(state, {0: [{"actor_id": leech.id, "type": "capture", "target_id": rack.id}]})
    state.remove_entity(leech.id)  # leech leaves the fight
    turn(state)
    assert state.ent(rack.id).capture is None  # defender adjacent, counter back to 0
    assert state.ent(rack.id).owner == 1


# -------------------------------------------------------------------- camps

def test_loot_camp_grants_resources_and_hostility():
    state = with_cores(blank_state())
    camp = add(state, -1, "building", "camp", 6, 6)
    guard = add(state, -1, "unit", "human", 6, 7, camp_home=[6, 6])
    tower = add(state, 0, "unit", "walking_tower", 4, 6)
    e0, m0 = state.players[0].energy, state.players[0].metal
    turn(state, {0: [{"actor_id": tower.id, "type": "attack", "target_id": camp.id}]})
    turn(state)
    assert state.ent(camp.id) is None
    p = state.players[0]
    assert p.energy >= e0 + rules.CAMP_LOOT_ENERGY - 10  # minus upkeep
    assert p.metal == m0 + rules.CAMP_LOOT_METAL
    assert state.ent(guard.id).camp_hostile_to == [0]


def test_recruit_camp_transfers_guards():
    state = with_cores(blank_state())
    camp = add(state, -1, "building", "camp", 6, 6)
    g1 = add(state, -1, "unit", "human", 6, 7, camp_home=[6, 6])
    g2 = add(state, -1, "unit", "human", 7, 6, camp_home=[6, 6])
    unit = add(state, 0, "unit", "striker", 5, 6)
    turn(state, {0: [{"actor_id": unit.id, "type": "recruit", "target_id": camp.id}]})
    assert state.ent(camp.id) is None
    assert state.ent(g1.id).owner == 0 and state.ent(g2.id).owner == 0
    assert any(e["type"] == "camp_recruited" for e in state.events_last_turn)


# ---------------------------------------------------------------- diplomacy

def test_truce_lifecycle_and_illegal_attack():
    state = with_cores(blank_state())
    a = add(state, 0, "unit", "striker", 5, 5)
    add(state, 1, "unit", "striker", 6, 5)
    turn(state, {0: [{"type": "diplomacy", "action": "propose_truce", "target_player": 1}]})
    turn(state, {1: [{"type": "diplomacy", "action": "accept_truce", "target_player": 0}]})
    assert state.diplomacy["truces"]
    b_id = state.units_of(1)[0].id
    _, _, errors = turn(state, {0: [{"actor_id": a.id, "type": "attack", "target_id": b_id}]})
    assert any(e["code"] == "truce" for e in errors[0])
    turn(state, {0: [{"type": "diplomacy", "action": "break_truce", "target_player": 1}]})
    turn(state)  # break takes effect the following turn
    assert not state.diplomacy["truces"]
    assert any(e["type"] == "truce_broken" for e in state.events_last_turn)


def test_abandon_forfeit_leaves_ruins():
    state = with_cores(blank_state())
    add(state, 1, "building", "rack", 8, 8)
    turn(state, {}, forfeits=(1,))
    assert not state.players[1].alive
    assert state.players[1].eliminated_cause == "abandon"
    assert state.finished and state.winner == 0
    assert state.scrap.get("8,8", {}).get("m") == rules.BUILDINGS["rack"]["cost_m"] // 2


# -------------------------------------------------------------------- score

def test_score_and_placements():
    state = with_cores(blank_state())
    add(state, 0, "unit", "striker", 5, 5)
    scores = score(state)
    base = state.players[0].energy + state.players[0].metal
    assert scores[0] == base + 35 + 2 * rules.CORE_SCORE_COST
    order = placements(state)
    assert set(order) == {0, 1}
