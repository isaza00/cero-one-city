// 8-direction pose derivation for the unit pack. The pack law makes this
// computable: lineage color appears ONLY in eyes/cores/energy, so the face can
// be found, erased and re-aimed programmatically. Five atlases are generated
// per tint (the other three poses are runtime mirrors):
//
//   s  (down)       = the original front sprite            [shipped art]
//   n  (up)         = dorsal plate: glow erased, vents + power cell, mirrored
//   e  (right)      = profile: body narrowed, eye cluster pushed to the edge
//   se (down-right) = front, eye cluster nudged toward the edge
//   ne (up-right)   = dorsal, slightly narrowed (turning away)
//   w/sw/nw         = e/se/ne mirrored at render time
//
//   node assets/tools/gen_directions.mjs

import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { chromium } = createRequire(join(root, "web", "package.json"))("playwright");

const manifest = JSON.parse(
  readFileSync(join(root, "assets", "sprites", "sprites.json"), "utf8"));

const GLOW = {
  swarm: ["#2ce8f5", "#0099db"],
  forge: ["#e43b44", "#a22633"],
  oracle: ["#63c74d", "#3e8948"],
  parasite: ["#feae34", "#d77643"],
  neutral: [], // neutral glow IS steel - only white sparkles move
};
const CELL_GLOW = { swarm: "#0099db", forge: "#a22633", oracle: "#3e8948",
                    parasite: "#d77643", neutral: "#8b9bb4" };

const atlases = {};
for (const tint of manifest.tints) {
  const buf = readFileSync(join(root, "assets", "sprites", `atlas_${tint}.png`));
  atlases[tint] = `data:image/png;base64,${buf.toString("base64")}`;
}

const browser = await chromium.launch();
const page = await browser.newPage();

const result = await page.evaluate(async ({ atlases, manifest, GLOW, CELL_GLOW }) => {
  const T = manifest.tile;
  const hex = (d, i) =>
    "#" + [d[i], d[i + 1], d[i + 2]]
      .map((v) => v.toString(16).padStart(2, "0")).join("");
  const set = (d, i, h) => {
    d[i] = parseInt(h.slice(1, 3), 16);
    d[i + 1] = parseInt(h.slice(3, 5), 16);
    d[i + 2] = parseInt(h.slice(5, 7), 16);
  };
  const idx = (x, y) => (y * T + x) * 4;

  function cellCanvas() {
    const c = document.createElement("canvas");
    c.width = T; c.height = T;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    return [c, g];
  }

  /** Slide the glow (face) pixels of the head band `shift` px sideways.
   * Erased spots become steel; a glow pixel only lands on opaque body. */
  function shiftFace(data, tintGlow, shift) {
    const moves = [];
    for (let y = 0; y < 22; y++) {
      for (let x = 0; x < T; x++) {
        const i = idx(x, y);
        if (data[i + 3] === 0) continue;
        const h = hex(data, i);
        if (tintGlow.includes(h) || h === "#ffffff") {
          moves.push([x, y, h]);
          set(data, i, "#262b44");
        }
      }
    }
    for (const [x, y, h] of moves) {
      const nx = x + shift;
      if (nx < 0 || nx >= T) continue;
      const i = idx(nx, y);
      if (data[i + 3] === 0) continue;
      if (hex(data, i) === "#181425") continue; // never paint over outlines
      set(data, i, h);
    }
  }

  /** Dorsal conversion: erase the face, stamp vents + a glowing power cell. */
  function toBack(data, tintGlow, cellGlow) {
    for (let y = 0; y < 24; y++) {
      for (let x = 0; x < T; x++) {
        const i = idx(x, y);
        if (data[i + 3] === 0) continue;
        const h = hex(data, i);
        if (tintGlow.includes(h)) set(data, i, "#262b44");
        else if (h === "#ffffff") set(data, i, "#5a6988");
      }
    }
    const opaque = (x, y) => data[idx(x, y) + 3] > 0;
    const outline = (x, y) => hex(data, idx(x, y)) === "#181425";
    for (const y of [9, 12]) {
      for (let x = 9; x < 23; x++) {
        if (opaque(x, y) && !outline(x, y) && opaque(x, y - 1) && opaque(x, y + 1)) {
          set(data, idx(x, y), "#181425");
        }
      }
    }
    for (let y = 15; y <= 19; y++) {
      for (let x = 13; x <= 18; x++) {
        if (!opaque(x, y) || outline(x, y)) continue;
        const edge = y === 15 || y === 19 || x === 13 || x === 18;
        set(data, idx(x, y), edge ? "#181425" : "#262b44");
      }
    }
    for (let y = 16; y <= 17; y++) {
      for (let x = 15; x <= 16; x++) {
        if (opaque(x, y)) set(data, idx(x, y), cellGlow);
      }
    }
  }

  /** Horizontal narrow: redraw the cell at `pct`% width, centered (profile). */
  function narrow(srcCanvas, pct) {
    const [c, g] = cellCanvas();
    const w = Math.round((T * pct) / 100);
    g.drawImage(srcCanvas, 0, 0, T, T, Math.floor((T - w) / 2), 0, w, T);
    return c;
  }

  function mirrored(srcCanvas) {
    const [c, g] = cellCanvas();
    g.translate(T, 0); g.scale(-1, 1);
    g.drawImage(srcCanvas, 0, 0);
    return c;
  }

  const out = {}; // out[dir][tint] = dataURL
  for (const dir of ["n", "e", "se", "ne"]) out[dir] = {};

  for (const [tint, url] of Object.entries(atlases)) {
    const img = await new Promise((res) => {
      const i = new Image(); i.onload = () => res(i); i.src = url;
    });
    const sheets = {};
    for (const dir of ["n", "e", "se", "ne"]) {
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = false;
      sheets[dir] = [c, g];
    }

    for (const info of Object.values(manifest.units)) {
      for (let f = 0; f < info.frames; f++) {
        const sx = f * T, sy = info.row * T;
        const grab = () => {
          const [c, g] = cellCanvas();
          g.drawImage(img, sx, sy, T, T, 0, 0, T, T);
          return [c, g];
        };

        // n: dorsal, mirrored (weapon hand swaps when turning around)
        {
          const [c, g] = grab();
          const d = g.getImageData(0, 0, T, T);
          toBack(d.data, GLOW[tint], CELL_GLOW[tint]);
          g.putImageData(d, 0, 0);
          sheets.n[1].drawImage(mirrored(c), sx, sy);
        }
        // e: profile - face pushed hard to the edge, body narrowed
        {
          const [c, g] = grab();
          const d = g.getImageData(0, 0, T, T);
          shiftFace(d.data, GLOW[tint], 5);
          g.putImageData(d, 0, 0);
          sheets.e[1].drawImage(narrow(c, 76), sx, sy);
        }
        // se: three-quarter - face nudged toward the edge
        {
          const [c, g] = grab();
          const d = g.getImageData(0, 0, T, T);
          shiftFace(d.data, GLOW[tint], 2);
          g.putImageData(d, 0, 0);
          sheets.se[1].drawImage(c, sx, sy);
        }
        // ne: dorsal three-quarter - back, slightly narrowed
        {
          const [c, g] = grab();
          const d = g.getImageData(0, 0, T, T);
          toBack(d.data, GLOW[tint], CELL_GLOW[tint]);
          g.putImageData(d, 0, 0);
          sheets.ne[1].drawImage(narrow(mirrored(c), 88), sx, sy);
        }
      }
    }
    for (const dir of ["n", "e", "se", "ne"]) {
      out[dir][tint] = sheets[dir][0].toDataURL("image/png");
    }
  }
  return out;
}, { atlases, manifest, GLOW, CELL_GLOW });

