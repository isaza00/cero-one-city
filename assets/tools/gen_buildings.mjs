// Building sprite pack generator - same style law as the unit pack v4
// (assets/style-page.md): Endesga-32 only, gunmetal steel bodies, 1px #181425
// outlines, lineage color ONLY in glows, battle wear, menacing industrial.
//
// Draws with the dependency-free pixel canvas in ./pixelcanvas.mjs (plain
// Node, no browser, no node-canvas), then writes per-tint atlases + manifest
// to assets/sprites/ and web/public/sprites/.
//
//   node assets/tools/gen_buildings.mjs
//
// Atlas layout (384x96 per tint):
//   row 0 (64px cells): core f0,f1 · assembler f0,f1 · lab f0,f1
//   row 1 (32px cells): cocoon f0,f1 · rack f0,f1 · turret f0,f1 · camp f0,f1 ·
//                       depot f0,f1 · wall f0,f1
//
// AoE2 mapping: core = town center, cocoon = farm, rack = house, depot = mining
// camp / mill, assembler = barracks, lab = blacksmith, turret = tower, wall =
// palisade, camp = neutral village.

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { PixelCanvas } from "./pixelcanvas.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const TINTS = {
  swarm: ["#2ce8f5", "#0099db"],
  forge: ["#e43b44", "#a22633"],
  oracle: ["#63c74d", "#3e8948"],
  parasite: ["#feae34", "#d77643"],
  neutral: ["#c0cbdc", "#8b9bb4"],
};

