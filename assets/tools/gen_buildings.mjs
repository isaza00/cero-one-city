// Building sprite pack generator - same style law as the unit pack v4
// (assets/style-page.md): Endesga-32 only, gunmetal steel bodies, 1px #181425
// outlines, lineage color ONLY in glows, battle wear, menacing industrial.
//
// Draws with a headless-Chromium canvas (no node-canvas dependency), then
// writes per-tint atlases + manifest to assets/sprites/ and web/public/sprites/.
//
//   node assets/tools/gen_buildings.mjs
//
// Atlas layout (256x96 per tint):
//   row 0 (64px cells): core f0, core f1, assembler f0, assembler f1
//   row 1 (32px cells): cocoon f0,f1 · rack f0,f1 · turret f0,f1 · camp f0,f1

import { createRequire } from "module";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { chromium } = createRequire(join(root, "web", "package.json"))("playwright");

const TINTS = {
  swarm: ["#2ce8f5", "#0099db"],
  forge: ["#e43b44", "#a22633"],
  oracle: ["#63c74d", "#3e8948"],
  parasite: ["#feae34", "#d77643"],
  neutral: ["#c0cbdc", "#8b9bb4"],
};

const browser = await chromium.launch();
const page = await browser.newPage();

const atlases = await page.evaluate((tints) => {
  // Palette (Endesga 32)
  const OUT = "#181425", S1 = "#262b44", S2 = "#3a4466", S3 = "#5a6988",
        S4 = "#8b9bb4", S5 = "#c0cbdc", W = "#ffffff",
        RUST = "#b86f50", RUST2 = "#733e39";
  const FIRE1 = "#feae34", FIRE2 = "#e43b44"; // campfire is always warm

  function ctx2(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
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
  // Armored bunker with the skull brand embedded front and center.
  function core(g, [G1, G2], f) {
    // base platform + fortress block
    rect(g, 3, 54, 58, 8, OUT); rect(g, 4, 55, 56, 6, S1);
    rect(g, 5, 20, 54, 36, OUT); rect(g, 6, 21, 52, 34, S2);
    rect(g, 6, 21, 52, 3, S3); // top bevel
    // corner buttresses
    rect(g, 6, 24, 8, 31, S1); rect(g, 50, 24, 8, 31, S1);
    px(g, 9, 28, S3); px(g, 9, 36, S3); px(g, 9, 44, S3);
    px(g, 54, 28, S3); px(g, 54, 36, S3); px(g, 54, 44, S3);
    // skull: dome
    rect(g, 19, 10, 26, 8, OUT); rect(g, 20, 11, 24, 6, S4);
    rect(g, 22, 12, 20, 2, S5);
    px(g, 24 + (f ? 12 : 0), 12, W); // roaming dome light
    // cranium
    rect(g, 17, 17, 30, 24, OUT); rect(g, 18, 18, 28, 22, S4);
    // eye sockets + glow eyes
    rect(g, 21, 22, 9, 8, OUT); rect(g, 34, 22, 9, 8, OUT);
    const e = f ? 1 : 0;
    rect(g, 23 - e + 1, 24, 4 + e, 4, G2); rect(g, 24, 25, 3, 2, G1);
    rect(g, 36, 24, 4 + e, 4, G2); rect(g, 37, 25, 3, 2, G1);
    // nasal + teeth (endoskeleton over dark vent)
    rect(g, 30, 30, 4, 3, OUT);
    rect(g, 20, 34, 24, 6, OUT);
    for (let i = 0; i < 6; i++) rect(g, 21 + i * 4, 35, 2, 4, i % 2 ? S5 : S4);
    // jaw plate
    rect(g, 18, 40, 28, 4, S3); rect(g, 18, 43, 28, 1, S1);
    // side vents on the block
    for (let i = 0; i < 3; i++) { rect(g, 8, 47 + i * 2, 4, 1, S3); rect(g, 52, 47 + i * 2, 4, 1, S3); }
    // beacon mast
    rect(g, 47, 4, 2, 8, S3);
    px(g, 47, 3, f ? G1 : G2); px(g, 48, 3, f ? G1 : G2);
    // wear
    px(g, 12, 52, RUST); px(g, 51, 33, RUST2); px(g, 44, 53, RUST);
    px(g, 19, 41, RUST2);
  }

  // ----------------------------------------------------------- ASSEMBLER 64
  // Factory gantry with a half-built skull on the line. Sparks weld.
  function assembler(g, [G1, G2], f) {
    // floor + conveyor
    rect(g, 3, 54, 58, 8, OUT); rect(g, 4, 55, 56, 6, S1);
    rect(g, 7, 44, 50, 10, OUT); rect(g, 8, 45, 48, 8, S2);
    for (let i = 0; i < 12; i++) px(g, 10 + i * 4, 51, S1); // rollers
    // side towers
    rect(g, 3, 14, 12, 42, OUT); rect(g, 4, 15, 10, 40, S2);
    rect(g, 49, 14, 12, 42, OUT); rect(g, 50, 15, 10, 40, S2);
    rect(g, 5, 17, 8, 2, S3); rect(g, 51, 17, 8, 2, S3);
    // cross beam with hazard stripes
    rect(g, 3, 14, 58, 8, OUT); rect(g, 4, 15, 56, 6, S3);
    for (let i = 0; i < 14; i++) rect(g, 4 + i * 4, 15, 2, 2, i % 2 ? S5 : S1);
    // chimney
    rect(g, 8, 4, 8, 10, OUT); rect(g, 9, 5, 6, 8, S1);
    if (!f) { px(g, 11, 3, G2); px(g, 12, 2, G2); }
    // crane cable + claw (frame moves it)
    const drop = f ? 6 : 0;
    rect(g, 31, 22, 2, 6 + drop, S5);
    rect(g, 29, 28 + drop, 6, 3, S3);
    // half-built skull on the line
    rect(g, 24, 30, 16, 15, OUT); rect(g, 25, 31, 14, 13, S4);
    rect(g, 27, 34, 4, 4, OUT);                 // empty socket
    rect(g, 33, 34, 4, 4, OUT); rect(g, 34, 35, 2, 2, G1); // lit eye
    rect(g, 25, 40, 14, 2, S3);                 // unfinished jaw line
    // weld sparks
    if (f) { px(g, 24, 42, W); px(g, 23, 44, G1); }
    else { px(g, 40, 43, W); px(g, 41, 41, G1); }
    // wear
    px(g, 6, 52, RUST); px(g, 56, 24, RUST2);
  }

  // -------------------------------------------------------------- COCOON 32
  // Caged energy egg; the orb breathes.
  function cocoon(g, [G1, G2], f) {
    rect(g, 12, 3, 8, 4, OUT); rect(g, 13, 4, 6, 2, S2); // top valve
    // shell
    rect(g, 8, 6, 16, 22, OUT); rect(g, 9, 7, 14, 20, S2);
    // ribs
    rect(g, 9, 7, 2, 20, S3); rect(g, 15, 7, 2, 20, S3); rect(g, 21, 7, 2, 20, S3);
    // orb window
    const grow = f ? 1 : 0;
    rect(g, 12 - grow, 12 - grow, 8 + grow * 2, 10 + grow * 2, OUT);
    rect(g, 13 - grow, 13 - grow, 6 + grow * 2, 8 + grow * 2, G2);
    rect(g, 14, 15, 4, 4, G1);
    px(g, f ? 16 : 14, 14, W);
    // base clamp
    rect(g, 6, 26, 20, 5, OUT); rect(g, 7, 27, 18, 3, S1);
    px(g, 10, 28, S3); px(g, 21, 28, S3);
    px(g, 9, 9, RUST2);
  }

  // ---------------------------------------------------------------- RACK 32
  // Server monolith; LEDs think.
  function rack(g, [G1, G2], f) {
    rect(g, 6, 3, 20, 27, OUT); rect(g, 7, 4, 18, 25, S2);
    for (let s = 0; s < 5; s++) {
      const y = 5 + s * 5;
      rect(g, 8, y, 16, 4, S1);
      rect(g, 8, y, 1, 4, S3); rect(g, 23, y, 1, 4, S3); // handles
      // LED pattern alternates per frame
      const on = (s + (f ? 1 : 0)) % 2 === 0;
      px(g, 19, y + 1, on ? G1 : G2);
      px(g, 21, y + 1, on ? G2 : S3);
      px(g, 19, y + 2, on ? G2 : S3);
    }
    // feet + top cable
    rect(g, 7, 29, 4, 2, S1); rect(g, 21, 29, 4, 2, S1);
    px(g, 26, 4, S3); px(g, 27, 5, S3); px(g, 28, 7, G2);
    px(g, 24, 12, RUST);
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
  // The human holdout: tarp tent, sandbags, a fire that never dies.
  function camp(g, [G1], f) {
    // tent
    for (let i = 0; i < 11; i++) { // triangle tarp
      rect(g, 15 - i, 9 + i, 2 + i * 2, 1, i % 4 === 3 ? RUST2 : RUST);
    }
    rect(g, 4, 20, 24, 1, OUT);
    rect(g, 15, 5, 1, 5, OUT); // pole
    // lineage pennant
    rect(g, 16, 5, 4, 2, G1);
    // door shadow
    rect(g, 13, 15, 5, 5, OUT);
    // sandbags
    for (let i = 0; i < 3; i++) rect(g, 3 + i * 4, 26, 4, 3, i % 2 ? RUST : RUST2);
    rect(g, 3, 25, 12, 1, OUT);
    // campfire (always warm - fire doesn't care about software)
    rect(g, 21, 27, 7, 2, RUST2);
    if (f) { px(g, 23, 25, FIRE2); rect(g, 24, 23, 2, 3, FIRE1); px(g, 24, 22, W); }
    else { px(g, 26, 25, FIRE2); rect(g, 23, 24, 2, 2, FIRE1); px(g, 25, 23, W); }
    px(g, 6, 21, S3); px(g, 24, 20, S3); // scrap bits
  }

  // ------------------------------------------------------------- compose
  const out = {};
  for (const [tint, glow] of Object.entries(tints)) {
    const [atlas, g] = ctx2(256, 96);
    const big = [core, assembler];
    big.forEach((draw, bi) => {
      for (let f = 0; f < 2; f++) {
        const [c, cg] = ctx2(64, 64);
        draw(cg, glow, f);
        g.drawImage(c, bi * 128 + f * 64, 0);
      }
    });
    const small = [cocoon, rack, turret, camp];
    small.forEach((draw, si) => {
      for (let f = 0; f < 2; f++) {
        const [c, cg] = ctx2(32, 32);
        draw(cg, glow, f);
        g.drawImage(c, si * 64 + f * 32, 64);
      }
    });
    out[tint] = atlas.toDataURL("image/png");
  }

  // contact sheet: all tints stacked, 2x scale
  const [sheet, sg] = ctx2(512, Object.keys(tints).length * 192);
  let row = 0;
  for (const dataUrl of Object.values(out)) { void dataUrl; row++; }
  return { atlases: out, rows: row };
}, TINTS);

const spritesDir = join(root, "assets", "sprites");
const webDir = join(root, "web", "public", "sprites");
mkdirSync(spritesDir, { recursive: true });
mkdirSync(webDir, { recursive: true });

const manifest = {
  tints: Object.keys(TINTS),
  buildings: {
    core: { x: 0, y: 0, cell: 64, frames: 2 },
    assembler: { x: 128, y: 0, cell: 64, frames: 2 },
    cocoon: { x: 0, y: 64, cell: 32, frames: 2 },
    rack: { x: 64, y: 64, cell: 32, frames: 2 },
    turret: { x: 128, y: 64, cell: 32, frames: 2 },
    camp: { x: 192, y: 64, cell: 32, frames: 2 },
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
const sheetUrl = await page.evaluate(async (urls) => {
  const imgs = await Promise.all(Object.values(urls).map((u) => new Promise((res) => {
    const i = new Image(); i.onload = () => res(i); i.src = u;
  })));
  const c = document.createElement("canvas");
  c.width = 256 * 4; c.height = imgs.length * 96 * 4;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, c.width, c.height);
  imgs.forEach((img, i) => g.drawImage(img, 0, i * 96 * 4, 256 * 4, 96 * 4));
  return c.toDataURL("image/png");
}, atlases.atlases);
writeFileSync(join(spritesDir, "buildings_contact_sheet.png"),
              Buffer.from(sheetUrl.split(",")[1], "base64"));

await browser.close();
console.log("building pack written:", Object.keys(atlases.atlases).join(", "));