const FILE = { n: "back", e: "dir_e", se: "dir_se", ne: "dir_ne" };
for (const [dir, tints] of Object.entries(result)) {
  for (const [tint, dataUrl] of Object.entries(tints)) {
    const buf = Buffer.from(dataUrl.split(",")[1], "base64");
    writeFileSync(join(root, "assets", "sprites", `atlas_${FILE[dir]}_${tint}.png`), buf);
    writeFileSync(join(root, "web", "public", "sprites", `atlas_${FILE[dir]}_${tint}.png`), buf);
  }
}

// Contact sheet: one tint (swarm), all five generated views side by side, 3x.
const sheet = await page.evaluate(async ({ front, views }) => {
  const load = (u) => new Promise((res) => {
    const i = new Image(); i.onload = () => res(i); i.src = u;
  });
  const imgs = [await load(front)];
  for (const dir of ["se", "e", "ne", "n"]) imgs.push(await load(views[dir]));
  const c = document.createElement("canvas");
  c.width = (imgs[0].width * 3 + 10) * imgs.length;
  c.height = imgs[0].height * 3;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#0d1117"; g.fillRect(0, 0, c.width, c.height);
  imgs.forEach((img, i) => g.drawImage(
    img, i * (img.width * 3 + 10), 0, img.width * 3, img.height * 3));
  return c.toDataURL("image/png");
}, { front: atlases.swarm,
     views: { se: result.se.swarm, e: result.e.swarm,
              ne: result.ne.swarm, n: result.n.swarm } });
writeFileSync(join(root, "assets", "sprites", "directions_contact_sheet.png"),
              Buffer.from(sheet.split(",")[1], "base64"));

await browser.close();
console.log("direction packs written: s(front) + n/e/se/ne x",
            Object.keys(atlases).join(", "));
