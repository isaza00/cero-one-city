// Ground tiles — a pre-rendered (Blender/Cycles) patch of cracked earth, ash
// and broken asphalt, sliced into one cell per tile that tiles seamlessly
// with its neighbours. Cell (x % N, y % N) is used for map tile (x, y), so
// the texture repeats every N tiles.
//
// The atlas is authored at `tile` texels per cell (128x64) for a 64x32 world
// diamond, i.e. 2 texels per world pixel, so a HiDPI screen zoomed in still
// has detail to show. Cells are OPAQUE rectangles: the corner triangles hold
// exactly what the neighbouring tiles paint there, so the overlapping sprites
// compose into one continuous surface at any zoom, and mipmaps (for the
// zoomed-out view) have no alpha edge to darken.
//
// Until loaded, MapRenderer keeps its flat diamonds. Assets live in
// web/public/ground/ (ground.json + the atlas it names).

import { Assets, Rectangle, Texture } from "pixi.js";

interface GroundManifest {
  tiles: number;
  /** cell size in atlas texels */
  tile: [number, number];
  /** size the cell covers in world px (defaults to `tile`: 1 texel per px) */
  world_tile?: [number, number];
  atlas?: string;
}

let manifest: GroundManifest | null = null;
let cells: Texture[] = [];

export async function initGround(base = "/ground"): Promise<void> {
  const res = await fetch(`${base}/ground.json`);
  if (!res.ok) throw new Error(`ground manifest missing at ${base}/ground.json`);
  const m = (await res.json()) as GroundManifest;
  const sheet = (await Assets.load(`${base}/${m.atlas ?? "ground_atlas.png"}`)) as Texture;
  sheet.source.scaleMode = "linear";
  sheet.source.autoGenerateMipmaps = true; // smooth when the whole map is on screen
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

/** Sprite scale that maps one cell onto one 64x32 world diamond. */
export function groundScale(): number {
  if (!manifest) return 1;
  return (manifest.world_tile?.[0] ?? manifest.tile[0]) / manifest.tile[0];
}

/** Cell texture for map tile (x, y); null until loaded. */
export function getGroundTexture(x: number, y: number): Texture | null {
  if (!manifest) return null;
  const n = manifest.tiles;
  const i = ((x % n) + n) % n, j = ((y % n) + n) % n;
  return cells[j * n + i] ?? null;
}
