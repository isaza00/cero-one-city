// DOM-side sprite pack access (plain <canvas>/<img>, no Pixi) for portraits,
// the landing hero battle and anything else that draws sprites outside the
// match renderer. The pack is the ONLY art source - no procedural fallbacks.

interface UnitsManifest {
  tile: number;
  tints: string[];
  units: Record<string, { row: number; frames: number }>;
  facing_right_mirror: string[];
}

interface BuildingsManifest {
  tints: string[];
  buildings: Record<string, { x: number; y: number; cell: number; frames: number }>;
}

export interface DomPack {
  tile: number;
  tints: string[];
  units: UnitsManifest["units"];
  buildings: BuildingsManifest["buildings"];
  mirror: Set<string>;
  unitImg: Record<string, HTMLImageElement>;
  buildingImg: Record<string, HTMLImageElement>;
}

const UNIT_ALIAS: Record<string, string> = { prism: "launcher", survivor: "human" };

let pack: DomPack | null = null;
let loading: Promise<DomPack | null> | null = null;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

/** Kick off (or await) the pack load. Resolves null if assets are missing. */
export function loadDomPack(base = "/sprites"): Promise<DomPack | null> {
  loading ??= (async () => {
    try {
      const um = (await (await fetch(`${base}/sprites.json`)).json()) as UnitsManifest;
      const bm = (await (await fetch(`${base}/buildings.json`)).json()) as BuildingsManifest;
      const unitImg: Record<string, HTMLImageElement> = {};
      const buildingImg: Record<string, HTMLImageElement> = {};
      await Promise.all([
        ...um.tints.map(async (t) => { unitImg[t] = await loadImage(`${base}/atlas_${t}.png`); }),
        ...bm.tints.map(async (t) => { buildingImg[t] = await loadImage(`${base}/atlas_buildings_${t}.png`); }),
      ]);
      pack = {
        tile: um.tile, tints: um.tints, units: um.units, buildings: bm.buildings,
        mirror: new Set(um.facing_right_mirror), unitImg, buildingImg,
      };
      return pack;
    } catch {
      return null;
    }
  })();
  return loading;
}

/** Synchronous access once loaded (null before). */
export function domPack(): DomPack | null {
  void loadDomPack();
  return pack;
}

/** Tint name for a player index (or "neutral"). */
export function tintForIndex(owner: number): string {
  const tints = pack?.tints ?? ["swarm", "forge", "oracle", "parasite", "neutral"];
  return owner >= 0 && owner < tints.length - 1 ? tints[owner] : "neutral";
}

/** Draw a unit frame; true if drawn (false = pack not ready). */
export function drawUnit(g: CanvasRenderingContext2D, type: string, tint: string,
                         frame: number, dx: number, dy: number,
                         dw: number, dh: number, mirror = false): boolean {
  const p = pack;
  if (!p) return false;
  const t = p.units[type] ? type : UNIT_ALIAS[type];
  const info = t ? p.units[t] : undefined;
  const img = p.unitImg[tint] ?? p.unitImg.neutral;
  if (!info || !img) return false;
  const s = p.tile;
  g.save();
  g.imageSmoothingEnabled = false;
  if (mirror) {
    g.translate(dx + dw, dy);
    g.scale(-1, 1);
    g.drawImage(img, (frame % info.frames) * s, info.row * s, s, s, 0, 0, dw, dh);
  } else {
    g.drawImage(img, (frame % info.frames) * s, info.row * s, s, s, dx, dy, dw, dh);
  }
  g.restore();
  return true;
}

/** Draw a building frame; true if drawn. */
export function drawBuilding(g: CanvasRenderingContext2D, type: string, tint: string,
                             frame: number, dx: number, dy: number,
                             dw: number, dh: number): boolean {
  const p = pack;
  if (!p) return false;
  const info = p.buildings[type];
  const img = p.buildingImg[tint] ?? p.buildingImg.neutral;
  if (!info || !img) return false;
  g.save();
  g.imageSmoothingEnabled = false;
  g.drawImage(img, info.x + (frame % info.frames) * info.cell, info.y,
              info.cell, info.cell, dx, dy, dw, dh);
  g.restore();
  return true;
}

/** Data-URL crop of a building frame (for <img> portraits); null pre-load. */
export function buildingDataURL(type: string, tint: string, frame = 0, scale = 2): string | null {
  const p = pack;
  if (!p) return null;
  const info = p.buildings[type];
  if (!info) return null;
  const c = document.createElement("canvas");
  c.width = info.cell * scale;
  c.height = info.cell * scale;
  const g = c.getContext("2d")!;
  drawBuilding(g, type, tint, frame, 0, 0, c.width, c.height);
  return c.toDataURL();
}
