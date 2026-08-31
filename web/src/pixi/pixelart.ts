// Procedural pixel-art sprites (mock assets): bighead robots, buildings and
// terrain drawn on tiny canvases and served to Pixi as nearest-neighbor
// textures. Replace with the commissioned pack later without touching the
// renderer interface (getUnitTexture / getBuildingTexture / getTileTexture).

import { Texture } from "pixi.js";

export interface Tint { p: string; s: string; g: string }

// Player tints (primary, shade, glow) + neutral for camps/guards.
export const TINTS: Tint[] = [
  { p: "#4fc3f7", s: "#2c7fa8", g: "#b3e5fc" },
  { p: "#ef5350", s: "#9c3230", g: "#ffcdd2" },
  { p: "#9ccc65", s: "#61863c", g: "#dcedc8" },
  { p: "#ffb74d", s: "#a8752c", g: "#ffe0b2" },
];
export const NEUTRAL_TINT: Tint = { p: "#b0bec5", s: "#6d7a82", g: "#eceff1" };

const OUT = "#0a0e13";
const VISOR = "#e6f7ff";
const PUPIL = "#123047";
const DARK = "#232a33";
const METAL = "#7d8894";
const ACCENT = "#ffd54f";
const GLOW = "#76ff03";
const RUST = "#8d5524";

type Ctx = CanvasRenderingContext2D;

