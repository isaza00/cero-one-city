"""Effective stats: base tables + lineage modifiers + researched techs."""

from __future__ import annotations

from cero_engine import rules
from cero_engine.state import Entity, Player, State


def is_combat_unit(utype: str) -> bool:
    return utype not in ("worker", "watcher", "survivor") and rules.UNITS[utype]["atk"] > 0


def unit_cost(player: Player, utype: str) -> tuple[int, int]:
    """(energy, metal) cost after lineage discounts. Spark cost buys a pair."""
    spec = rules.UNITS[utype]
    e, m = spec["cost_e"], spec["cost_m"]
    if player.lineage == "swarm" and utype in rules.SWARM_CHEAP_UNITS:
        e, m = e * 75 // 100, m * 75 // 100
    if player.lineage == "forge":
        m = m * (100 - rules.FORGE_METAL_DISCOUNT_PCT) // 100
    if player.lineage == "photon":
        e = e * (100 - rules.PHOTON_ENERGY_DISCOUNT_PCT) // 100
    return e, m


def building_cost(player: Player, btype: str) -> tuple[int, int]:
    spec = rules.BUILDINGS[btype]
    e, m = spec["cost_e"], spec["cost_m"]
    if player.lineage == "forge":
        m = m * (100 - rules.FORGE_METAL_DISCOUNT_PCT) // 100
    if player.lineage == "photon":
        e = e * (100 - rules.PHOTON_ENERGY_DISCOUNT_PCT) // 100
    return e, m


def tech_cost(player: Player, tech: str) -> tuple[int, int]:
    spec = rules.TECHS[tech]
    return spec["cost_e"], spec["cost_m"]


def unit_max_hp(player: Player, utype: str) -> int:
    hp = rules.UNITS[utype]["hp"]
    if utype == "human":  # recruited, not built: lineage modifiers do not apply
        return hp
    if player.lineage == "forge" and utype in rules.FORGE_HP_BONUS_UNITS:
        hp += rules.FORGE_HP_BONUS
    if player.lineage == "swarm" and is_combat_unit(utype):
        hp -= rules.SWARM_HP_MALUS
    return hp


def building_max_hp(player: Player | None, btype: str) -> int:
    hp = rules.BUILDINGS[btype]["hp"]
    if player is not None and player.lineage == "photon" and btype != "camp":
        hp = hp * (100 - rules.PHOTON_BUILDING_HP_MALUS_PCT) // 100
    if player is not None and "reinforced_core" in player.techs:
        if btype == "core":
            hp += rules.REINFORCED_CORE_HP
        elif btype == "turret":
            hp += rules.REINFORCED_TURRET_HP
    return hp


def unit_attack(player: Player, utype: str) -> int:
    atk = rules.UNITS[utype]["atk"]
    if utype == "human":
        return atk
    if "cannons_1" in player.techs:
        atk += 2
    if "cannons_2" in player.techs:
        atk += 2
    if player.lineage == "oracle" and is_combat_unit(utype):
        atk -= rules.ORACLE_ATTACK_MALUS
    return max(atk, 0)


def unit_armor(player: Player, utype: str) -> int:
    armor = rules.UNITS[utype]["armor"]
    if utype == "human":
        return armor
    if "armor_1" in player.techs:
        armor += 1
    if "armor_2" in player.techs:
        armor += 1
    return armor


def unit_move(player: Player, utype: str) -> int:
    mov = rules.UNITS[utype]["mov"]
    if "actuators" in player.techs and utype in rules.INFANTRY and utype != "worker":
        mov += 1
    return mov


def unit_range(player: Player, utype: str) -> int:
    rng = rules.UNITS[utype]["range"]
    if "optics" in player.techs and utype == "launcher":
        rng += 1
    return rng


def unit_vision(player: Player, utype: str) -> int:
    vis = rules.UNITS[utype]["vis"]
    if player.lineage == "oracle":
        vis += rules.ORACLE_VISION_BONUS
    return vis


def building_vision(player: Player | None, btype: str) -> int:
    vis = rules.BUILDINGS[btype]["vis"]
    if player is not None and player.lineage == "oracle":
        vis += rules.ORACLE_VISION_BONUS
    return vis


def turret_range(player: Player) -> int:
    rng = rules.BUILDINGS["turret"]["range"]
    if "optics" in player.techs:
        rng += 1
    return rng


def turret_attack(player: Player) -> int:
    atk = rules.BUILDINGS["turret"]["atk"]
    if "cannons_1" in player.techs:
        atk += 2
    if "cannons_2" in player.techs:
        atk += 2
    return atk


def entity_vision(state: State, e: Entity) -> int:
    player = state.players[e.owner] if e.owner >= 0 else None
    if e.is_unit:
        if player is None:
            return rules.UNITS[e.type]["vis"]
        return unit_vision(player, e.type)
    return building_vision(player, e.type)


def production_turns(player: Player, utype: str, free_compute: int) -> int:
    turns = rules.UNITS[utype]["prod_turns"]
    if (player.lineage == "forge" and rules.UNITS[utype]["prod_at"] == "assembler"
            and rules.UNITS[utype]["fw"] in rules.FORGE_PROD_PENALTY_FW):
        turns += 1
    if turns >= 2 and free_compute >= rules.PRODUCTION_SPEEDUP_FREE_COMPUTE:
        turns -= 1
    return max(turns, 1)


def research_turns(tech: str, free_compute: int) -> int:
    turns = rules.TECHS[tech]["turns"]
    if turns >= 2 and free_compute >= rules.PRODUCTION_SPEEDUP_FREE_COMPUTE:
        turns -= 1
    return max(turns, 1)


# ------------------------------------------------------------ economy / crews

def carry_capacity(player: Player) -> int:
    """How much a worker carries before walking it to a drop-off."""
    if "cargo_servos" in player.techs:
        return rules.CARRY_CAPACITY_SERVOS
    return rules.CARRY_CAPACITY


def build_rate(player: Player) -> int:
    """Construction work points one adjacent builder adds per turn."""
    if "cargo_servos" in player.techs:
        return rules.BUILD_WORK_PER_WORKER_SERVOS
    return rules.BUILD_WORK_PER_WORKER


def building_work(btype: str) -> int:
    return max(rules.BUILDINGS[btype]["work"], 1)


def mine_rate(player: Player) -> int:
    return rules.MINE_METAL_FAST if "fast_mining" in player.techs else rules.MINE_METAL


def harvest_rate(player: Player) -> int:
    return rules.HARVEST_ENERGY_RICH if "rich_harvest" in player.techs else rules.HARVEST_ENERGY


def pod_rate(player: Player) -> int:
    return rules.POD_ENERGY_RATE_RICH if "rich_harvest" in player.techs else rules.POD_ENERGY_RATE


def compute_cap(state: State, player_id: int) -> int:
    player = state.players[player_id]
    per_rack = rules.COMPUTE_RACK_SWARM if player.lineage == "swarm" else rules.COMPUTE_RACK
    cap = 0
    for b in state.buildings_of(player_id):
        if b.build_progress:
            continue
        if b.type == "core":
            cap += rules.COMPUTE_CORE
        elif b.type == "rack":
            cap += per_rack
    return cap


def compute_used(state: State, player_id: int) -> int:
    return sum(rules.UNITS[e.type]["compute"] for e in state.units_of(player_id))
