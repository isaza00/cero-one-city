// Slice the Blender ground render into the atlas of ground cells, using a
// headless Chromium canvas (Playwright is already a dev dependency), so no
// Python/PIL is needed. Same lattice as assets/ground/slice_ground.py.
//
//   node scripts/slice-ground.mjs <render.png> <atlas.jpg|png> [scale]
//
// Cells are opaque, so JPEG (quality 0.92) is the natural format: a fraction
// of the PNG size and no visible loss on rocky ground.
//
// scale = atlas texels per world pixel (default 2: 128x64 cells, so a HiDPI
// screen zoomed in still has texels to spare). Cell (i,j) sits at
// (i*64*scale, j*32*scale); MapRenderer draws map tile (x,y) with cell
// (x % 12, y % 12), so neighbours are always continuous.
//
// Cells are OPAQUE rectangles, not alpha-masked diamonds: the corner
// triangles hold exactly what the neighbouring tiles paint there (same
// continuous render), so overlapping rectangles compose into one seamless
// surface at any zoom, and mipmaps have no alpha edge to darken.
import fs from "node:fs";
import { chromium } from "playwright";

const [src, out, scaleArg] = process.argv.slice(2);
if (!src || !out) { console.error("usage: slice-ground.mjs <render.png> <atlas.png> [scale]"); process.exit(2); }
const S = Number(scaleArg ?? 2);
const TILES = 12, TW = 64 * S, TH = 32 * S;
const b64 = fs.readFileSync(src).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage();
const dataUrl = await page.evaluate(async ({ b64, TILES, TW, TH, fmt }) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const W = TILES * TW, H = TILES * TH;             // render resampled to atlas res
  const sc = document.createElement("canvas"); sc.width = W; sc.height = H;
  const sctx = sc.getContext("2d");
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(img, 0, 0, W, H);
  const s = sctx.getImageData(0, 0, W, H).data;
  const atlas = new ImageData(W, H);
  const a = atlas.data;
  // iso lattice over the render: diamond centers (i-j)*TW/2 + W/2, (i+j)*TH/2 + TH/2,
  // sampled with wraparound (the render is periodic over TILES tiles).
  for (let j = 0; j < TILES; j++) {
    for (let i = 0; i < TILES; i++) {
      const x0 = (i - j) * (TW / 2) + W / 2 - TW / 2;
      const y0 = (i + j) * (TH / 2);
      for (let y = 0; y < TH; y++) {
        for (let x = 0; x < TW; x++) {
          const sx = (((x0 + x) % W) + W) % W, sy = (((y0 + y) % H) + H) % H;
          const si = (sy * W + sx) * 4, di = ((j * TH + y) * W + i * TW + x) * 4;
          a[di] = s[si]; a[di + 1] = s[si + 1]; a[di + 2] = s[si + 2]; a[di + 3] = 255;
        }
      }
    }
  }
  const oc = document.createElement("canvas"); oc.width = W; oc.height = H;
  oc.getContext("2d").putImageData(atlas, 0, 0);
  return oc.toDataURL(fmt, 0.92);
}, { b64, TILES, TW, TH, fmt: out.endsWith(".jpg") || out.endsWith(".jpeg") ? "image/jpeg" : "image/png" });
await browser.close();
fs.writeFileSync(out, Buffer.from(dataUrl.split(",")[1], "base64"));
console.log(`atlas ${TILES * TW}x${TILES * TH} (${TILES}x${TILES} cells of ${TW}x${TH}) -> ${out}`);
