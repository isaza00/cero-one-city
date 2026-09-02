"""Rule constants — the single source of balance (PLAN.md §3, docs/AOE2-ANALYSIS.md).

Every value is an integer: the engine never uses floats (determinism, PLAN.md P1).
Percentage modifiers are expressed as integer numerator/denominator math at the
point of use (e.g. -25% => value * 75 // 100).

s2.0 "age of machines" — the Age of Empires model, robot-themed:
  * NOMAD START: no buildings at all. Workers found the first core (town center).
  * FOOD = ENERGY is spatial: wild pods (dormant humans in capsules) are the
    berries/animals you must find; cocoons are the farms you build later.
  * DROP-OFF ECONOMY: workers carry what they gather and bank it at a core or a
    depot (mining camp / mill); expansion means building depots by far veins.
  * CONSTRUCTION CREWS: any number of workers walk to a site and build it
    together; foundations are placed (and paid) the moment they are ordered.
  * BUILD MENUS: every observation lists what can be built / trained /
    researched right now, with costs and the reason when something is locked.
"""

RULESET_VERSION = "s2.0"  # "age of machines": nomad start, drop-off economy, pods, crews, menus

# ---------------------------------------------------------------- match basics
MAX_TURNS = 80
MAP_SIZE_1V1 = 96
MAP_SIZE_FFA = 120
MAX_ORDERS_PER_TURN = 120

# Nomad start (AoE2 "Nomad"): a handful of units and the metal for one core.
STARTING_ENERGY = 75
STARTING_METAL = 100
START_WORKERS = 4
START_ESCORTS = 1              # strikers: the "scout" that also guards the crew

VEIN_METAL = 300               # finite metal per vein tile (gold)
POD_ENERGY = 200               # finite energy per wild pod tile (berries/animals)
# The humans themselves: a drained pod frees its sleeper as a neutral
# `survivor`; workers carry survivors to cocoons, and a cocoon only incubates
# energy for the humans it holds (one worker slot per human). That is how the
# renewable economy reproduces: find humans, house them, farm them.
COCOON_HUMANS_MAX = 2
START_SURVIVORS = [(-3, 4), (5, -2)]   # stray humans near each start (ideal-core offsets)
SURVIVOR_SPAWN_ON_POD_DEPLETION = True
RUBBLE_CLEAR_TURNS = 2
RUBBLE_METAL = 10

UPKEEP_PER_UNIT = 1
# The blackout hits the ARMY: unpaid combat units freeze stiff. Workers and
# watchers run on their own cells, so an empty bank never deadlocks the
# economy (AoE2 has no upkeep at all; this keeps the brief's "no energy, no
# army" without the death spiral).
UPKEEP_EXEMPT = ("worker", "watcher", "survivor")

# ------------------------------------------------------------------- compute
COMPUTE_CORE = 10              # a core = the AoE2 town center's 5 pop, doubled
COMPUTE_RACK = 4               # a rack = a house
COMPUTE_RACK_SWARM = 6
# Free compute >= this at production start => -1 turn on jobs of >= 2 turns.
PRODUCTION_SPEEDUP_FREE_COMPUTE = 5

# ------------------------------------------------------------------ gathering
HARVEST_ENERGY = 8             # per worker per turn on an owned cocoon (farm)
HARVEST_ENERGY_RICH = 10       # with rich_harvest
POD_ENERGY_RATE = 8            # per worker per turn on a wild pod
POD_ENERGY_RATE_RICH = 10      # with rich_harvest
MAX_WORKERS_PER_COCOON = 2     # hard cap; the real cap is the cocoon's humans
MINE_METAL = 6                 # per worker per turn on a vein
MINE_METAL_FAST = 8            # with fast_mining
SCRAP_COLLECT_RATE = 20        # per worker per turn from scrap/ruins
CARRY_CAPACITY = 20            # a worker walks its cargo to a drop-off when full
CARRY_CAPACITY_SERVOS = 30     # with cargo_servos (the wheelbarrow)
DROPOFF_TYPES = ("core", "depot")
AUTO_RETARGET_RADIUS = 6       # depleted tile -> the worker steps to the next one
REPAIR_HP = 10                 # per worker per turn (cargo_servos: 20)
REPAIR_HP_SERVOS = 20
REPAIR_METAL_COST = 2          # per repairing worker per turn

# --------------------------------------------------------------- construction
MAX_BUILDERS_PER_SITE = 4      # more workers on a site = faster, up to this
BUILD_WORK_PER_WORKER = 1      # work points per adjacent builder per turn
BUILD_WORK_PER_WORKER_SERVOS = 2
SITE_MIN_HP_PCT = 10           # a fresh foundation stands at 10% hp, grows with work
EXTRA_CORE_REQUIRES_FW = "v2"  # a second core = the Castle Age town center