const atlases = ((tints) => {
  // Palette (Endesga 32)
  const OUT = "#181425", S1 = "#262b44", S2 = "#3a4466", S3 = "#5a6988",
        S4 = "#8b9bb4", S5 = "#c0cbdc", W = "#ffffff",
        RUST = "#b86f50", RUST2 = "#733e39";
  const FIRE1 = "#feae34", FIRE2 = "#e43b44"; // campfire is always warm

  function ctx2(w, h) {
    const c = new PixelCanvas(w, h);
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    return [c, g];
  }
  const px = (g, x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
  const rect = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const frame = (g, x, y, w, h, c) => { // 1px outline rectangle
    rect(g, x, y, w, 1, c); rect(g, x, y + h - 1, w, 1, c);
    rect(g, x, y, 1, h, c); rect(g, x + w - 1, y, 1, h, c);
  };

  // ---------------------------------------------------------------- CORE 64
  // Command fortress in 3/4 view: roof plane + facade, skull-branded gate,
  // corner watchtowers, beacon mast. Reads as the settlement's keep.
  function core(g, [G1, G2], f) {
    // ground plate
    rect(g, 2, 55, 60, 7, OUT); rect(g, 3, 56, 58, 5, S1);
    px(g, 6, 58, S2); px(g, 57, 58, S2); px(g, 30, 59, S2);
    // keep: roof plane (light) over facade (dark)
    rect(g, 9, 20, 46, 12, OUT); rect(g, 10, 21, 44, 10, S3);   // roof
    rect(g, 10, 21, 44, 2, S4);                                  // roof back lip
    rect(g, 8, 30, 48, 26, OUT); rect(g, 9, 31, 46, 24, S2);    // facade
    rect(g, 9, 31, 46, 1, S4);                                   // eave highlight
    // roof clutter: vents + dish
    rect(g, 14, 24, 5, 3, S1); rect(g, 26, 23, 5, 3, S1); rect(g, 38, 24, 5, 3, S1);
    rect(g, 46, 22, 6, 2, S5); px(g, 48, 21, S4);                // dish
    // gate with skull brand
    rect(g, 25, 38, 14, 18, OUT); rect(g, 26, 39, 12, 16, S1);
    rect(g, 31, 39, 2, 16, f ? G2 : S2);                         // door seam glow
    rect(g, 27, 32, 10, 6, S4);                                  // skull plate
    px(g, 29, 34, f ? G1 : G2); px(g, 34, 34, f ? G1 : G2);      // eyes
    rect(g, 28, 37, 8, 1, S5);                                   // teeth
    // wall lights
    for (let i = 0; i < 4; i++) px(g, 13 + i * 12, 35, (i + (f ? 1 : 0)) % 2 ? G2 : S3);
    // corner watchtowers
    rect(g, 3, 16, 10, 40, OUT); rect(g, 4, 17, 8, 38, S2);
    rect(g, 2, 13, 12, 5, OUT); rect(g, 3, 14, 10, 3, S3);
    rect(g, 51, 16, 10, 40, OUT); rect(g, 52, 17, 8, 38, S2);
    rect(g, 50, 13, 12, 5, OUT); rect(g, 51, 14, 10, 3, S3);
    px(g, 7, 22, G2); px(g, 7, 34, G2); px(g, 56, 22, G2); px(g, 56, 34, G2);
    // beacon mast on the right tower
    rect(g, 55, 4, 2, 9, S3);
    px(g, 55, 3, f ? G1 : G2); px(g, 56, 3, f ? G1 : G2);
    // battle wear
    px(g, 11, 52, RUST); px(g, 49, 41, RUST2); px(g, 42, 54, RUST);
    px(g, 5, 44, RUST2);
  }

  // ----------------------------------------------------------- ASSEMBLER 64
  // Factory hall in 3/4 view: sawtooth roof, big hazard-striped door,
  // conveyor spilling onto the pad, chimney, working crane. Sparks weld.
  function assembler(g, [G1, G2], f) {
    // ground plate
    rect(g, 2, 55, 60, 7, OUT); rect(g, 3, 56, 58, 5, S1);
    // hall facade
    rect(g, 6, 30, 52, 26, OUT); rect(g, 7, 31, 50, 24, S2);
    rect(g, 7, 31, 50, 1, S4);
    // sawtooth roof: three teeth, lit top faces
    for (let i = 0; i < 3; i++) {
      const x = 7 + i * 17;
      rect(g, x, 22, 17, 9, OUT);
      rect(g, x + 1, 23, 10, 7, S3); rect(g, x + 1, 23, 10, 1, S4); // lit face
      rect(g, x + 11, 23, 5, 7, S1);                                 // dark riser
      px(g, x + 12, 25, (i + (f ? 1 : 0)) % 2 ? G2 : S2);            // skylight
    }
    // chimney + smoke
    rect(g, 48, 10, 8, 13, OUT); rect(g, 49, 11, 6, 11, S1);
    rect(g, 47, 10, 10, 2, S3);
    if (f) { px(g, 51, 8, S3); px(g, 53, 6, S2); } else { px(g, 52, 7, S3); }
    // crane over the yard
    rect(g, 8, 14, 24, 3, OUT); rect(g, 9, 15, 22, 1, S3);
    const drop = f ? 4 : 0;
    rect(g, 19, 17, 1, 5 + drop, S5); rect(g, 17, 22 + drop, 5, 2, S3);
    // big door with hazard stripes + inner glow
    rect(g, 24, 38, 16, 18, OUT); rect(g, 25, 39, 14, 16, S1);
    for (let i = 0; i < 7; i++) rect(g, 25 + i * 2, 36, 2, 2, i % 2 ? OUT : FIRE1);
    rect(g, 26, 44, 12, 2, f ? G2 : S2); // furnace line inside
    // conveyor exiting the door
    rect(g, 26, 56, 12, 4, OUT); rect(g, 27, 57, 10, 2, S2);
    px(g, 29, 58, S1); px(g, 33, 58, S1);
    // side windows
    px(g, 12, 36, G2); px(g, 16, 36, G2); px(g, 47, 36, G2); px(g, 51, 36, G2);
    // weld sparks in the doorway
    if (f) { px(g, 28, 48, W); px(g, 27, 50, G1); }
    else { px(g, 36, 49, W); px(g, 37, 47, G1); }
    // wear
    px(g, 8, 52, RUST); px(g, 55, 34, RUST2); px(g, 44, 54, RUST);
  }

  // -------------------------------------------------------------- COCOON 32
  // Human energy capsule - the Matrix farm pod. A person floats in glow
  // liquid; bubbles rise; cables feed the grid.
  function cocoon(g, [G1, G2], f) {
    // pad
    rect(g, 5, 26, 22, 5, OUT); rect(g, 6, 27, 20, 3, S1);
    // capsule shell with rounded cap
    rect(g, 12, 3, 8, 3, OUT); rect(g, 13, 4, 6, 1, S3);
    rect(g, 10, 5, 12, 22, OUT); rect(g, 11, 6, 10, 20, S2);
    rect(g, 11, 6, 2, 20, S3); // left sheen
    // glass window: glow liquid
    rect(g, 12, 8, 8, 15, OUT);
    rect(g, 13, 9, 6, 13, G2);
    rect(g, 13, 9, 1, 13, G1); // liquid light column
    // the sleeping human (dark silhouette)
    rect(g, 15, 11, 2, 2, OUT);             // head
    rect(g, 14, 13, 4, 4, OUT);             // torso, arms folded
    rect(g, 15, 17, 1, 3, OUT); rect(g, 16, 17, 1, 3, OUT); // legs
    // rising bubbles
    if (f) { px(g, 14, 10, W); px(g, 18, 15, W); }
    else { px(g, 18, 10, W); px(g, 14, 18, W); }
    // feed cables into the ground
    px(g, 22, 6, S3); px(g, 24, 8, S3); px(g, 25, 11, S3); px(g, 25, 15, S3);
    rect(g, 8, 16, 2, 8, S3); // return tube
    // clamps
    rect(g, 9, 24, 3, 3, S1); rect(g, 20, 24, 3, 3, S1);
    px(g, 11, 7, RUST2);
  }

  // ---------------------------------------------------------------- RACK 32
  // Server monolith with a roof cap and cooling fins; LEDs think.
  function rack(g, [G1, G2], f) {
    // pad
    rect(g, 4, 28, 24, 3, OUT); rect(g, 5, 29, 22, 1, S1);
    // roof cap
    rect(g, 5, 2, 22, 4, OUT); rect(g, 6, 3, 20, 2, S3); px(g, 8, 3, S4);
    rect(g, 6, 5, 20, 24, OUT); rect(g, 7, 6, 18, 22, S2);
    for (let s = 0; s < 4; s++) {
      const y = 7 + s * 5;
      rect(g, 8, y, 16, 4, S1);
      rect(g, 8, y, 1, 4, S3); rect(g, 23, y, 1, 4, S3); // handles
      // LED pattern alternates per frame
      const on = (s + (f ? 1 : 0)) % 2 === 0;
      px(g, 19, y + 1, on ? G1 : G2);
      px(g, 21, y + 1, on ? G2 : S3);
      px(g, 19, y + 2, on ? G2 : S3);
    }
    // cooling fins
    for (let i = 0; i < 3; i++) { rect(g, 3, 8 + i * 6, 3, 3, S1); rect(g, 26, 8 + i * 6, 3, 3, S1); }
    // top cable to the grid
    px(g, 27, 3, S3); px(g, 28, 5, S3); px(g, 29, 8, G2);
    px(g, 24, 14, RUST);
  }

  // -------------------------------------------------------------- TURRET 32
  // Squat sentry pod, twin barrels, one burning eye.
  function turret(g, [G1, G2], f) {
    const rec = f ? 1 : 0;
    // base + pedestal
    rect(g, 5, 24, 22, 7, OUT); rect(g, 6, 25, 20, 5, S1);
    px(g, 8, 27, S3); px(g, 23, 27, S3);
    rect(g, 12, 19, 8, 6, OUT); rect(g, 13, 20, 6, 4, S2);
    // pod
    rect(g, 7, 7 + rec, 18, 13, OUT); rect(g, 8, 8 + rec, 16, 11, S3);
    rect(g, 8, 8 + rec, 16, 2, S4); // top sheen
    // eye slit
    rect(g, 11, 11 + rec, 10, 5, OUT);
    rect(g, 13, 12 + rec, 6, 3, G2); rect(g, 14, 13 + rec, 4, 1, G1);
    // twin barrels (front-down)
    rect(g, 10, 19 + rec, 3, 6, OUT); rect(g, 19, 19 + rec, 3, 6, OUT);
    rect(g, 11, 19 + rec, 1, 5, S5); rect(g, 20, 19 + rec, 1, 5, S5);
    px(g, 24, 9 + rec, RUST2);
  }

  // ---------------------------------------------------------------- CAMP 32
  // The human holdout village: two tarp tents, fence, salvaged solar panel,
  // and a fire that never dies.
  function camp(g, [G1], f) {
    // big tent
    for (let i = 0; i < 10; i++) {
      rect(g, 12 - i, 8 + i, 2 + i * 2, 1, i % 4 === 3 ? RUST2 : RUST);
    }
    rect(g, 2, 18, 22, 1, OUT);
    rect(g, 12, 4, 1, 5, OUT);          // pole
    rect(g, 13, 4, 4, 2, G1);           // lineage pennant
    rect(g, 10, 14, 5, 4, OUT);         // door shadow
    // small tent, right
    for (let i = 0; i < 6; i++) {
      rect(g, 25 - i, 13 + i, 2 + i * 2, 1, i % 3 === 2 ? RUST : RUST2);
    }
    rect(g, 19, 19, 13, 1, OUT);
    // salvaged solar panel leaning on scrap
    rect(g, 2, 21, 7, 3, OUT); rect(g, 3, 22, 5, 1, S3);
    px(g, f ? 4 : 6, 22, S5);           // glint wanders
    // fence posts
    for (let i = 0; i < 4; i++) rect(g, 3 + i * 3, 27, 1, 3, RUST2);
    rect(g, 2, 28, 11, 1, RUST);
    // campfire (always warm - fire doesn't care about software)
    rect(g, 20, 28, 8, 2, RUST2);
    if (f) { px(g, 22, 26, FIRE2); rect(g, 23, 24, 2, 3, FIRE1); px(g, 23, 23, W); }
    else { px(g, 26, 26, FIRE2); rect(g, 22, 25, 2, 2, FIRE1); px(g, 24, 24, W); }
    // clutter: crate + scrap
    rect(g, 15, 26, 4, 4, S1); px(g, 16, 27, S3);
    px(g, 29, 21, S3); px(g, 6, 19, S3);
  }

  // ----------------------------------------------------------------- LAB 64
  // The blacksmith: a research hall with a domed reactor roof, twin tesla
  // coils that arc on the odd frame, a glass front showing the glowing
  // reactor column, and a skull plate over the door.
  function lab(g, [G1, G2], f) {
    // ground plate
    rect(g, 2, 55, 60, 7, OUT); rect(g, 3, 56, 58, 5, S1);
    px(g, 8, 58, S2); px(g, 55, 58, S2);
    // hall facade
    rect(g, 8, 30, 48, 26, OUT); rect(g, 9, 31, 46, 24, S2);
    rect(g, 9, 31, 46, 1, S4);
    // flat roof with a dome in the middle
    rect(g, 8, 24, 48, 8, OUT); rect(g, 9, 25, 46, 6, S3); rect(g, 9, 25, 46, 1, S4);
    rect(g, 22, 14, 20, 12, OUT); rect(g, 23, 15, 18, 10, S3);   // dome block
    rect(g, 25, 11, 14, 5, OUT); rect(g, 26, 12, 12, 3, S4);     // dome cap
    rect(g, 29, 9, 6, 3, OUT); rect(g, 30, 10, 4, 1, S5);        // cap lip
    px(g, 31, 8, f ? G1 : G2); px(g, 32, 8, f ? G1 : G2);        // dome beacon
    // twin tesla coils on the roof corners
    for (const x of [12, 48]) {
      rect(g, x, 16, 4, 10, OUT); rect(g, x + 1, 17, 2, 8, S3);
      rect(g, x - 1, 13, 6, 4, OUT); rect(g, x, 14, 4, 2, S4);
      px(g, x + 1, 12, f ? G1 : G2); px(g, x + 2, 12, f ? G1 : G2);
    }
    if (f) { // arc between the coils
      for (let i = 0; i < 8; i++) px(g, 17 + i * 4, 13 + (i % 2), G1);
      px(g, 33, 12, W);
    } else {
      px(g, 25, 13, G2); px(g, 39, 13, G2);
    }
    // glass front: reactor column glowing behind
    rect(g, 18, 36, 28, 18, OUT); rect(g, 19, 37, 26, 16, S1);
    rect(g, 30, 38, 4, 14, f ? G1 : G2);                          // reactor core
    rect(g, 26, 40, 3, 10, G2); rect(g, 35, 40, 3, 10, G2);       // side tubes
    rect(g, 19, 44, 26, 1, S2);                                   // mullion
    // skull plate over the door
    rect(g, 27, 31, 10, 5, S4); px(g, 29, 33, f ? G2 : G1); px(g, 34, 33, f ? G2 : G1);
    rect(g, 28, 35, 8, 1, S5);
    // side vents
    for (let i = 0; i < 3; i++) { rect(g, 11, 38 + i * 5, 5, 2, S1); rect(g, 48, 38 + i * 5, 5, 2, S1); }
    // wear
    px(g, 10, 52, RUST); px(g, 53, 33, RUST2); px(g, 44, 54, RUST); px(g, 23, 27, RUST2);
  }

  // --------------------------------------------------------------- DEPOT 32
  // The mining camp / mill: a squat loading bunker with a hazard-striped
  // pad, a crate stack, a small crane that dips on the odd frame and one
  // lineage lamp so workers find it in the dark.
  function depot(g, [G1, G2], f) {
    // pad with hazard stripes at the front
    rect(g, 3, 24, 26, 7, OUT); rect(g, 4, 25, 24, 5, S1);
    for (let i = 0; i < 12; i++) rect(g, 4 + i * 2, 29, 2, 1, i % 2 ? OUT : FIRE1);
    // bunker body
    rect(g, 6, 12, 18, 14, OUT); rect(g, 7, 13, 16, 12, S2);
    rect(g, 7, 13, 16, 1, S4);
    rect(g, 5, 9, 20, 5, OUT); rect(g, 6, 10, 18, 3, S3);   // roof lip
    // roller door
    rect(g, 10, 17, 10, 9, OUT); rect(g, 11, 18, 8, 7, S1);
    rect(g, 11, 20, 8, 1, S2); rect(g, 11, 22, 8, 1, S2);
    // crate stack beside the door
    rect(g, 24, 18, 6, 6, OUT); rect(g, 25, 19, 4, 4, RUST);
    px(g, 26, 20, RUST2); px(g, 27, 21, RUST2);
    rect(g, 25, 14, 5, 5, OUT); rect(g, 26, 15, 3, 3, S3);
    // crane arm
    rect(g, 2, 4, 2, 21, S3); rect(g, 2, 4, 12, 2, S3);
    const drop = f ? 3 : 0;
    rect(g, 12, 6, 1, 4 + drop, S5); rect(g, 10, 10 + drop, 5, 2, S4);
    // lineage lamp
    rect(g, 20, 10, 3, 3, OUT); px(g, 21, 11, f ? G1 : G2);
    px(g, 21, 8, G2);
    // wear
    px(g, 8, 24, RUST2); px(g, 22, 16, RUST);
  }

  // ---------------------------------------------------------------- WALL 32
  // Palisade segment: two riveted posts and welded steel plates with one
  // glow strip along the top edge (blinks on the odd frame).
  function wall(g, [G1, G2], f) {
    // ground shadow
    rect(g, 3, 27, 26, 3, OUT); rect(g, 4, 28, 24, 1, S1);
    // plates
    rect(g, 4, 10, 24, 18, OUT); rect(g, 5, 11, 22, 16, S2);
    rect(g, 5, 11, 22, 1, S4);
    rect(g, 5, 18, 22, 1, OUT);                       // plate seam
    rect(g, 15, 11, 1, 16, OUT);                      // vertical seam
    // rivets
    for (const y of [13, 21]) for (const x of [7, 12, 18, 24]) px(g, x, y, S4);
    for (const y of [15, 23]) for (const x of [9, 22]) px(g, x, y, S1);
    // posts
    rect(g, 2, 6, 5, 23, OUT); rect(g, 3, 7, 3, 21, S3); rect(g, 3, 7, 3, 1, S5);
    rect(g, 25, 6, 5, 23, OUT); rect(g, 26, 7, 3, 21, S3); rect(g, 26, 7, 3, 1, S5);
    // glow strip
    rect(g, 7, 9, 18, 1, f ? G1 : G2);
    px(g, 4, 5, f ? G2 : S3); px(g, 27, 5, f ? S3 : G2);
    // wear
    px(g, 9, 25, RUST); px(g, 21, 14, RUST2); px(g, 26, 20, RUST2);
  }

  // ------------------------------------------------------------- compose
  const out = {};
  const canvases = {};
  for (const [tint, glow] of Object.entries(tints)) {
    const [atlas, g] = ctx2(384, 96);
    const big = [core, assembler, lab];
    big.forEach((draw, bi) => {
      for (let f = 0; f < 2; f++) {
        const [c, cg] = ctx2(64, 64);
        draw(cg, glow, f);
        g.drawImage(c, bi * 128 + f * 64, 0);
      }
    });
    const small = [cocoon, rack, turret, camp, depot, wall];
    small.forEach((draw, si) => {
      for (let f = 0; f < 2; f++) {
        const [c, cg] = ctx2(32, 32);
        draw(cg, glow, f);
        g.drawImage(c, si * 64 + f * 32, 64);
      }
    });
    out[tint] = atlas.toDataURL("image/png");
    canvases[tint] = atlas;
  }
  return { atlases: out, canvases };
})(TINTS);

const spritesDir = join(root, "assets", "sprites");
const webDir = join(root, "web", "public", "sprites");
mkdirSync(spritesDir, { recursive: true });
mkdirSync(webDir, { recursive: true });

const manifest = {
  tints: Object.keys(TINTS),
  buildings: {
    core: { x: 0, y: 0, cell: 64, frames: 2 },
    assembler: { x: 128, y: 0, cell: 64, frames: 2 },
    lab: { x: 256, y: 0, cell: 64, frames: 2 },
    cocoon: { x: 0, y: 64, cell: 32, frames: 2 },
    rack: { x: 64, y: 64, cell: 32, frames: 2 },
    turret: { x: 128, y: 64, cell: 32, frames: 2 },
    camp: { x: 192, y: 64, cell: 32, frames: 2 },
    depot: { x: 256, y: 64, cell: 32, frames: 2 },
    wall: { x: 320, y: 64, cell: 32, frames: 2 },
  },
};

for (const [tint, dataUrl] of Object.entries(atlases.atlases)) {
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");
  writeFileSync(join(spritesDir, `atlas_buildings_${tint}.png`), buf);
  writeFileSync(join(webDir, `atlas_buildings_${tint}.png`), buf);
}
writeFileSync(join(spritesDir, "buildings.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(webDir, "buildings.json"), JSON.stringify(manifest, null, 2));

// Contact sheet (4x zoom, all tints) for human review.
const tintCanvases = Object.values(atlases.canvases);
const sheet = new PixelCanvas(384 * 4, tintCanvases.length * 96 * 4);
const sg = sheet.getContext("2d");
sg.fillStyle = "#0d1117";
sg.fillRect(0, 0, sheet.width, sheet.height);
tintCanvases.forEach((img, i) => sg.drawImage(img, 0, i * 96 * 4, 384 * 4, 96 * 4));
writeFileSync(join(spritesDir, "buildings_contact_sheet.png"), sheet.toPNG());

console.log("building pack written:", Object.keys(atlases.atlases).join(", "));
