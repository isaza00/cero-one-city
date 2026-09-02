// Display metadata mirroring engine rules (display only - the engine is the
// source of truth; these values exist so the client can draw fog, progress
// bars and tooltips). Keep in sync with engine/cero_engine/rules.py (s2.0).

export const PLAYER_COLORS = [0x4fc3f7, 0xef5350, 0x9ccc65, 0xffb74d];
export const PLAYER_COLOR_CSS = ["#4fc3f7", "#ef5350", "#9ccc65", "#ffb74d"];
export const NEUTRAL_COLOR = 0x9e9e9e;

export const UNIT_VISION: Record<string, number> = {
  worker: 5, striker: 5, launcher: 6, rider: 8, wasp: 9, walking_tower: 8,
  drone_swarm: 8, colossus: 6, human: 6, spark: 5, anvil: 5, watcher: 13, leech: 6,
  prism: 6,
};

export const BUILDING_VISION: Record<string, number> = {
  core: 8, cocoon: 2, rack: 3, depot: 4, assembler: 3, lab: 3, turret: 8, wall: 1, camp: 6,
};

export const BUILDING_SIZE: Record<string, [number, number]> = {
  core: [2, 2], cocoon: [1, 1], rack: [1, 1], depot: [1, 1], assembler: [2, 2],
  lab: [2, 2], turret: [1, 1], wall: [1, 1], camp: [1, 1],
};

/** Construction work points (one adjacent builder = 1 point per turn). */
export const BUILDING_WORK: Record<string, number> = {
  core: 8, cocoon: 2, rack: 3, depot: 2, assembler: 6, lab: 4, turret: 4, wall: 1, camp: 0,
};

/** Metal / energy cost, for the build panel (base values, before lineage discounts). */
export const BUILDING_COST: Record<string, { e: number; m: number }> = {
  core: { e: 0, m: 100 }, cocoon: { e: 0, m: 25 }, rack: { e: 0, m: 40 },
  depot: { e: 0, m: 30 }, assembler: { e: 0, m: 80 }, lab: { e: 20, m: 60 },
  turret: { e: 30, m: 50 }, wall: { e: 0, m: 5 }, camp: { e: 0, m: 0 },
};

export const DROPOFF_TYPES = new Set(["core", "depot"]);

export const UNIT_MAX_HP: Record<string, number> = {
  worker: 20, striker: 30, launcher: 25, rider: 55, wasp: 20, walking_tower: 80,
  drone_swarm: 35, colossus: 150, human: 15, spark: 15, anvil: 60, watcher: 10,
  leech: 25, prism: 18,
};

export const BUILDING_MAX_HP: Record<string, number> = {
  core: 450, cocoon: 30, rack: 40, depot: 60, assembler: 100, lab: 80, turret: 90,
  wall: 60, camp: 60,
};

export const CARRY_CAPACITY = 20;

export const LINEAGES: Record<string, { label: string; blurb: string; weakness: string }> = {
  swarm: {
    label: "Swarm",
    blurb: "Cheap strikers and sparks (-25%), racks give +6 compute. Wins by numbers.",
    weakness: "All combat units have -5 hp.",
  },
  forge: {
    label: "Forge",
    blurb: "-20% metal costs (buildings too); heavy units get +5 hp. Wins with heavy metal.",
    weakness: "v2/v3 units build one turn slower.",
  },
  oracle: {
    label: "Oracle",
    blurb: "+2 vision, one extra map-detail band, +2s deadline. Wins by planning.",
    weakness: "All combat units have -1 attack.",
  },
  parasite: {
    label: "Parasite",
    blurb: "Leeches capture enemy racks; +50% metal from scrap. Wins by stealing.",
    weakness: "Cannot build turrets.",
  },
  photon: {
    label: "Photon",
    blurb: "Energy costs -25%; cocoons overcharge (+2/turn) into bigger death-blasts. Prisms poke from range at firmware v1.",
    weakness: "Light-built structures: all buildings -20% hp.",
  },
};