# ---------------------------------------------------------------- destruction
CORE_DAMAGE_CAP_PER_TURN = 150
CORE_STAGE_CRACKS_HP = 300     # below => "cracks" visual stage
CORE_STAGE_FIRE_HP = 150       # below => "fire" visual stage
COCOON_ACCUM_PER_TURN = 4
COCOON_ACCUM_MAX = 40
COCOON_ACCUM_PER_TURN_BATTERY = 6
COCOON_ACCUM_MAX_BATTERY = 60
RACK_CASCADE_DAMAGE = 10
SCRAP_FROM_UNIT_PCT = 50       # unit death leaves floor(metal_cost * pct / 100), min 2
SCRAP_FROM_UNIT_MIN = 2
COLOSSUS_SCRAP = 75
RUIN_METAL_PCT = 50            # eliminated player's buildings -> ruins
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
CAMP_GUARD_VISION = 7          # aggro radius around the camp
CAMP_GUARD_LEASH = 11          # max pursuit distance from camp

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

# Super-terrain scaling (s1.2): movement doubled, vision ~1.6x — same relative
# balance, but distances feel right on the 96/120 maps.
UNITS: dict[str, dict] = {
    "worker": dict(fw="v1", hp=20, atk=2, bonus=0, bonus_vs=(), armor=0, range=1, mov=6,
                   vis=5, cost_e=25, cost_m=0, compute=1, prod_turns=1, prod_at="core",
                   air=False, aa=False),
    "striker": dict(fw="v1", hp=30, atk=8, bonus=6, bonus_vs=MOUNTED_OR_HEAVY, armor=1,
                    range=1, mov=6, vis=5, cost_e=20, cost_m=15, compute=1, prod_turns=1,
                    prod_at="assembler", air=False, aa=False),
    "launcher": dict(fw="v2", hp=25, atk=7, bonus=4, bonus_vs=INFANTRY, armor=0, range=4,
                     mov=6, vis=6, cost_e=25, cost_m=20, compute=1, prod_turns=1,
                     prod_at="assembler", air=False, aa=True),
    "rider": dict(fw="v2", hp=55, atk=10, bonus=2, bonus_vs=RANGED_TYPES, armor=2, range=1,
                  mov=10, vis=8, cost_e=35, cost_m=30, compute=2, prod_turns=2,
                  prod_at="assembler", air=False, aa=False),
    "wasp": dict(fw="v2", hp=20, atk=6, bonus=0, bonus_vs=(), armor=0, range=1, mov=12,
                 vis=9, cost_e=30, cost_m=25, compute=2, prod_turns=2, prod_at="assembler",
                 air=True, aa=True),
    "walking_tower": dict(fw="v3", hp=80, atk=20, bonus=20, bonus_vs=(), armor=2, range=8,
                          mov=4, vis=8, cost_e=60, cost_m=80, compute=4, prod_turns=3,
                          prod_at="assembler", air=False, aa=False, full_building_damage=True,
                          building_bonus=20),
    "drone_swarm": dict(fw="v3", hp=35, atk=9, bonus=0, bonus_vs=(), armor=0, range=1,
                        mov=12, vis=8, cost_e=50, cost_m=40, compute=3, prod_turns=2,
                        prod_at="assembler", air=True, aa=True),
    "colossus": dict(fw="v3", hp=150, atk=18, bonus=0, bonus_vs=(), armor=3, range=1,
                     mov=6, vis=6, cost_e=0, cost_m=0, compute=5, prod_turns=0,
                     prod_at=None, air=False, aa=False, building_bonus=10),
    "human": dict(fw=None, hp=15, atk=5, bonus=0, bonus_vs=(), armor=0, range=2, mov=6,
                  vis=6, cost_e=0, cost_m=0, compute=0, prod_turns=0, prod_at=None,
                  air=False, aa=False, stealth=True),
    "spark": dict(fw="v1", hp=15, atk=4, bonus=0, bonus_vs=(), armor=0, range=1, mov=8,
                  vis=5, cost_e=10, cost_m=5, compute=1, prod_turns=1, prod_at="assembler",
                  air=False, aa=False, pair_produced=True, lineage="swarm"),
    "anvil": dict(fw="v2", hp=60, atk=10, bonus=0, bonus_vs=(), armor=3, range=1, mov=4,
                  vis=5, cost_e=30, cost_m=40, compute=2, prod_turns=2, prod_at="assembler",
                  air=False, aa=False, lineage="forge"),
    "watcher": dict(fw="v1", hp=10, atk=0, bonus=0, bonus_vs=(), armor=0, range=0, mov=12,
                    vis=13, cost_e=15, cost_m=10, compute=1, prod_turns=1, prod_at="core",
                    air=True, aa=False, lineage="oracle"),
    "leech": dict(fw="v1", hp=25, atk=5, bonus=0, bonus_vs=(), armor=0, range=1, mov=8,
                  vis=6, cost_e=20, cost_m=15, compute=1, prod_turns=1, prod_at="assembler",
                  air=False, aa=False, lineage="parasite"),
    "survivor": dict(fw=None, hp=10, atk=0, bonus=0, bonus_vs=(), armor=0, range=0, mov=0,
                     vis=0, cost_e=0, cost_m=0, compute=0, prod_turns=0, prod_at=None,
                     air=False, aa=False, neutral=True),
    "prism": dict(fw="v1", hp=18, atk=5, bonus=0, bonus_vs=(), armor=0, range=3, mov=6,
                  vis=6, cost_e=20, cost_m=10, compute=1, prod_turns=1, prod_at="assembler",
                  air=False, aa=False, lineage="photon"),
}

