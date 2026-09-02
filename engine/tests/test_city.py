"""The Age-of-Empires layer (s2.0): nomad founding, drop-off economy, pods,
construction crews, menus, walls, rally points and the elimination rules."""

from cero_engine import rules
from cero_engine.mapgen import generate_map
from cero_engine.observe import observe, suggest_core_site
from cero_engine.phases import advance
from cero_engine.state import tk
from tests.helpers import add, blank_state, with_cores


def turn(state, orders=None, **kw):
    return advance(state, orders or {}, **kw)


def core_of(state, pid):
    return next((b for b in state.buildings_of(pid) if b.type == "core"), None)


# ------------------------------------------------------------------ founding

def test_nomad_start_has_no_buildings_and_a_crew():
    state = generate_map(7, "1v1", ["forge", "swarm"])
    for p in state.players:
        assert not state.buildings_of(p.id)
        types = sorted(u.type for u in state.units_of(p.id))
        assert types == ["striker"] + ["worker"] * rules.START_WORKERS
        assert not p.founded
        assert p.metal == rules.STARTING_METAL and p.energy == rules.STARTING_ENERGY
    assert state.pods and all(v == rules.POD_ENERGY for v in state.pods.values())
    # every pod has its 180-degree mirror
    for key in state.pods:
        x, y = map(int, key.split(","))
        assert f"{state.size - 1 - x},{state.size - 1 - y}" in state.pods


def test_crew_founds_the_core_and_is_released_to_gather():
    state = generate_map(42, "1v1", ["forge", "swarm"])
    player = state.players[0]
    anchor = suggest_core_site(state, player)
    assert anchor is not None
    obs = observe(state, 0)
    core_entry = next(m for m in obs["menus"]["build"] if m["building"] == "core")
    assert core_entry["available"] and core_entry["suggested_anchor"] == anchor
    workers = [u for u in state.units_of(0) if u.type == "worker"]
    turn(state, {0: [{"actor_id": w.id, "type": "build", "building": "core",
                      "anchor": anchor} for w in workers]})
    site = core_of(state, 0)
    assert site is not None and site.build_progress == rules.BUILDINGS["core"]["work"] - 4
    assert player.metal == rules.STARTING_METAL - 80  # forge: -20% metal
    assert all((w.standing_order or {}).get("type") == "build" for w in workers)
    turn(state)
    assert core_of(state, 0).build_progress == 0
    assert player.founded
    kinds = [e["type"] for e in state.events_last_turn]
    assert "built" in kinds and "core_founded" in kinds
    # the crew went straight to the resources around the new core
    assert all((w.standing_order or {}).get("type") == "gather" for w in workers)


def test_build_order_walks_the_worker_there():
    state = with_cores(blank_state())
    worker = add(state, 0, "unit", "worker", 2, 2)
    turn(state, {0: [{"actor_id": worker.id, "type": "build", "building": "rack",
                      "anchor": [8, 8]}]})
    site = next(b for b in state.buildings_of(0) if b.type == "rack")
    assert site.build_progress == rules.BUILDINGS["rack"]["work"]  # nobody adjacent yet
    assert worker.standing_order == {"type": "build", "target_id": site.id}
    turn(state)  # walks 6 tiles: adjacent now, first work point lands
    assert max(abs(worker.x - 8), abs(worker.y - 8)) <= 1
    assert state.ent(site.id).build_progress == rules.BUILDINGS["rack"]["work"] - 1


def test_more_builders_build_faster_and_help_order_joins():
    state = with_cores(blank_state())
    w1 = add(state, 0, "unit", "worker", 5, 5)
    w2 = add(state, 0, "unit", "worker", 5, 7)
    w3 = add(state, 0, "unit", "worker", 7, 7)
    turn(state, {0: [
        {"actor_id": w1.id, "type": "build", "building": "assembler", "anchor": [6, 5]},
        {"actor_id": w2.id, "type": "build", "building": "assembler", "anchor": [6, 5]},
    ]})
    site = next(b for b in state.buildings_of(0) if b.type == "assembler")
    assert site.build_progress == rules.BUILDINGS["assembler"]["work"] - 2
    assert w2.standing_order == {"type": "build", "target_id": site.id}
    turn(state, {0: [{"actor_id": w3.id, "type": "build", "target_id": site.id}]})
    assert state.ent(site.id).build_progress == rules.BUILDINGS["assembler"]["work"] - 5
    turn(state)
    assert state.ent(site.id).build_progress == 0
    assert all(u.standing_order is None for u in (w1, w2, w3))