export function lineageLabel(id: string): string {
  return LINEAGES[id]?.label ?? id;
}

// The army roster, for "power card" displays. Mirrors engine rules.py
// (display only): every lineage fields the common units plus one special.
export const UNIT_POWERS: Record<string, { label: string; power: string }> = {
  worker: { label: "Worker", power: "The villager: harvests pods and cocoons, mines veins, carries it home, builds everything. Keep it safe." },
  striker: { label: "Striker", power: "Cheap brawler. Extra damage vs riders & heavies. Five of them fuse into a Colossus." },
  launcher: { label: "Launcher", power: "Rockets from 4 tiles away. Shreds infantry, can hit flyers." },
  rider: { label: "Rider", power: "Fast and tough (55 hp). Runs down ranged units." },
  wasp: { label: "Wasp", power: "Flying raider, speed 12. Sees far, hits air too." },
  walking_tower: { label: "Walking Tower", power: "Siege monster: range 8 and crushing bonus damage vs buildings. Slow." },
  drone_swarm: { label: "Drone Swarm", power: "Flying swarm, speed 12, anti-air. Late-game harassment." },
  colossus: { label: "Colossus", power: "Fused from 5 strikers: 150 hp wrecking ball that explodes big." },
  human: { label: "Human", power: "Recruited survivor: stealthy, ranged, costs no compute." },
  spark: { label: "Spark", power: "Swarm special: dirt-cheap zapper, built two at a time." },
  anvil: { label: "Anvil", power: "Forge special: walking wall - armor 3, 60 hp." },
  watcher: { label: "Watcher", power: "Oracle special: flying eye with vision 13. No weapon, all knowledge." },
  leech: { label: "Leech", power: "Parasite special: latches onto enemy racks and steals them." },
  prism: { label: "Prism", power: "Photon special: light artillery from range 3, available from firmware v1." },
};

// Combat stats for the selection card (mirrors engine rules.py, display only).
export const UNIT_STATS: Record<string, { atk: number; armor: number; range: number; mov: number; air?: boolean }> = {
  worker: { atk: 2, armor: 0, range: 1, mov: 6 },
  striker: { atk: 8, armor: 1, range: 1, mov: 6 },
  launcher: { atk: 7, armor: 0, range: 4, mov: 6 },
  rider: { atk: 10, armor: 2, range: 1, mov: 10 },
  wasp: { atk: 6, armor: 0, range: 1, mov: 12, air: true },
  walking_tower: { atk: 20, armor: 2, range: 8, mov: 4 },
  drone_swarm: { atk: 9, armor: 0, range: 1, mov: 12, air: true },
  colossus: { atk: 18, armor: 3, range: 1, mov: 6 },
  human: { atk: 5, armor: 0, range: 2, mov: 6 },
  spark: { atk: 4, armor: 0, range: 1, mov: 8 },
  anvil: { atk: 10, armor: 3, range: 1, mov: 4 },
  watcher: { atk: 0, armor: 0, range: 0, mov: 12, air: true },
  leech: { atk: 5, armor: 0, range: 1, mov: 8 },
  prism: { atk: 5, armor: 0, range: 3, mov: 6 },
};

