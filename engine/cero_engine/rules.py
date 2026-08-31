"""Rule constants — the single source of balance (PLAN.md §3).

Every value is an integer: the engine never uses floats (determinism, PLAN.md P1).
Percentage modifiers are expressed as integer numerator/denominator math at the
point of use (e.g. -25% => value * 75 // 100).
"""

RULESET_VERSION = "s1.1"

# ---------------------------------------------------------------- match basics
MAX_TURNS = 40
MAP_SIZE_1V1 = 32
MAP_SIZE_FFA = 44
MAX_ORDERS_PER_TURN = 80

STARTING_ENERGY = 50
STARTING_METAL = 50

VEIN_METAL = 300
RUBBLE_CLEAR_TURNS = 2
RUBBLE_METAL = 10

UPKEEP_PER_UNIT = 1

# ------------------------------------------------------------------- compute
COMPUTE_CORE = 8
COMPUTE_RACK = 4
COMPUTE_RACK_SWARM = 6
# Free compute >= this at production start => -1 turn on jobs of >= 2 turns.
PRODUCTION_SPEEDUP_FREE_COMPUTE = 5

# ------------------------------------------------------------------ gathering
HARVEST_ENERGY = 8            # per worker per turn on an owned cocoon
HARVEST_ENERGY_RICH = 10      # with rich_harvest
MAX_WORKERS_PER_COCOON = 2
MINE_METAL = 6                # per worker per turn on a vein
MINE_METAL_FAST = 8           # with fast_mining
SCRAP_COLLECT_RATE = 20       # per worker per turn from scrap/ruins
REPAIR_HP = 10                # per worker per turn (cargo_servos: 20)
REPAIR_HP_SERVOS = 20
REPAIR_METAL_COST = 2         # per repairing worker per turn

# ---------------------------------------------------------------- destruction
CORE_DAMAGE_CAP_PER_TURN = 150
CORE_STAGE_CRACKS_HP = 300    # below => "cracks" visual stage
CORE_STAGE_FIRE_HP = 150      # below => "fire" visual stage
COCOON_ACCUM_PER_TURN = 4
COCOON_ACCUM_MAX = 40
COCOON_ACCUM_PER_TURN_BATTERY = 6
COCOON_ACCUM_MAX_BATTERY = 60
RACK_CASCADE_DAMAGE = 10
SCRAP_FROM_UNIT_PCT = 50      # unit death leaves floor(metal_cost * pct / 100), min 2
SCRAP_FROM_UNIT_MIN = 2
COLOSSUS_SCRAP = 75
RUIN_METAL_PCT = 50           # eliminated player's buildings -> ruins
RUIN_ENERGY_PCT = 25

# ----------------------------------------------------------------- diplomacy
TRUCE_TURNS = 5
PROPOSAL_EXPIRES_TURNS = 2
JOINT_ATTACK_TURNS = 5

# --------------------------------------------------------------------- camps
CAMP_HP = 60
CAMP_GUARDS = 3
CAMP_LOOT_ENERGY = 80
CAMP_LOOT_METAL = 80
CAMP_RECRUIT_COST_E = 50
CAMP_GUARD_VISION = 4         # aggro radius around the camp
CAMP_GUARD_LEASH = 6          # max pursuit distance from camp

# ------------------------------------------------------------------- capture
CAPTURE_COUNTER_TARGET = 3

# ------------------------------------------------------------------ lineages
LINEAGES = ("swarm", "forge", "oracle", "parasite", "photon")
SWARM_CHEAP_UNITS = ("striker", "spark")   # -25% cost
SWARM_HP_MALUS = 5                          # combat units -5 hp
FORGE_METAL_DISCOUNT_PCT = 20               # all metal costs -20%
FORGE_HP_BONUS_UNITS = ("rider", "anvil", "walking_tower", "colossus")
FORGE_HP_BONUS = 5
FORGE_PROD_PENALTY_FW = ("v2", "v3")        # assembler units of these tiers: +1 turn
ORACLE_VISION_BONUS = 2
ORACLE_ATTACK_MALUS = 1                     # combat units -1 attack
PARASITE_SCRAP_BONUS_PCT = 50               # +50% metal when collecting scrap
PHOTON_ENERGY_DISCOUNT_PCT = 25             # all energy costs -25%
PHOTON_ACCUM_BONUS = 2                      # cocoon accumulators charge +2/turn
PHOTON_BUILDING_HP_MALUS_PCT = 20           # light-built structures: buildings -20% hp

