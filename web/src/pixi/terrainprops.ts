// Terrain props — pre-rendered 3D environment sprites (Blender/Cycles) that
// replace the flat Graphics rectangles in MapRenderer.renderTerrain.
//
// Assets live in web/public/props/: one 128x128 PNG per prop plus props.json.
// Every sprite is rendered with the game's iso camera (az 45, el 30, 2:1
// diamond of 64x32) and its ground-contact point (tile center) at pixel
// (64, 80) -> anchor (0.5, 0.625). Until the pack loads, callers fall back
// to the procedural drawing, so nothing renders blank.

import { Assets, Texture } from "pixi.js";

interface PropsManifest {
  size: number;
  anchor: [number, number];
  /** terrain kind -> list of variant files */
  kinds: Record<string, string[]>;
}

let manifest: PropsManifest | null = null;
const textures = new Map<string, Texture>();

export async function initTerrainProps(base = "/props"): Promise<void> {
  const res = await fetch(`${base}/props.json`);
  if (!res.ok) throw new Error(`terrain props manifest missing at ${base}/props.json`);
  const m = (await res.json()) as PropsManifest;
  for (const files of Object.values(m.kinds)) {
    for (const f of files) {
      const tex = (await Assets.load(`${base}/${f}`)) as Texture;
      tex.source.scaleMode = "linear"; // smooth pre-rendered art, not pixel art
      textures.set(f, tex);
    }
  }
  manifest = m;
}

export function propsReady(): boolean {
  return manifest !== null;
}

/** Anchor for prop sprites: ground contact at (64, 80) of a 128 px frame. */
export function propAnchor(): { x: number; y: number } {
  if (!manifest) return { x: 0.5, y: 0.625 };
  return { x: manifest.anchor[0] / manifest.size, y: manifest.anchor[1] / manifest.size };
}

/** Texture for a terrain kind ("blocked", "vein", "pod", "rubble", "scrap",
 * "deadland"); `seed` picks a stable variant per tile. Null if not loaded. */
export function getPropTexture(kind: string, seed = 0): Texture | null {
  if (!manifest) return null;
  const files = manifest.kinds[kind];
  if (!files || files.length === 0) return null;
  const f = files[((seed % files.length) + files.length) % files.length];
  return textures.get(f) ?? null;
}
