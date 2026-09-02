// Sprite pack loader — units AND buildings ship from the pixel-art pack
// (assets/sprites, served from web/public/sprites). The old procedural
// placeholder art is DELETED; if an atlas hasn't loaded yet the renderer gets
// a plain steel tile, never the old drawings.
//
// Wiring: main.tsx calls initSpritePack() once at startup (fire-and-forget).

import { Assets, Rectangle, Texture } from "pixi.js";

interface PackManifest {
  tile: number;
  tints: string[];
  atlas_columns: number;
  units: Record<string, { row: number; frames: number }>;
  facing_right_mirror: string[];
}

interface BuildingsManifest {
  tints: string[];
  buildings: Record<string, { x: number; y: number; cell: number; frames: number }>;
}

let manifest: PackManifest | null = null;
let bManifest: BuildingsManifest | null = null;
let loaded = false; // true only when ALL textures are registered
const packTextures = new Map<string, Texture>();  // `${unit}:${tint}:${frame}`
const bTextures = new Map<string, Texture>();     // `${building}:${tint}:${frame}`
let mirrorSet = new Set<string>();
let frameClock = 0;

// Units with no row in the shipped atlas yet, drawn as a close cousin so
// placeholder art never leaks into the new style.
const PACK_ALIAS: Record<string, string> = { prism: "launcher", survivor: "human" };

// Self-initializing: every accessor kicks the load, so it works no matter
// which module instance or import order touches it first (Vite dev serves
// timestamped duplicate instances after HMR - relying on main.tsx alone left
// the renderer's instance empty and everything drew as steel boxes).
let initPromise: Promise<void> | null = null;

/** Load the atlases + manifests (memoized). Safe to fire-and-forget. */
export function initSpritePack(base = "/sprites"): Promise<void> {
  initPromise ??= doInit(base);
  return initPromise;
}

function kick(): void {
  initSpritePack().catch(() => { initPromise = null; }); // allow retry
}

async function doInit(base: string): Promise<void> {
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
    // Directional atlases (same layout): n = dorsal, e = profile,
    // se/ne = three-quarter turns. w/sw/nw are runtime mirrors of e/se/ne.
    const DIR_FILES: [string, string][] = [
      ["n", "back"], ["e", "dir_e"], ["se", "dir_se"], ["ne", "dir_ne"]];
    for (const [dir, file] of DIR_FILES) {
      try {
        const sheet2 = await Assets.load(`${base}/atlas_${file}_${tint}.png`);
        sheet2.source.scaleMode = "nearest";
        for (const [unit, info] of Object.entries(manifest.units)) {
          for (let f = 0; f < info.frames; f++) {
            packTextures.set(
              `${unit}:${tint}:${dir}:${f}`,
              new Texture({
                source: sheet2.source,
                frame: new Rectangle(f * t, info.row * t, t, t),
              }),
            );
          }
        }
      } catch {
        // direction pack not shipped: front frames cover this direction
      }
    }
  }

  const bres = await fetch(`${base}/buildings.json`);
  if (bres.ok) {
    bManifest = (await bres.json()) as BuildingsManifest;
    for (const tint of bManifest.tints) {
      const sheet = await Assets.load(`${base}/atlas_buildings_${tint}.png`);
      sheet.source.scaleMode = "nearest";
      for (const [b, info] of Object.entries(bManifest.buildings)) {
        for (let f = 0; f < info.frames; f++) {
          bTextures.set(
            `${b}:${tint}:${f}`,
            new Texture({
              source: sheet.source,
              frame: new Rectangle(info.x + f * info.cell, info.y, info.cell, info.cell),
            }),
          );
        }
      }
    }
  }

  loaded = true; // manifests fetched AND every texture registered

  // Global idle clock. Frame consumers pick frameClock % frames.
  setInterval(() => {
    frameClock++;
  }, 350);
}

/** True once EVERY atlas texture is registered (not just the manifest). */
export function packReady(): boolean {
  kick();
  return loaded;
}

function tintFor(owner: number): string {
  if (!manifest) return "neutral";
  return owner >= 0 && owner < manifest.tints.length - 1
    ? manifest.tints[owner]
    : "neutral";
}

// Pre-pack placeholder: a flat steel tile. Never the old procedural drawings.
let steelT: Texture | null = null;
function steelTexture(): Texture {
  if (!steelT) {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const g = c.getContext("2d")!;
    g.fillStyle = "#262b44";
    g.fillRect(0, 0, 32, 32);
    g.strokeStyle = "#181425";
    g.lineWidth = 2;
    g.strokeRect(1, 1, 30, 30);
    steelT = Texture.from(c);
  }
  return steelT;
}

/** Current-frame texture for a unit. */
export function getUnitTexture(type: string, owner: number): Texture {
  kick();
  if (manifest) {
    const packType = manifest.units[type] ? type : PACK_ALIAS[type];
    const info = packType ? manifest.units[packType] : undefined;
    if (packType && info) {
      const tex = packTextures.get(
        `${packType}:${tintFor(owner)}:${frameClock % info.frames}`,
      );
      if (tex) return tex;
    }
  }
  return steelTexture();
}

/** All idle frames for a unit facing `dir` ("s" front, "n", "e", "se", "ne");
 * falls back to the front frames when that direction isn't shipped. */
export function getUnitFrames(type: string, owner: number, dir = "s"): Texture[] {
  kick();
  if (!manifest) return [steelTexture()];
  const packType = manifest.units[type] ? type : PACK_ALIAS[type] ?? type;
  const info = manifest.units[packType];
  if (!info) return [steelTexture()];
  const tint = tintFor(owner);
  const out: Texture[] = [];
  for (let f = 0; f < info.frames; f++) {
    const tex = (dir !== "s"
      ? packTextures.get(`${packType}:${tint}:${dir}:${f}`) : undefined)
      ?? packTextures.get(`${packType}:${tint}:${f}`);
    if (tex) out.push(tex);
  }
  return out.length ? out : [steelTexture()];
}

/** Current-frame texture for a building. */
export function getBuildingTexture(type: string, owner: number, _span = 1): Texture {
  return getBuildingFrames(type, owner)[0];
}

/** All idle frames for a building (LED blinks, fire flicker...). */
export function getBuildingFrames(type: string, owner: number): Texture[] {
  kick();
  if (bManifest) {
    const info = bManifest.buildings[type];
    if (info) {
      const tint = tintFor(owner);
      const out: Texture[] = [];
      for (let f = 0; f < info.frames; f++) {
        const tex = bTextures.get(`${type}:${tint}:${f}`);
        if (tex) out.push(tex);
      }
      if (out.length) return out;
    }
  }
  return [steelTexture()];
}

/** Side-facing units (drawn facing right); mirror with scale.x = -1 to face left. */
export function unitFacesRight(type: string): boolean {
  return mirrorSet.has(type);
}
