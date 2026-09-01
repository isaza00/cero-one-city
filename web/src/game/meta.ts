// Display metadata mirroring engine rules (display only - the engine is the
// source of truth; these values exist so the client can draw fog and tooltips).

export const PLAYER_COLORS = [0x4fc3f7, 0xef5350, 0x9ccc65, 0xffb74d];
export const PLAYER_COLOR_CSS = ["#4fc3f7", "#ef5350", "#9ccc65", "#ffb74d"];
export const NEUTRAL_COLOR = 0x9e9e9e;

export const UNIT_VISION: Record<string, number> = {
  worker: 3, striker: 3, launcher: 4, rider: 5, wasp: 6, walking_tower: 4,
  drone_swarm: 5, colossus: 4, human: 4, spark: 3, anvil: 3, watcher: 8, leech: 4,
  prism: 4,
};

export const BUILDING_VISION: Record<string, number> = {
  core: 5, cocoon: 1, rack: 2, assembler: 2, turret: 5, camp: 4,
};

export const BUILDING_SIZE: Record<string, [number, number]> = {
  core: [2, 2], cocoon: [1, 1], rack: [1, 1], assembler: [2, 2], turret: [1, 1],
  camp: [1, 1],
};

export const UNIT_MAX_HP: Record<string, number> = {
  worker: 20, striker: 30, launcher: 25, rider: 55, wasp: 20, walking_tower: 80,
  drone_swarm: 35, colossus: 150, human: 15, spark: 15, anvil: 60, watcher: 10,
  leech: 25, prism: 18,
};

export const BUILDING_MAX_HP: Record<string, number> = {
  core: 450, cocoon: 30, rack: 40, assembler: 100, turret: 90, camp: 60,
};

export const LINEAGES: Record<string, { label: string; blurb: string; weakness: string }> = {
  swarm: {
    label: "Swarm",
    blurb: "Cheap strikers and sparks (-25%), racks give +6 compute. Wins by numbers.",
    weakness: "All combat units have -5 hp.",
  },
  forge: {
    label: "Forge",
    blurb: "-20% metal costs; heavy units get +5 hp. Wins with heavy metal.",
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
  worker: { label: "Worker", power: "Harvests energy & metal and builds everything. Keep it safe." },
  striker: { label: "Striker", power: "Cheap brawler. Extra damage vs riders & heavies. Five of them fuse into a Colossus." },
  launcher: { label: "Launcher", power: "Rockets from 3 tiles away. Shreds infantry, can hit flyers." },
  rider: { label: "Rider", power: "Fast and tough (55 hp). Runs down ranged units." },
  wasp: { label: "Wasp", power: "Flying raider, speed 6. Sees far, hits air too." },
  walking_tower: { label: "Walking Tower", power: "Siege monster: range 4 and crushing bonus damage vs buildings. Slow." },
  drone_swarm: { label: "Drone Swarm", power: "Flying swarm, speed 6, anti-air. Late-game harassment." },
  colossus: { label: "Colossus", power: "Fused from 5 strikers: 150 hp wrecking ball that explodes big." },
  spark: { label: "Spark", power: "Swarm special: dirt-cheap zapper, built two at a time." },
  anvil: { label: "Anvil", power: "Forge special: walking wall - armor 3, 60 hp." },
  watcher: { label: "Watcher", power: "Oracle special: flying eye with vision 8. No weapon, all knowledge." },
  leech: { label: "Leech", power: "Parasite special: latches onto enemy racks and steals them." },
  prism: { label: "Prism", power: "Photon special: light artillery from range 2, available from firmware v1." },
};

// Combat stats for the selection card (mirrors engine rules.py, display only).
export const UNIT_STATS: Record<string, { atk: number; armor: number; range: number; mov: number; air?: boolean }> = {
  worker: { atk: 2, armor: 0, range: 1, mov: 3 },
  striker: { atk: 8, armor: 1, range: 1, mov: 3 },
  launcher: { atk: 7, armor: 0, range: 3, mov: 3 },
  rider: { atk: 10, armor: 2, range: 1, mov: 5 },
  wasp: { atk: 6, armor: 0, range: 1, mov: 6, air: true },
  walking_tower: { atk: 20, armor: 2, range: 4, mov: 2 },
  drone_swarm: { atk: 9, armor: 0, range: 1, mov: 6, air: true },
  colossus: { atk: 18, armor: 3, range: 1, mov: 3 },
  human: { atk: 5, armor: 0, range: 2, mov: 3 },
  spark: { atk: 4, armor: 0, range: 1, mov: 4 },
  anvil: { atk: 10, armor: 3, range: 1, mov: 2 },
  watcher: { atk: 0, armor: 0, range: 0, mov: 6, air: true },
  leech: { atk: 5, armor: 0, range: 1, mov: 4 },
  prism: { atk: 5, armor: 0, range: 2, mov: 3 },
};

export const BUILDING_INFO: Record<string, { label: string; power: string }> = {
  core: { label: "Core", power: "The heart. Everything is lost when it falls - and it goes down with a city-shaking blast." },
  cocoon: { label: "Cocoon", power: "Stores energy and detonates when destroyed. Photon cocoons overcharge into bigger blasts." },
  rack: { label: "Rack", power: "+compute: lets the city think bigger armies. Parasite leeches can steal it." },
  assembler: { label: "Assembler", power: "The factory - builds almost every combat unit." },
  turret: { label: "Turret", power: "Defense tower: attack 9 at range 4, hits flyers too. Needs firmware v2." },
  camp: { label: "Human camp", power: "Neutral survivors. Loot it for resources (they'll want revenge) or recruit them." },
};

// Short chips for researched techs - the HUD's "upgrade icons" row (mirrors
// engine TECHS; display only).
export const TECH_ABBREV: Record<string, { chip: string; label: string }> = {
  firmware_v2: { chip: "FW2", label: "Firmware v2" },
  firmware_v3: { chip: "FW3", label: "Firmware v3" },
  fast_mining: { chip: "MIN", label: "Fast mining" },
  rich_harvest: { chip: "HRV", label: "Rich harvest" },
  cargo_servos: { chip: "CRG", label: "Cargo servos" },
  cocoon_battery: { chip: "BAT", label: "Cocoon battery" },
  reinforced_core: { chip: "COR", label: "Reinforced core" },
  armor_1: { chip: "AR1", label: "Armor I" },
  armor_2: { chip: "AR2", label: "Armor II" },
  cannons_1: { chip: "CN1", label: "Cannons I" },
  cannons_2: { chip: "CN2", label: "Cannons II" },
  actuators: { chip: "ACT", label: "Actuators" },
  optics: { chip: "OPT", label: "Optics" },
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