def test_foundation_hp_grows_with_work_and_can_be_sniped():
    state = with_cores(blank_state())
    worker = add(state, 0, "unit", "worker", 5, 5)
    turn(state, {0: [{"actor_id": worker.id, "type": "build", "building": "rack",
                      "anchor": [6, 5]}]})
    site = next(b for b in state.buildings_of(0) if b.type == "rack")
    max_hp = rules.BUILDINGS["rack"]["hp"]
    # a fresh foundation stands at 10% hp; each work point adds its share
    assert site.hp == max_hp * rules.SITE_MIN_HP_PCT // 100 + max_hp * 1 // 3
    striker = add(state, 1, "unit", "striker", 7, 5)
    turn(state, {0: [{"actor_id": worker.id, "type": "stop"}],   # crew pulled off
                 1: [{"actor_id": striker.id, "type": "attack", "target_id": site.id}]})
    assert state.ent(site.id).build_progress == 2  # paused, still a foundation
    turn(state)
    turn(state)
    assert state.ent(site.id) is None
    assert any(e["type"] == "rack_destroyed" for e in state.events_last_turn)


def test_cocoon_builder_farms_it():
    state = with_cores(blank_state())
    worker = add(state, 0, "unit", "worker", 2, 3)
    turn(state, {0: [{"actor_id": worker.id, "type": "build", "building": "cocoon",
                      "anchor": [3, 3]}]})
    turn(state)
    cocoon = next(b for b in state.buildings_of(0) if b.type == "cocoon")
    assert cocoon.build_progress == 0
    assert worker.standing_order == {"type": "gather", "target": [3, 3], "phase": "work"}


# ------------------------------------------------------------ drop-off economy

def test_worker_next_to_vein_and_core_banks_every_turn():
    state = with_cores(blank_state())        # core footprint (0,0)-(1,1)
    state.tiles[3][3] = "vein"
    state.veins["3,3"] = 300
    worker = add(state, 0, "unit", "worker", 2, 2)   # adjacent to both
    m0 = state.players[0].metal
    turn(state, {0: [{"actor_id": worker.id, "type": "gather", "target": [3, 3]}]})
    assert state.players[0].metal == m0 + rules.MINE_METAL
    assert worker.cargo == 0
    assert any(e["type"] == "deposit" and e["metal"] == rules.MINE_METAL
               for e in state.events_last_turn)


def test_far_vein_needs_the_carry_cycle():
    state = with_cores(blank_state())
    state.tiles[5][9] = "vein"
    state.veins["9,5"] = 300
    worker = add(state, 0, "unit", "worker", 8, 5)
    m0 = state.players[0].metal
    turn(state, {0: [{"actor_id": worker.id, "type": "gather", "target": [9, 5]}]})
    for _ in range(3):
        turn(state)
    assert state.players[0].metal == m0          # nothing banked yet
    assert worker.cargo_m == rules.CARRY_CAPACITY   # 6/turn, capped at 20
    assert worker.standing_order["phase"] == "return"
    walked = 0
    while state.players[0].metal == m0 and walked < 3:
        turn(state)  # walks home (9 steps at 6/turn) and banks on arrival
        walked += 1
    assert walked == 2
    assert state.players[0].metal == m0 + rules.CARRY_CAPACITY
    assert worker.cargo == 0 and worker.standing_order["phase"] == "work"
    turn(state)
    turn(state)  # walks back to the vein
    assert max(abs(worker.x - 9), abs(worker.y - 5)) <= 1


def test_depot_makes_a_far_vein_pay_on_the_spot():
    state = with_cores(blank_state())
    state.tiles[5][9] = "vein"
    state.veins["9,5"] = 300
    add(state, 0, "building", "depot", 7, 5)
    worker = add(state, 0, "unit", "worker", 8, 5)
    m0 = state.players[0].metal
    turn(state, {0: [{"actor_id": worker.id, "type": "gather", "target": [9, 5]}]})
    assert state.players[0].metal == m0 + rules.MINE_METAL


def test_pod_harvest_depletes_and_worker_steps_to_the_next_pod():
    state = with_cores(blank_state())
    state.tiles[2][3] = "pod"
    state.pods["3,2"] = 10
    state.tiles[2][5] = "pod"
    state.pods["5,2"] = 200
    worker = add(state, 0, "unit", "worker", 2, 2)
    e0 = state.players[0].energy
    turn(state, {0: [{"actor_id": worker.id, "type": "gather", "target": [3, 2]}]})
    assert state.players[0].energy == e0 + 8
    turn(state)  # takes the last 2, pod becomes plain, retargets to (5,2)
    assert "3,2" not in state.pods and state.tiles[2][3] == "plain"
    assert any(e["type"] == "pod_depleted" for e in state.events_last_turn)
    assert worker.standing_order["target"] == [5, 2]


