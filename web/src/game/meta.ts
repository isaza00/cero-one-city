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