# --------------------------------------------------------------------- units
# bonus_vs: extra attack against these unit types.
# ranged units (range > 1) deal floor(damage/2) to buildings, except walking_tower.
INFANTRY = ("striker", "spark", "anvil", "human", "leech", "worker")
MOUNTED_OR_HEAVY = ("rider", "anvil", "walking_tower", "colossus")
RANGED_TYPES = ("launcher", "walking_tower", "human")

UNITS: dict[str, dict] = {
    "worker": dict(fw="v1", hp=20, atk=2, bonus=0, bonus_vs=(), armor=0, range=1, mov=3,
                   vis=3, cost_e=25, cost_m=0, compute=1, prod_turns=1, prod_at="core",
                   air=False, aa=False),
    "striker": dict(fw="v1", hp=30, atk=8, bonus=6, bonus_vs=MOUNTED_OR_HEAVY, armor=1,
                    range=1, mov=3, vis=3, cost_e=20, cost_m=15, compute=1, prod_turns=1,
                    prod_at="assembler", air=False, aa=False),
    "launcher": dict(fw="v2", hp=25, atk=7, bonus=4, bonus_vs=INFANTRY, armor=0, range=3,
                     mov=3, vis=4, cost_e=25, cost_m=20, compute=1, prod_turns=1,
                     prod_at="assembler", air=False, aa=True),
    "rider": dict(fw="v2", hp=55, atk=10, bonus=2, bonus_vs=RANGED_TYPES, armor=2, range=1,
                  mov=5, vis=5, cost_e=35, cost_m=30, compute=2, prod_turns=2,
                  prod_at="assembler", air=False, aa=False),
    "wasp": dict(fw="v2", hp=20, atk=6, bonus=0, bonus_vs=(), armor=0, range=1, mov=6,
                 vis=6, cost_e=30, cost_m=25, compute=2, prod_turns=2, prod_at="assembler",
                 air=True, aa=True),
    "walking_tower": dict(fw="v3", hp=80, atk=20, bonus=20, bonus_vs=(), armor=2, range=4,
                          mov=2, vis=4, cost_e=60, cost_m=80, compute=4, prod_turns=3,
                          prod_at="assembler", air=False, aa=False, full_building_damage=True,
                          building_bonus=20),
    "drone_swarm": dict(fw="v3", hp=35, atk=9, bonus=0, bonus_vs=(), armor=0, range=1,
                        mov=6, vis=5, cost_e=50, cost_m=40, compute=3, prod_turns=2,
                        prod_at="assembler", air=True, aa=True),
    "colossus": dict(fw="v3", hp=150, atk=18, bonus=0, bonus_vs=(), armor=3, range=1,
                     mov=3, vis=4, cost_e=0, cost_m=0, compute=5, prod_turns=0,
                     prod_at=None, air=False, aa=False, building_bonus=10),
    "human": dict(fw=None, hp=15, atk=5, bonus=0, bonus_vs=(), armor=0, range=2, mov=3,
                  vis=4, cost_e=0, cost_m=0, compute=0, prod_turns=0, prod_at=None,
                  air=False, aa=False, stealth=True),
    "spark": dict(fw="v1", hp=15, atk=4, bonus=0, bonus_vs=(), armor=0, range=1, mov=4,
                  vis=3, cost_e=10, cost_m=5, compute=1, prod_turns=1, prod_at="assembler",
                  air=False, aa=False, pair_produced=True, lineage="swarm"),
    "anvil": dict(fw="v2", hp=60, atk=10, bonus=0, bonus_vs=(), armor=3, range=1, mov=2,
                  vis=3, cost_e=30, cost_m=40, compute=2, prod_turns=2, prod_at="assembler",
                  air=False, aa=False, lineage="forge"),
    "watcher": dict(fw="v1", hp=10, atk=0, bonus=0, bonus_vs=(), armor=0, range=0, mov=6,
                    vis=8, cost_e=15, cost_m=10, compute=1, prod_turns=1, prod_at="core",
                    air=True, aa=False, lineage="oracle"),
    "leech": dict(fw="v1", hp=25, atk=5, bonus=0, bonus_vs=(), armor=0, range=1, mov=4,
                  vis=4, cost_e=20, cost_m=15, compute=1, prod_turns=1, prod_at="assembler",
                  air=False, aa=False, lineage="parasite"),
    "prism": dict(fw="v1", hp=18, atk=5, bonus=0, bonus_vs=(), armor=0, range=2, mov=3,
                  vis=4, cost_e=20, cost_m=10, compute=1, prod_turns=1, prod_at="assembler",
                  air=False, aa=False, lineage="photon"),
}