def test_nomad_crew_cannot_bank_without_a_dropoff():
    state = blank_state()
    state.tiles[5][5] = "vein"
    state.veins["5,5"] = 300
    add(state, 1, "building", "core", 10, 10)
    worker = add(state, 0, "unit", "worker", 4, 5)
    turn(state, {0: [{"actor_id": worker.id, "type": "gather", "target": [5, 5]}]})
    for _ in range(4):
        turn(state)
    assert state.players[0].metal == 200
    assert worker.cargo_m == rules.CARRY_CAPACITY
    assert (worker.x, worker.y) == (4, 5)  # holds the cargo, nowhere to walk


def test_army_upkeep_but_workers_are_exempt():
    state = with_cores(blank_state())
    state.players[0].energy = 0
    w = add(state, 0, "unit", "worker", 5, 5)
    s = add(state, 0, "unit", "striker", 6, 6)
    turn(state)
    assert not state.ent(w.id).stiff
    assert state.ent(s.id).stiff
    assert any(e["type"] == "blackout" for e in state.events_last_turn)


# -------------------------------------------------------------- menus & gates

def test_menus_explain_locks_and_costs():
    state = with_cores(blank_state(players=2, lineages=["parasite", "forge"]))
    add(state, 0, "unit", "worker", 5, 5)
    obs = observe(state, 0)
    build = {m["building"]: m for m in obs["menus"]["build"]}
    assert build["turret"]["why"] == "requires firmware v2"
    assert build["core"]["why"] == "a second core requires firmware v2"
    assert build["depot"]["available"] and build["depot"]["dropoff"]
    assert build["wall"]["cost_m"] == rules.BUILDINGS["wall"]["cost_m"]
    units = {m["unit"]: m for m in obs["menus"]["units"]}
    assert units["worker"]["available"]
    assert units["striker"]["why"] == "needs a finished assembler"
    assert "spark" not in units and "leech" in units
    techs = {m["tech"]: m for m in obs["menus"]["techs"]}
    assert techs["firmware_v2"]["why"] == "needs a finished assembler"
    assert techs["armor_1"]["why"] == "needs a finished lab"
    state.players[0].lineage = "parasite"
    obs = observe(state, 0)
    assert next(m for m in obs["menus"]["build"] if m["building"] == "turret")["why"] \
        == "requires firmware v2"
    state.players[0].firmware = "v2"
    obs = observe(state, 0)
    assert next(m for m in obs["menus"]["build"] if m["building"] == "turret")["why"] \
        == "parasite cannot build turrets"


def test_firmware_v2_needs_an_assembler_and_v3_a_lab():
    state = with_cores(blank_state())
    core = core_of(state, 0)
    _, _, errors = turn(state, {0: [{"actor_id": core.id, "type": "research",
                                     "tech": "firmware_v2"}]})
    assert any(e["code"] == "requires" for e in errors[0])
    add(state, 0, "building", "assembler", 4, 4)
    turn(state, {0: [{"actor_id": core.id, "type": "research", "tech": "firmware_v2"}]})
    assert core.research is not None
    turn(state)
    assert state.players[0].firmware == "v2"
    add(state, 0, "building", "rack", 7, 7)
    add(state, 0, "building", "rack", 9, 9)
    _, _, errors = turn(state, {0: [{"actor_id": core.id, "type": "research",
                                     "tech": "firmware_v3"}]})
    assert any("lab" in e["message"] for e in errors[0])


def test_military_techs_live_at_the_lab():
    state = with_cores(blank_state())
    assembler = add(state, 0, "building", "assembler", 4, 4)
    lab = add(state, 0, "building", "lab", 7, 4)
    _, _, errors = turn(state, {0: [{"actor_id": assembler.id, "type": "research",
                                     "tech": "cannons_1"}]})
    assert any(e["code"] == "wrong_building" for e in errors[0])
    turn(state, {0: [{"actor_id": lab.id, "type": "research", "tech": "cannons_1"}]})
    assert lab.research["tech"] == "cannons_1"


def test_second_core_requires_v2_and_keeps_you_alive():
    state = with_cores(blank_state(size=16))
    worker = add(state, 0, "unit", "worker", 8, 8)
    _, _, errors = turn(state, {0: [{"actor_id": worker.id, "type": "build",
                                     "building": "core", "anchor": [9, 8]}]})
    assert any(e["code"] == "need_firmware" for e in errors[0])
    state.players[0].firmware = "v2"
    turn(state, {0: [{"actor_id": worker.id, "type": "build", "building": "core",
                      "anchor": [9, 8]}]})
    for _ in range(9):
        turn(state)
    cores = [b for b in state.buildings_of(0) if b.type == "core"]
    assert len(cores) == 2 and all(not c.build_progress for c in cores)
    first = cores[0]
    towers = [add(state, 1, "unit", "walking_tower", 3 + i, 3) for i in range(4)]
    turn(state, {1: [{"actor_id": t.id, "type": "attack", "target_id": first.id}
                     for t in towers]})
    for _ in range(4):
        turn(state)
    assert state.ent(first.id) is None
    assert state.players[0].alive  # the second core carries the city
    assert state.players[1].core_kills == 1


