// A tiny dependency-free pixel canvas for the sprite generators: just enough
// of the 2D canvas API (fillRect, drawImage, toDataURL) to draw Endesga-32
// pixel art in plain Node and write PNGs - no headless browser, no
// node-canvas. Colors are "#rrggbb" strings; scaling is nearest-neighbor.

import { deflateSync } from "zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function parseColor(css) {
  const m = /^#([0-9a-f]{6})$/i.exec(css);
  if (!m) throw new Error(`pixelcanvas: only #rrggbb colors, got ${css}`);
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff, 255];
}

class Context2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.fillStyle = "#000000";
    this.imageSmoothingEnabled = false;
  }

  fillRect(x, y, w, h) {
    const [r, g, b, a] = parseColor(this.fillStyle);
    const { width, height, data } = this.canvas;
    for (let yy = Math.max(0, y); yy < Math.min(height, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(width, x + w); xx++) {
        const i = (yy * width + xx) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
      }
    }
  }

  /** drawImage(src, dx, dy) | (src, dx, dy, dw, dh) | (src, sx, sy, sw, sh, dx, dy, dw, dh) */
  drawImage(src, ...args) {
    let sx = 0, sy = 0, sw = src.width, sh = src.height, dx, dy, dw, dh;
    if (args.length === 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args;
    else if (args.length === 4) [dx, dy, dw, dh] = args;
    else { [dx, dy] = args; dw = sw; dh = sh; }
    const { width, height, data } = this.canvas;
    for (let yy = 0; yy < dh; yy++) {
      const ty = dy + yy;
      if (ty < 0 || ty >= height) continue;
      const syy = sy + Math.floor((yy * sh) / dh);
      for (let xx = 0; xx < dw; xx++) {
        const tx = dx + xx;
        if (tx < 0 || tx >= width) continue;
        const sxx = sx + Math.floor((xx * sw) / dw);
        const si = (syy * src.width + sxx) * 4;
        if (src.data[si + 3] === 0) continue; // transparent source pixel
        const di = (ty * width + tx) * 4;
        data[di] = src.data[si]; data[di + 1] = src.data[si + 1];
        data[di + 2] = src.data[si + 2]; data[di + 3] = src.data[si + 3];
      }
    }
  }
}

export class PixelCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4); // transparent black
  }

  getContext(kind) {
    if (kind !== "2d") throw new Error("pixelcanvas: 2d only");
    return new Context2D(this);
  }

  toPNG() {
    const { width, height, data } = this;
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (width * 4 + 1)] = 0; // filter: none
      Buffer.from(data.buffer, y * width * 4, width * 4)
        .copy(raw, y * (width * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 6;  // RGBA
    ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }

  toDataURL() {
    return "data:image/png;base64," + this.toPNG().toString("base64");
  }
}