COLOSSUS_FUSE_COUNT = 5
COLOSSUS_SCORE_COST = 175  # value used by the score formula

# ----------------------------------------------------------------- buildings
# work: construction points (one adjacent builder = 1 point per turn).
# AoE2 mapping: core = town center, cocoon = farm, rack = house, depot = mining
# camp / mill, assembler = barracks + stable + archery range, lab = blacksmith,
# turret = tower, wall = palisade, camp = neutral village.
BUILDINGS: dict[str, dict] = {
    "core": dict(hp=450, w=2, h=2, cost_e=0, cost_m=100, work=8, vis=8, dropoff=True),
    "cocoon": dict(hp=30, w=1, h=1, cost_e=0, cost_m=25, work=2, vis=2),
    "rack": dict(hp=40, w=1, h=1, cost_e=0, cost_m=40, work=3, vis=3),
    "depot": dict(hp=60, w=1, h=1, cost_e=0, cost_m=30, work=2, vis=4, dropoff=True),
    "assembler": dict(hp=100, w=2, h=2, cost_e=0, cost_m=80, work=6, vis=3),
    "lab": dict(hp=80, w=2, h=2, cost_e=20, cost_m=60, work=4, vis=3),
    "turret": dict(hp=90, w=1, h=1, cost_e=30, cost_m=50, work=4, vis=8,
                   atk=9, range=6, aa=True, requires_fw="v2"),
    "wall": dict(hp=60, w=1, h=1, cost_e=0, cost_m=5, work=1, vis=1),
    "camp": dict(hp=60, w=1, h=1, cost_e=0, cost_m=0, work=0, vis=6),
}
BUILDABLE = ("core", "cocoon", "rack", "depot", "assembler", "lab", "turret", "wall")
PRODUCERS = ("core", "assembler")          # buildings that train units (and take rally points)
CORE_SCORE_COST = 200  # value the core contributes to the score formula

# ---------------------------------------------------------------------- techs
# researched_at: which building runs the research. requires_buildings: finished
# buildings of these types must stand (the AoE2 "two buildings to age up").
TECHS: dict[str, dict] = {
    "firmware_v2": dict(at="core", requires=(), cost_e=120, cost_m=80, turns=2,
                        requires_buildings=("assembler",)),
    "firmware_v3": dict(at="core", requires=("firmware_v2",), cost_e=350, cost_m=250,
                        turns=3, requires_racks=2, requires_buildings=("lab",)),
    "fast_mining": dict(at="core", requires=(), cost_e=50, cost_m=40, turns=2),
    "rich_harvest": dict(at="core", requires=(), cost_e=50, cost_m=40, turns=2),
    "cargo_servos": dict(at="core", requires=(), cost_e=75, cost_m=50, turns=2),
    "cocoon_battery": dict(at="core", requires=("firmware_v2",), cost_e=80, cost_m=60, turns=2),
    "reinforced_core": dict(at="core", requires=("firmware_v2",), cost_e=100, cost_m=100, turns=2),
    "armor_1": dict(at="lab", requires=(), cost_e=75, cost_m=50, turns=2),
    "armor_2": dict(at="lab", requires=("firmware_v2", "armor_1"), cost_e=150, cost_m=100, turns=2),
    "cannons_1": dict(at="lab", requires=(), cost_e=75, cost_m=50, turns=2),
    "cannons_2": dict(at="lab", requires=("firmware_v2", "cannons_1"), cost_e=150, cost_m=100, turns=2),
    "actuators": dict(at="lab", requires=(), cost_e=60, cost_m=40, turns=2),
    "optics": dict(at="lab", requires=("firmware_v2",), cost_e=100, cost_m=80, turns=2),
    "anti_air": dict(at="lab", requires=("firmware_v2",), cost_e=80, cost_m=60, turns=2),
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
