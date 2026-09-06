// Terrain props — pre-rendered 3D environment sprites (Blender/Cycles) that
// replace the flat Graphics rectangles in MapRenderer.renderTerrain.
//
// Assets live in web/public/props/: one PNG per prop plus props.json. Every
// sprite is rendered with the game's iso camera (az 45, el 30, 2:1 diamond
// of 64x32). The frame is `size` px (384) but covers `world_size` world px
// (128), i.e. 3 texels per world pixel, so zooming in on a HiDPI screen
// still has detail to show; the ground-contact point (tile center) is at
// `anchor` -> (0.5, 0.625). Until the pack loads, callers fall back to the
// procedural drawing, so nothing renders blank.

import { Assets, Texture } from "pixi.js";

interface PropsManifest {
  /** frame size in texels */
  size: number;
  /** world px the frame covers (defaults to `size`: 1 texel per px) */
  world_size?: number;
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
  const files = [...new Set(Object.values(m.kinds).flat())];
  const loaded = await Promise.all(files.map(async (f) => {
    const tex = (await Assets.load(`${base}/${f}`)) as Texture;
    tex.source.scaleMode = "linear";          // smooth pre-rendered art, not pixel art
    tex.source.autoGenerateMipmaps = true;    // and smooth when minified at map-wide zoom
    return [f, tex] as const;
  }));
  for (const [f, tex] of loaded) textures.set(f, tex);
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

/** Sprite scale that maps the frame onto the world px it covers. */
export function propScale(): number {
  if (!manifest) return 1;
  return (manifest.world_size ?? manifest.size) / manifest.size;
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

/** Per-placement variation so a single render does not read as a stamp: a
 * stable scale and brightness jitter derived from the seed. No mirroring:
 * every prop is lit from the same side and casts its shadow to the right,
 * so a flipped copy next to an unflipped one would give the scene two suns. */
export function propVariant(seed: number): { scale: number; light: number } {
  const h = (Math.imul(seed, 2654435761) >>> 0) % 1000; // cheap integer hash, 0..999
  return {
    scale: 0.88 + (h % 7) * 0.04,                // 0.88 .. 1.12
    light: 0.9 + (Math.floor(h / 7) % 6) * 0.02, // 0.90 .. 1.00
  };
}