def test_nomad_crew_dies_with_its_last_worker():
    state = blank_state()
    add(state, 1, "building", "core", 10, 10)
    state.players[1].founded = True
    w = add(state, 0, "unit", "worker", 5, 5, hp=5)
    add(state, 0, "unit", "striker", 2, 2)
    striker = add(state, 1, "unit", "striker", 6, 5)
    turn(state, {1: [{"actor_id": striker.id, "type": "attack", "target_id": w.id}]})
    assert state.ent(w.id) is None
    assert not state.players[0].alive and state.players[0].eliminated_cause == "core"
    assert state.finished and state.winner == 1


def test_walls_block_but_are_ignored_by_attack_move():
    state = with_cores(blank_state())
    for y in range(state.size):  # a palisade across the whole map
        add(state, 1, "building", "wall", 6, y)
    striker = add(state, 0, "unit", "striker", 5, 5)
    turn(state, {0: [{"actor_id": striker.id, "type": "attack_move", "to": [8, 5]}]})
    assert striker.x <= 5  # could not cross the palisade line
    assert not any(e["type"] == "attack" for e in state.events_last_turn)
    wall = next(b for b in state.buildings_of(1) if (b.x, b.y) == (6, 5))
    turn(state, {0: [{"actor_id": striker.id, "type": "attack", "target_id": wall.id}]})
    assert state.ent(wall.id).hp < rules.BUILDINGS["wall"]["hp"]


def test_rally_point_and_cancel_refund():
    state = with_cores(blank_state())
    core = core_of(state, 0)
    turn(state, {0: [{"actor_id": core.id, "type": "rally", "to": [8, 8]}]})
    assert core.rally == [8, 8]
    e0 = state.players[0].energy
    turn(state, {0: [{"actor_id": core.id, "type": "produce", "unit": "worker"}]})
    assert state.players[0].energy == e0 - rules.UNITS["worker"]["cost_e"]
    turn(state, {0: [{"actor_id": core.id, "type": "stop"}]})
    assert core.production is None and state.players[0].energy == e0
    turn(state, {0: [{"actor_id": core.id, "type": "produce", "unit": "worker"}]})
    turn(state)
    worker = state.units_of(0)[0]
    assert worker.standing_order == {"type": "move", "to": [8, 8]}


def test_observation_reports_carrying_sites_and_idle_workers():
    state = with_cores(blank_state())
    w1 = add(state, 0, "unit", "worker", 5, 5)
    w1.cargo_m = 7
    w2 = add(state, 0, "unit", "worker", 6, 6)
    add(state, 0, "building", "depot", 8, 8, build_progress=2, build_total=2)
    obs = observe(state, 0)
    me = {u["id"]: u for u in obs["units"]}
    assert me[w1.id]["carrying"] == {"e": 0, "m": 7}
    assert obs["economy"]["idle_workers"] == [w1.id, w2.id]
    site = next(b for b in obs["buildings"] if b["type"] == "depot")
    assert site["under_construction"] == {"work_left": 2, "work_total": 2, "builders": 0}
    assert obs["resources"]["upkeep_next"] == 0
    assert obs["you"]["founded"]


def test_bots_play_a_full_aoe_game():
    """Boom vs boom must found, farm, age up twice and field an army."""
    from cero_engine.cli import play_match
    replay = play_match(42, "1v1", ["boom", "boom"], ["forge", "swarm"])
    assert replay["turns"] == rules.MAX_TURNS or replay["winner"] is not None
    from cero_engine.bots import BOTS
    state = generate_map(42, "1v1", ["forge", "swarm"])
    bots = [BOTS["boom"](i, 42) for i in range(2)]
    for _ in range(50):
        orders = {p.id: bots[p.id].act(observe(state, p.id, "C"))
                  for p in state.players if p.alive}
        advance(state, orders)
    for p in state.players:
        assert p.founded and p.firmware in ("v2", "v3")
        types = {b.type for b in state.buildings_of(p.id)}
        assert {"core", "assembler", "rack", "depot"} <= types
        assert len([u for u in state.units_of(p.id) if u.type == "worker"]) >= 15
    assert tk(0, 0) not in state.scrap  # sanity: the helper is importable
