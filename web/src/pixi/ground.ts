// Ground tiles — a pre-rendered (Blender/Cycles) patch of cracked earth, ash
// and broken asphalt, sliced into 64x32 diamonds that tile seamlessly with
// their neighbours. Cell (x % N, y % N) is used for map tile (x, y), so the
// texture repeats every N tiles. Until loaded, MapRenderer keeps its flat
// diamonds. Assets: web/public/ground/ground_atlas.png + ground.json.

import { Assets, Rectangle, Texture } from "pixi.js";

interface GroundManifest { tiles: number; tile: [number, number]; }

let manifest: GroundManifest | null = null;
let cells: Texture[] = [];

export async function initGround(base = "/ground"): Promise<void> {
  const res = await fetch(`${base}/ground.json`);
  if (!res.ok) throw new Error(`ground manifest missing at ${base}/ground.json`);
  const m = (await res.json()) as GroundManifest;
  const sheet = (await Assets.load(`${base}/ground_atlas.png`)) as Texture;
  sheet.source.scaleMode = "linear";
  const [tw, th] = m.tile;
  const out: Texture[] = [];
  for (let j = 0; j < m.tiles; j++) {
    for (let i = 0; i < m.tiles; i++) {
      out.push(new Texture({ source: sheet.source, frame: new Rectangle(i * tw, j * th, tw, th) }));
    }
  }
  cells = out;
  manifest = m;
}

export function groundReady(): boolean {
  return manifest !== null;
}

/** Diamond texture for map tile (x, y); null until loaded. */
export function getGroundTexture(x: number, y: number): Texture | null {
  if (!manifest) return null;
  const n = manifest.tiles;
  const i = ((x % n) + n) % n, j = ((y % n) + n) % n;
  return cells[j * n + i] ?? null;
}