// The AoE2 mapping is the tooltip: every building names what it is in Age.
export const BUILDING_INFO: Record<string, { label: string; aoe: string; power: string }> = {
  core: { label: "Core", aoe: "Town Center",
          power: "The heart and the drop-off. Trains workers, researches firmware, +10 compute. Lose your last core and the city dies with a city-shaking blast." },
  cocoon: { label: "Cocoon", aoe: "Farm",
            power: "A human incubated for energy: 8/turn per worker, 2 workers, renewable. Detonates when destroyed. Build it hugging the core so the harvest banks on the spot." },
  rack: { label: "Rack", aoe: "House",
          power: "+4 compute: lets the city think bigger armies. Cascades on death. Parasite leeches can steal it." },
  depot: { label: "Depot", aoe: "Mining camp / Mill",
           power: "A drop-off out in the field: workers next to a vein AND a depot bank every turn instead of walking home." },
  assembler: { label: "Assembler", aoe: "Barracks + Stable + Range",
               power: "The factory - trains every combat unit. Required to advance to firmware v2." },
  lab: { label: "Lab", aoe: "Blacksmith",
         power: "Researches armor, cannons, actuators, optics and anti-air. Required to advance to firmware v3." },
  turret: { label: "Turret", aoe: "Tower",
            power: "Defense tower: attack 9 at range 6, hits flyers too. Needs firmware v2." },
  wall: { label: "Wall", aoe: "Palisade",
          power: "5 metal of steel plate. Blocks the path; armies on attack-move walk around, only a direct attack chews through." },
  camp: { label: "Human camp", aoe: "Neutral village",
          power: "Neutral survivors. Loot it for resources (they'll want revenge) or recruit them." },
};

/** Terrain tiles the map draws (and what they are in Age of Empires). */
export const TERRAIN_INFO: Record<string, { label: string; aoe: string; power: string }> = {
  vein: { label: "Metal vein", aoe: "Gold mine", power: "300 metal, 6 per worker per turn, finite. Carry it to a core or depot." },
  pod: { label: "Human pods", aoe: "Berries / hunt", power: "200 energy of dormant humans in capsules, 8 per worker per turn, finite. Find them, harvest them, then farm cocoons." },
  rubble: { label: "Rubble", aoe: "Cleared debris", power: "A worker clears it in 2 turns for 10 metal." },
  blocked: { label: "Scrap heap", aoe: "Cliff", power: "Impassable for ground units; fliers pass." },
  scrap: { label: "Scrap", aoe: "Relic gold", power: "What dead robots leave behind. A worker salvages 20 per turn." },
};

// Short chips for researched techs - the HUD's "upgrade icons" row (mirrors
// engine TECHS; display only).
export const TECH_ABBREV: Record<string, { chip: string; label: string }> = {
  firmware_v2: { chip: "FW2", label: "Firmware v2 (Feudal Age)" },
  firmware_v3: { chip: "FW3", label: "Firmware v3 (Castle Age)" },
  fast_mining: { chip: "MIN", label: "Fast mining" },
  rich_harvest: { chip: "HRV", label: "Rich harvest" },
  cargo_servos: { chip: "CRG", label: "Cargo servos (wheelbarrow)" },
  cocoon_battery: { chip: "BAT", label: "Cocoon battery" },
  reinforced_core: { chip: "COR", label: "Reinforced core" },
  armor_1: { chip: "AR1", label: "Armor I" },
  armor_2: { chip: "AR2", label: "Armor II" },
  cannons_1: { chip: "CN1", label: "Cannons I" },
  cannons_2: { chip: "CN2", label: "Cannons II" },
  actuators: { chip: "ACT", label: "Actuators" },
  optics: { chip: "OPT", label: "Optics" },
  anti_air: { chip: "AA", label: "Anti-air" },
};

const LINEAGE_SPECIAL: Record<string, string> = {
  swarm: "spark", forge: "anvil", oracle: "watcher", parasite: "leech", photon: "prism",
};

/** Unit types a lineage fields, special first. */
export function lineageRoster(lineage: string): string[] {
  const common = ["worker", "striker", "launcher", "rider", "wasp",
                  "walking_tower", "drone_swarm", "colossus"];
  const special = LINEAGE_SPECIAL[lineage];
  return special ? [special, ...common] : common;
}

/** Buildings in the order the city grows (the AoE2 build panel). */
export const BUILD_ORDER: string[] = [
  "core", "cocoon", "rack", "depot", "assembler", "lab", "turret", "wall",
];
