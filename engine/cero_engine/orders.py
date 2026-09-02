"""Order intake: schema-level and legality validation (PLAN.md §6.4/§6.5).

The legal subset of each player's orders is applied; every rejected order
produces an {actor_id, type, code, message} error returned to the agent on the
next turn so it can self-correct.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from cero_engine import rules, stats
from cero_engine.state import Entity, State

ORDER_TYPES = ("move", "attack", "attack_move", "gather", "build", "repair", "produce",
               "research", "rally", "diplomacy", "capture", "fuse", "recruit", "stop")
DIPLO_ACTIONS = ("propose_truce", "accept_truce", "break_truce",
                 "propose_joint_attack", "accept_joint_attack")


@dataclass
class Intake:
    """Validated per-player intents for one turn."""
    diplomacy: list[dict] = field(default_factory=list)
    produce: list[tuple[int, str]] = field(default_factory=list)      # (building_id, unit)
    research: list[tuple[int, str]] = field(default_factory=list)     # (building_id, tech)
    build: list[tuple[int, str, int, int]] = field(default_factory=list)  # (worker, type, x, y)
    fuse: list[list[int]] = field(default_factory=list)               # unit id groups
    recruit: list[tuple[int, int]] = field(default_factory=list)      # (unit_id, camp_id)


def _err(errors: list, actor: int | None, otype: str, code: str, message: str) -> None:
    errors.append({"actor_id": actor, "type": otype, "code": code, "message": message})


def has_truce(state: State, a: int, b: int) -> bool:
    return any({t["a"], t["b"]} == {a, b} and t["until_turn"] >= state.turn
               for t in state.diplomacy["truces"])


def validate_orders(state: State, player_id: int, raw_orders: list,
                    diplo_allowed: list[str] | None = None) -> tuple[Intake, list[dict]]:
    """Validate one player's raw orders. Mutates standing orders on entities for
    movement-class orders; queues one-shot intents in the returned Intake."""
    intake = Intake()
    errors: list[dict] = []
    player = state.players[player_id]
    if diplo_allowed is None:
        diplo_allowed = list(DIPLO_ACTIONS)

    if not isinstance(raw_orders, list):
        _err(errors, None, "orders", "schema", "orders must be a list")
        return intake, errors
    if len(raw_orders) > rules.MAX_ORDERS_PER_TURN:
        _err(errors, None, "orders", "too_many",
             f"only the first {rules.MAX_ORDERS_PER_TURN} orders are considered")
        raw_orders = raw_orders[:rules.MAX_ORDERS_PER_TURN]

    seen_actors: set[int] = set()
    for order in reversed(raw_orders):  # last order per actor wins
        if not isinstance(order, dict) or order.get("type") not in ORDER_TYPES:
            _err(errors, None, "unknown", "schema", "order without a valid type")
            continue
        otype = order["type"]
        if otype == "diplomacy":
            _validate_diplomacy(state, player_id, order, intake, errors, diplo_allowed)
            continue
        actor_id = order.get("actor_id")
        if not isinstance(actor_id, int):
            _err(errors, None, otype, "schema", "actor_id must be an integer")
            continue
        if actor_id in seen_actors:
            continue  # a later (kept) order already claimed this actor
        actor = state.ent(actor_id)
        if actor is None:
            _err(errors, actor_id, otype, "unknown_actor", "actor does not exist")
            continue
        if actor.owner != player_id:
            _err(errors, actor_id, otype, "not_yours", "actor is not yours")
            continue
        ok = _validate_one(state, player, actor, otype, order, intake, errors)
        if ok:
            seen_actors.add(actor_id)
    return intake, errors


def _xy(value) -> tuple[int, int] | None:
    if (isinstance(value, list) and len(value) == 2
            and all(isinstance(v, int) and not isinstance(v, bool) for v in value)):
        return value[0], value[1]
    return None


def has_finished_building(state: State, pid: int, btype: str) -> bool:
    return any(b.type == btype and not b.build_progress for b in state.buildings_of(pid))


def _validate_one(state: State, player, actor: Entity, otype: str, order: dict,
                  intake: Intake, errors: list[dict]) -> bool:
    pid = player.id

    if otype == "stop":
        if actor.is_unit:
            actor.standing_order = None
            return True
        # Buildings: cancel the running job and refund it (AoE2 cancel button).
        if actor.production is not None:
            e, m = stats.unit_cost(player, actor.production["unit"])
            player.energy += e
            player.metal += m
            actor.production = None
        if actor.research is not None:
            e, m = stats.tech_cost(player, actor.research["tech"])
            player.energy += e
            player.metal += m
            actor.research = None
        return True

    if otype == "move":
        to = _xy(order.get("to"))
        if not actor.is_unit or to is None or not state.in_bounds(*to):
            _err(errors, actor.id, otype, "bad_target", "move needs an in-bounds [x,y]")
            return False
        if actor.type == "watcher" or rules.UNITS[actor.type]["mov"] > 0:
            actor.standing_order = {"type": "move", "to": [to[0], to[1]]}
            return True
        _err(errors, actor.id, otype, "cannot_move", "this unit cannot move")
        return False

    if otype == "attack_move":
        to = _xy(order.get("to"))
        if not actor.is_unit or to is None or not state.in_bounds(*to):
            _err(errors, actor.id, otype, "bad_target", "attack_move needs an in-bounds [x,y]")
            return False
        if actor.type == "watcher" or rules.UNITS[actor.type]["mov"] > 0:
            actor.standing_order = {"type": "attack_move", "to": [to[0], to[1]]}
            return True
        _err(errors, actor.id, otype, "cannot_move", "this unit cannot move")
        return False

    if otype == "attack":
        target = state.ent(order.get("target_id", -1))
        if not actor.is_unit or target is None or target.id == actor.id:
            _err(errors, actor.id, otype, "bad_target", "attack needs a valid target_id")
            return False
        if rules.UNITS[actor.type]["atk"] <= 0:
            _err(errors, actor.id, otype, "cannot_attack", "this unit has no weapon")
            return False
        if target.owner == pid:
            _err(errors, actor.id, otype, "bad_target", "cannot attack your own entity")
            return False
        if target.owner >= 0 and has_truce(state, pid, target.owner):
            _err(errors, actor.id, otype, "truce", "attacking under an active truce is illegal")
            return False
        actor.standing_order = {"type": "attack", "target_id": target.id}
        return True

    if otype == "gather":
        target = _xy(order.get("target"))
        if actor.type != "worker" or target is None or not state.in_bounds(*target):
            _err(errors, actor.id, otype, "bad_target", "gather needs a worker and [x,y]")
            return False
        gx, gy = target
        terrain = state.tiles[gy][gx]
        own_cocoon = any(e.type == "cocoon" and e.owner == pid and (e.x, e.y) == (gx, gy)
                         for e in state.entities_sorted())
        if (terrain not in ("vein", "pod", "rubble") and f"{gx},{gy}" not in state.scrap
                and not own_cocoon):
            _err(errors, actor.id, otype, "nothing_there",
                 "gather targets a vein, pod, scrap pile, rubble or one of your cocoons")
            return False
        actor.standing_order = {"type": "gather", "target": [gx, gy], "phase": "work"}
        return True

    if otype == "repair":
        target = state.ent(order.get("target_id", -1))
        if (actor.type != "worker" or target is None or not target.is_building
                or target.owner != pid or target.build_progress):
            _err(errors, actor.id, otype, "bad_target",
                 "repair needs one of your finished buildings as target")
            return False
        actor.standing_order = {"type": "repair", "target_id": target.id}
        return True

    if otype == "build":
        if actor.type != "worker":
            _err(errors, actor.id, otype, "schema", "only workers build")
            return False
        target_id = order.get("target_id")
        if target_id is not None:
            # Join an existing construction site (AoE2: task more villagers on it).
            site = state.ent(target_id) if isinstance(target_id, int) else None
            if site is None or not site.is_building or site.owner != pid or not site.build_progress:
                _err(errors, actor.id, otype, "bad_target",
                     "build target_id must be one of your construction sites")
                return False
            actor.standing_order = {"type": "build", "target_id": site.id}
            return True
        btype = order.get("building")
        anchor = _xy(order.get("anchor"))
        if btype not in rules.BUILDABLE or anchor is None:
            _err(errors, actor.id, otype, "schema",
                 f"build needs building in {list(rules.BUILDABLE)} and anchor [x,y]")
            return False
        spec = rules.BUILDINGS[btype]
        if not rules.firmware_at_least(player.firmware, spec.get("requires_fw")):
            _err(errors, actor.id, otype, "need_firmware",
                 f"{btype} requires firmware {spec['requires_fw']}")
            return False
        if btype == "turret" and player.lineage == "parasite":
            _err(errors, actor.id, otype, "lineage", "parasite cannot build turrets")
            return False
        if btype == "core" and any(b.type == "core" for b in state.buildings_of(pid)) \
                and not rules.firmware_at_least(player.firmware, rules.EXTRA_CORE_REQUIRES_FW):
            _err(errors, actor.id, otype, "need_firmware",
                 f"a second core requires firmware {rules.EXTRA_CORE_REQUIRES_FW}")
            return False
        ax, ay = anchor
        occ = state.occupancy()
        explored = set(player.explored)
        for dy in range(spec["h"]):
            for dx in range(spec["w"]):
                x, y = ax + dx, ay + dy
                if not state.in_bounds(x, y) or state.tiles[y][x] != "plain" \
                        or (x, y) in occ or f"{x},{y}" in state.scrap:
                    _err(errors, actor.id, otype, "bad_site",
                         "footprint must be free plain tiles (no units, buildings, "
                         "veins, pods, rubble or scrap)")
                    return False
                if (y * state.size + x) not in explored:
                    _err(errors, actor.id, otype, "unexplored", "footprint must be explored")
                    return False
        intake.build.append((actor.id, btype, ax, ay))
        return True

    if otype == "produce":
        utype = order.get("unit")
        if not actor.is_building or utype not in rules.UNITS or actor.build_progress:
            _err(errors, actor.id, otype, "bad_target", "produce needs a finished producer")
            return False
        spec = rules.UNITS[utype]
        if spec["prod_at"] != actor.type:
            _err(errors, actor.id, otype, "wrong_building", f"{utype} is not built here")
            return False
        if not rules.firmware_at_least(player.firmware, spec["fw"]):
            _err(errors, actor.id, otype, "need_firmware", f"{utype} requires firmware {spec['fw']}")
            return False
        if spec.get("lineage") and spec["lineage"] != player.lineage:
            _err(errors, actor.id, otype, "lineage", f"{utype} is exclusive to {spec.get('lineage')}")
            return False
        if actor.production or actor.research:
            _err(errors, actor.id, otype, "busy", "building is already producing or researching")
            return False
        intake.produce.append((actor.id, utype))
        return True

    if otype == "research":
        tech = order.get("tech")
        if not actor.is_building or tech not in rules.TECHS or actor.build_progress:
            _err(errors, actor.id, otype, "bad_target", "research needs a finished lab building")
            return False
        spec = rules.TECHS[tech]
        if spec["at"] != actor.type:
            _err(errors, actor.id, otype, "wrong_building",
                 f"{tech} is researched at the {spec['at']}")
            return False
        if tech in player.techs:
            _err(errors, actor.id, otype, "already", "tech already researched")
            return False
        if any(req not in player.techs for req in spec["requires"]):
            _err(errors, actor.id, otype, "requires", "missing prerequisite tech")
            return False
        for req in spec.get("requires_buildings", ()):
            if not has_finished_building(state, pid, req):
                _err(errors, actor.id, otype, "requires", f"{tech} needs a finished {req}")
                return False
        if spec.get("requires_racks"):
            racks = sum(1 for b in state.buildings_of(pid)
                        if b.type == "rack" and not b.build_progress)
            if racks < spec["requires_racks"]:
                _err(errors, actor.id, otype, "requires",
                     f"needs {spec['requires_racks']} standing racks")
                return False
        if actor.production or actor.research:
            _err(errors, actor.id, otype, "busy", "building is already producing or researching")
            return False
        if any(b == actor.id for b, _ in intake.research):
            return False
        intake.research.append((actor.id, tech))
        return True

    if otype == "rally":
        if not actor.is_building or actor.type not in rules.PRODUCERS or actor.build_progress:
            _err(errors, actor.id, otype, "bad_target", "rally needs a finished core or assembler")
            return False
        if order.get("to") is None:
            actor.rally = None
            return True
        to = _xy(order.get("to"))
        if to is None or not state.in_bounds(*to):
            _err(errors, actor.id, otype, "bad_target", "rally needs an in-bounds [x,y] or null")
            return False
        actor.rally = [to[0], to[1]]
        return True

    if otype == "capture":
        target = state.ent(order.get("target_id", -1))
        if actor.type != "leech" or target is None or target.type != "rack":
            _err(errors, actor.id, otype, "bad_target", "capture needs a leech and a rack")
            return False
        if target.owner == pid or target.owner < 0:
            _err(errors, actor.id, otype, "bad_target", "target rack is not an enemy rack")
            return False
        if has_truce(state, pid, target.owner):
            _err(errors, actor.id, otype, "truce", "capturing under a truce is illegal")
            return False
        if target.capture and target.capture["by"] != pid:
            _err(errors, actor.id, otype, "disputed", "rack is already disputed by another player")
            return False
        actor.standing_order = {"type": "capture", "target_id": target.id}
        return True

    if otype == "fuse":
        ids = order.get("unit_ids")
        if (not isinstance(ids, list) or len(ids) != rules.COLOSSUS_FUSE_COUNT
                or not all(isinstance(i, int) for i in ids) or len(set(ids)) != len(ids)):
            _err(errors, actor.id, otype, "schema", "fuse needs 5 distinct unit_ids")
            return False
        if player.firmware != "v3":
            _err(errors, actor.id, otype, "need_firmware", "fusion requires firmware v3")
            return False
        units = [state.ent(i) for i in ids]
        if any(u is None or u.owner != pid or u.type != "striker" or u.fusing
               or (u.standing_order or {}).get("type") == "fusing" for u in units):
            _err(errors, actor.id, otype, "bad_target", "all five must be your idle strikers")
            return False
        if not _orthogonally_connected([(u.x, u.y) for u in units]):  # type: ignore[union-attr]
            _err(errors, actor.id, otype, "not_connected",
                 "the five strikers must be orthogonally connected")
            return False
        lead = min(ids)
        for u in units:
            u.standing_order = {"type": "fusing", "lead": lead}  # type: ignore[union-attr]
        state.ent(lead).fusing = {"unit_ids": sorted(ids), "turns_left": 1}  # type: ignore[union-attr]
        intake.fuse.append(sorted(ids))
        return True

    if otype == "recruit":
        target = state.ent(order.get("target_id", -1))
        if not actor.is_unit or target is None or target.type != "camp":
            _err(errors, actor.id, otype, "bad_target", "recruit needs a unit and a camp")
            return False
        if pid in target.camp_hostile_to:
            _err(errors, actor.id, otype, "hostile", "this camp is hostile to you")
            return False
        if max(abs(actor.x - target.x), abs(actor.y - target.y)) > 1:
            _err(errors, actor.id, otype, "not_adjacent", "unit must be adjacent to the camp")
            return False
        if player.energy < rules.CAMP_RECRUIT_COST_E:
            _err(errors, actor.id, otype, "no_resources",
                 f"recruiting costs {rules.CAMP_RECRUIT_COST_E} energy")
            return False
        intake.recruit.append((actor.id, target.id))
        return True

    _err(errors, actor.id, otype, "invalid", "unhandled order")
    return False


def _validate_diplomacy(state: State, pid: int, order: dict, intake: Intake,
                        errors: list[dict], allowed: list[str]) -> None:
    action = order.get("action")
    target = order.get("target_player")
    against = order.get("against_player")
    if action not in DIPLO_ACTIONS or not isinstance(target, int):
        _err(errors, None, "diplomacy", "schema", "diplomacy needs action and target_player")
        return
    if action not in allowed:
        _err(errors, None, "diplomacy", "diplo_locked",
             f"{action} is not available at your level")
        return
    if target == pid or not any(p.id == target and p.alive for p in state.players):
        _err(errors, None, "diplomacy", "bad_target", "target_player must be a living rival")
        return
    if action in ("propose_joint_attack", "accept_joint_attack"):
        if not isinstance(against, int) or against in (pid, target) \
                or not any(p.id == against and p.alive for p in state.players):
            _err(errors, None, "diplomacy", "bad_target", "against_player must be a third player")
            return
    intake.diplomacy.append({"action": action, "by": pid, "target": target, "against": against})


def _orthogonally_connected(tiles: list[tuple[int, int]]) -> bool:
    todo = {tiles[0]}
    seen: set[tuple[int, int]] = set()
    tile_set = set(tiles)
    while todo:
        t = todo.pop()
        seen.add(t)
        x, y = t
        for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
            n = (x + dx, y + dy)
            if n in tile_set and n not in seen:
                todo.add(n)
    return len(seen) == len(tile_set)