function canvasOf(size: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** The trademark bighead: outlined box head with a visor and two pupils. */
function head(ctx: Ctx, x: number, y: number, w: number, h: number, tint: Tint,
              visorY = 1) {
  px(ctx, x - 1, y - 1, w + 2, h + 2, OUT);
  px(ctx, x, y, w, h, tint.p);
  px(ctx, x + w - 2, y, 2, h, tint.s);                 // right shade
  px(ctx, x + 1, y + visorY, w - 2, 2, VISOR);         // visor band
  const eyeGap = Math.max(Math.floor(w / 3), 2);
  px(ctx, x + 2, y + visorY, 1, 2, PUPIL);
  px(ctx, x + 2 + eyeGap, y + visorY, 1, 2, PUPIL);
  px(ctx, x + 1, y - 2, 1, 1, METAL);                  // antenna nub
}

function legs(ctx: Ctx, cx: number, y: number, spread: number) {
  px(ctx, cx - spread, y, 2, 2, OUT);
  px(ctx, cx + spread - 1, y, 2, 2, OUT);
}

const UNIT_PAINTERS: Record<string, (ctx: Ctx, t: Tint) => void> = {
  worker: (ctx, t) => {
    head(ctx, 4, 3, 8, 6, t);
    px(ctx, 6, 9, 4, 3, DARK);
    px(ctx, 10, 10, 3, 1, ACCENT);          // wrench arm
    legs(ctx, 8, 12, 2);
  },
  striker: (ctx, t) => {
    head(ctx, 3, 2, 10, 7, t);
    px(ctx, 5, 9, 6, 3, DARK);
    px(ctx, 2, 9, 3, 2, METAL);             // fists
    px(ctx, 11, 9, 3, 2, METAL);
    legs(ctx, 8, 12, 2);
  },
  launcher: (ctx, t) => {
    head(ctx, 3, 4, 9, 6, t);
    px(ctx, 9, 1, 3, 4, OUT);               // shoulder tube
    px(ctx, 10, 1, 1, 3, METAL);
    px(ctx, 10, 0, 1, 1, ACCENT);
    px(ctx, 5, 10, 5, 2, DARK);
    legs(ctx, 7, 12, 2);
  },
  rider: (ctx, t) => {
    head(ctx, 5, 1, 7, 5, t);
    px(ctx, 3, 6, 11, 3, DARK);             // quadruped chassis
    px(ctx, 3, 6, 11, 1, t.s);
    px(ctx, 3, 9, 2, 4, OUT);
    px(ctx, 7, 9, 2, 4, OUT);
    px(ctx, 12, 9, 2, 4, OUT);
  },
  wasp: (ctx, t) => {
    px(ctx, 2, 4, 4, 2, t.g);               // wings
    px(ctx, 10, 4, 4, 2, t.g);
    head(ctx, 5, 3, 6, 5, t);
    px(ctx, 7, 8, 2, 3, DARK);
    px(ctx, 7, 11, 2, 1, ACCENT);           // stinger
  },
  walking_tower: (ctx, t) => {
    head(ctx, 5, 0, 6, 4, t);               // top bighead
    head(ctx, 4, 5, 8, 4, t);               // middle bighead
    px(ctx, 3, 10, 10, 2, DARK);            // platform
    px(ctx, 3, 12, 2, 3, OUT);
    px(ctx, 11, 12, 2, 3, OUT);
    px(ctx, 6, 12, 4, 1, METAL);
  },
  drone_swarm: (ctx, t) => {
    for (const [dx, dy] of [[2, 2], [9, 1], [4, 8], [10, 8]] as const) {
      px(ctx, dx - 1, dy - 1, 5, 4, OUT);
      px(ctx, dx, dy, 3, 2, t.p);
      px(ctx, dx, dy, 2, 1, VISOR);
    }
  },
  colossus: (ctx, t) => {
    head(ctx, 2, 0, 12, 7, t, 2);
    px(ctx, 3, 7, 10, 5, DARK);
    px(ctx, 4, 8, 8, 1, t.s);
    px(ctx, 6, 9, 4, 2, GLOW);              // reactor
    px(ctx, 1, 7, 2, 4, METAL);
    px(ctx, 13, 7, 2, 4, METAL);
    legs(ctx, 8, 12, 4);
  },
  human: (ctx, t) => {
    px(ctx, 5, 2, 6, 5, OUT);               // hood
    px(ctx, 6, 3, 4, 3, t.s);
    px(ctx, 7, 4, 2, 1, VISOR);             // hidden face glint
    px(ctx, 6, 7, 4, 5, RUST);              // patched cloak
    px(ctx, 6, 8, 1, 2, t.p);
    px(ctx, 10, 6, 2, 1, METAL);            // rifle
    legs(ctx, 8, 12, 1);
  },
  spark: (ctx, t) => {
    head(ctx, 5, 5, 6, 4, t);
    px(ctx, 7, 9, 2, 2, DARK);
    legs(ctx, 8, 11, 1);
  },
  anvil: (ctx, t) => {
    head(ctx, 3, 3, 10, 5, t, 2);
    px(ctx, 2, 8, 12, 4, DARK);             // slab body
    px(ctx, 2, 8, 12, 1, METAL);
    legs(ctx, 8, 12, 3);
  },
  watcher: (ctx, t) => {
    px(ctx, 1, 5, 4, 2, t.g);               // wings
    px(ctx, 11, 5, 4, 2, t.g);
    px(ctx, 4, 3, 8, 7, OUT);
    px(ctx, 5, 4, 6, 5, t.p);
    px(ctx, 6, 5, 4, 3, VISOR);             // one big eye
    px(ctx, 7, 6, 2, 2, PUPIL);
  },
  leech: (ctx, t) => {
    px(ctx, 2, 8, 12, 4, OUT);              // low crawler
    px(ctx, 3, 9, 10, 2, t.p);
    px(ctx, 3, 9, 10, 1, t.g);
    head(ctx, 4, 3, 6, 4, t);
    px(ctx, 12, 7, 2, 2, ACCENT);           // siphon
  },
};

const BUILDING_PAINTERS: Record<string, (ctx: Ctx, t: Tint, size: number) => void> = {
  core: (ctx, t, s) => {
    px(ctx, 1, 1, s - 2, s - 2, OUT);
    px(ctx, 2, 2, s - 4, s - 4, t.s);
    px(ctx, 3, 3, s - 6, 3, t.p);
    px(ctx, 4, s - 7, s - 8, 3, DARK);
    // the core's own giant head/eye
    px(ctx, Math.floor(s / 2) - 5, Math.floor(s / 2) - 4, 10, 8, OUT);
    px(ctx, Math.floor(s / 2) - 4, Math.floor(s / 2) - 3, 8, 6, t.p);
    px(ctx, Math.floor(s / 2) - 3, Math.floor(s / 2) - 2, 6, 3, VISOR);
    px(ctx, Math.floor(s / 2) - 2, Math.floor(s / 2) - 1, 2, 2, PUPIL);
    px(ctx, Math.floor(s / 2) + 1, Math.floor(s / 2) - 1, 2, 2, PUPIL);
    px(ctx, 4, 2, 2, 2, GLOW);
    px(ctx, s - 6, 2, 2, 2, GLOW);
  },
  cocoon: (ctx, t, s) => {
    px(ctx, 4, 2, s - 8, s - 4, OUT);
    px(ctx, 5, 3, s - 10, s - 6, "#4a6b2f");
    px(ctx, 6, 4, s - 12, 4, GLOW);
    px(ctx, 6, 9, 2, 3, "#a5d6a7");
    px(ctx, 5, s - 3, s - 10, 1, t.s);      // owner clamp
  },
  rack: (ctx, t, s) => {
    px(ctx, 2, 1, s - 4, s - 2, OUT);
    px(ctx, 3, 2, s - 6, s - 4, DARK);
    for (let y = 3; y < s - 3; y += 3) {
      px(ctx, 4, y, s - 8, 2, METAL);
      px(ctx, 5, y, 1, 1, GLOW);
      px(ctx, 7, y, 1, 1, t.p);
    }
  },
  assembler: (ctx, t, s) => {
    px(ctx, 1, 4, s - 2, s - 5, OUT);
    px(ctx, 2, 5, s - 4, s - 7, DARK);
    px(ctx, 2, 5, s - 4, 3, t.s);
    px(ctx, 4, 1, 4, 4, OUT);               // chimney
    px(ctx, 5, 2, 2, 3, METAL);
    px(ctx, Math.floor(s / 2), 2, 2, 1, "#90a4ae"); // smoke puff
    px(ctx, 4, Math.floor(s / 2) + 2, s - 8, 4, OUT); // door
    px(ctx, 5, Math.floor(s / 2) + 3, s - 10, 2, ACCENT);
  },
  turret: (ctx, t, s) => {
    px(ctx, 3, s - 5, s - 6, 4, OUT);
    px(ctx, 4, s - 4, s - 8, 2, METAL);
    px(ctx, 5, 4, 6, 6, OUT);
    px(ctx, 6, 5, 4, 4, t.p);
    px(ctx, 7, 6, 2, 1, VISOR);
    px(ctx, 10, 5, 5, 2, OUT);              // barrel
    px(ctx, 11, 5, 4, 1, METAL);
  },
  camp: (ctx, _t, s) => {
    px(ctx, 2, 6, s - 4, s - 8, OUT);       // tent
    px(ctx, 3, 7, s - 6, s - 10, RUST);
    px(ctx, Math.floor(s / 2) - 1, 7, 2, s - 10, "#5d4037");
    px(ctx, 11, 3, 1, 4, METAL);            // flag pole
    px(ctx, 12, 3, 3, 2, "#cfd8dc");
    px(ctx, 4, s - 3, 3, 1, ACCENT);        // campfire
  },
};

const cache = new Map<string, Texture>();

function toTexture(canvas: HTMLCanvasElement): Texture {
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "nearest";
  return texture;
}

function tintOf(owner: number): Tint {
  return owner >= 0 ? TINTS[owner % TINTS.length] : NEUTRAL_TINT;
}

export function getUnitTexture(type: string, owner: number): Texture {
  const key = `u:${type}:${owner}`;
  let tex = cache.get(key);
  if (!tex) {
    const [canvas, ctx] = canvasOf(16);
    (UNIT_PAINTERS[type] ?? UNIT_PAINTERS.striker)(ctx, tintOf(owner));
    tex = toTexture(canvas);
    cache.set(key, tex);
  }
  return tex;
}

export function getBuildingTexture(type: string, owner: number, tiles: number): Texture {
  const key = `b:${type}:${owner}:${tiles}`;
  let tex = cache.get(key);
  if (!tex) {
    const size = 16 * tiles;
    const [canvas, ctx] = canvasOf(size);
    (BUILDING_PAINTERS[type] ?? BUILDING_PAINTERS.rack)(ctx, tintOf(owner), size);
    tex = toTexture(canvas);
    cache.set(key, tex);
  }
  return tex;
}