COLOSSUS_FUSE_COUNT = 5
COLOSSUS_SCORE_COST = 175  # value used by the score formula

# ----------------------------------------------------------------- buildings
BUILDINGS: dict[str, dict] = {
    "core": dict(hp=450, w=2, h=2, cost_e=0, cost_m=0, build_turns=0, vis=5),
    "cocoon": dict(hp=30, w=1, h=1, cost_e=0, cost_m=25, build_turns=1, vis=1),
    "rack": dict(hp=40, w=1, h=1, cost_e=0, cost_m=40, build_turns=2, vis=2),
    "assembler": dict(hp=100, w=2, h=2, cost_e=0, cost_m=80, build_turns=2, vis=2),
    "turret": dict(hp=90, w=1, h=1, cost_e=30, cost_m=50, build_turns=2, vis=5,
                   atk=9, range=4, aa=True, requires_fw="v2"),
    "camp": dict(hp=60, w=1, h=1, cost_e=0, cost_m=0, build_turns=0, vis=4),
}
BUILDABLE = ("cocoon", "rack", "assembler", "turret")
CORE_SCORE_COST = 200  # value the core contributes to the score formula

# ---------------------------------------------------------------------- techs
# researched_at: which building runs the research.
TECHS: dict[str, dict] = {
    "firmware_v2": dict(at="core", requires=(), cost_e=120, cost_m=80, turns=2),
    "firmware_v3": dict(at="core", requires=("firmware_v2",), cost_e=350, cost_m=250,
                        turns=3, requires_racks=2),
    "fast_mining": dict(at="core", requires=(), cost_e=50, cost_m=40, turns=2),
    "rich_harvest": dict(at="core", requires=(), cost_e=50, cost_m=40, turns=2),
    "cargo_servos": dict(at="core", requires=(), cost_e=60, cost_m=30, turns=2),
    "cocoon_battery": dict(at="core", requires=("firmware_v2",), cost_e=80, cost_m=60, turns=2),
    "reinforced_core": dict(at="core", requires=("firmware_v2",), cost_e=100, cost_m=100, turns=2),
    "armor_1": dict(at="assembler", requires=(), cost_e=75, cost_m=50, turns=2),
    "armor_2": dict(at="assembler", requires=("firmware_v2", "armor_1"), cost_e=150, cost_m=100, turns=2),
    "cannons_1": dict(at="assembler", requires=(), cost_e=75, cost_m=50, turns=2),
    "cannons_2": dict(at="assembler", requires=("firmware_v2", "cannons_1"), cost_e=150, cost_m=100, turns=2),
    "actuators": dict(at="assembler", requires=(), cost_e=60, cost_m=40, turns=2),
    "optics": dict(at="assembler", requires=("firmware_v2",), cost_e=100, cost_m=80, turns=2),
    "anti_air": dict(at="assembler", requires=("firmware_v2",), cost_e=80, cost_m=60, turns=2),
}
REINFORCED_CORE_HP = 150
REINFORCED_TURRET_HP = 30
ANTI_AIR_MELEE_PCT = 50  # melee ground units hit air at 50% damage with anti_air

# ---------------------------------------------------------------------- score
SCORE_BUILDING_MULT = 2
SCORE_PER_TECH = 25
SCORE_PER_CORE_KILL = 100
SCORE_PER_HELD_CAPTURED_RACK = 50

FIRMWARES = ("v1", "v2", "v3")


def firmware_at_least(have: str, need: str | None) -> bool:
    if need is None:
        return True
    return FIRMWARES.index(have) >= FIRMWARES.index(need)
