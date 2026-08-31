// Sprite pack loader — replaces the procedural unit placeholders with the
// shipped pixel-art pack (assets/sprites, served from web/public/sprites).
// Buildings still come from pixelart.ts until the building pack lands.
//
// Wiring (already done in this branch):
//   - main.tsx calls initSpritePack() once at startup (fire-and-forget).
//   - MapRenderer imports getUnitTexture/getBuildingTexture from here.
// Until the atlases finish loading, everything falls back to the old
// procedural textures, so nothing ever renders blank.

import { Assets, Rectangle, Texture } from "pixi.js";
import { getUnitTexture as proceduralUnit } from "./pixelart";

interface PackManifest {
  tile: number;
  tints: string[];
  atlas_columns: number;
  units: Record<string, { row: number; frames: number }>;
  facing_right_mirror: string[];
}

let manifest: PackManifest | null = null;
const packTextures = new Map<string, Texture>(); // `${unit}:${tint}:${frame}`
let mirrorSet = new Set<string>();
let frameClock = 0;

/** Load the atlases + manifest. Call once at startup; safe to fire-and-forget. */
export async function initSpritePack(base = "/sprites"): Promise<void> {
  const res = await fetch(`${base}/sprites.json`);
  if (!res.ok) throw new Error(`sprite pack manifest missing at ${base}/sprites.json`);
  manifest = (await res.json()) as PackManifest;
  mirrorSet = new Set(manifest.facing_right_mirror);
  const t = manifest.tile;
  for (const tint of manifest.tints) {
    const sheet = await Assets.load(`${base}/atlas_${tint}.png`);
    sheet.source.scaleMode = "nearest"; // crisp pixel art, no smoothing
    for (const [unit, info] of Object.entries(manifest.units)) {
      for (let f = 0; f < info.frames; f++) {
        packTextures.set(
          `${unit}:${tint}:${f}`,
          new Texture({
            source: sheet.source,
            frame: new Rectangle(f * t, info.row * t, t, t),
          }),
        );
      }
    }
  }
  // Global idle clock. Each state redraw picks the current frame, so units
  // pulse/step turn over turn (and live, wherever the renderer refreshes).
  setInterval(() => {
    frameClock++;
  }, 350);
}

function tintFor(owner: number): string {
  if (!manifest) return "neutral";
  return owner >= 0 && owner < manifest.tints.length - 1
    ? manifest.tints[owner]
    : "neutral";
}

/** Drop-in replacement for pixelart.getUnitTexture (same signature). */
export function getUnitTexture(type: string, owner: number): Texture {
  if (manifest) {
    const info = manifest.units[type];
    if (info) {
      const tex = packTextures.get(
        `${type}:${tintFor(owner)}:${frameClock % info.frames}`,
      );
      if (tex) return tex;
    }
  }
  return proceduralUnit(type, owner); // pre-init or unknown type
}

/** All idle frames for a unit — handy if a view wants an AnimatedSprite. */
export function getUnitFrames(type: string, owner: number): Texture[] {
  if (!manifest) return [proceduralUnit(type, owner)];
  const info = manifest.units[type];
  if (!info) return [proceduralUnit(type, owner)];
  const tint = tintFor(owner);
  const out: Texture[] = [];
  for (let f = 0; f < info.frames; f++) {
    const tex = packTextures.get(`${type}:${tint}:${f}`);
    if (tex) out.push(tex);
  }
  return out.length ? out : [proceduralUnit(type, owner)];
}

/** Side-facing units (drawn facing right); mirror with scale.x = -1 to face left. */
export function unitFacesRight(type: string): boolean {
  return mirrorSet.has(type);
}

// Buildings: unchanged until the building pack ships.
export { getBuildingTexture } from "./pixelart";
