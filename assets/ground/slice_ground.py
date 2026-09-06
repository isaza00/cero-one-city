"""Slice the rendered ground patch into ground cells (one per tile).
Input: ground_render_2x.png (TILES*64*AA x TILES*32*AA). Output: an atlas with
TILES x TILES cells of (64*S)x(32*S), cell (i,j) at (i*64*S, j*32*S). Each cell
is an OPAQUE rectangle cut from the continuous render: its corner triangles
hold exactly what the neighbouring tiles paint there, so the overlapping cells
compose into one seamless surface at any zoom and mipmaps have no alpha edge.
S = atlas texels per world pixel (default 2). Same lattice as
web/scripts/slice-ground.mjs, which needs no PIL.

  python slice_ground.py ground_render_2x.png ../../web/public/ground/ground_atlas.jpg [S]
"""
import sys
import numpy as np
from PIL import Image

src = sys.argv[1]; out = sys.argv[2]; S = int(sys.argv[3]) if len(sys.argv) > 3 else 2
TILES = 12; TW, TH = 64*S, 32*S
img = Image.open(src).convert("RGB")
img = img.resize((TILES*TW, TILES*TH), Image.LANCZOS)      # render -> atlas res
arr = np.array(img)
W, H = img.size

# iso lattice over the render: cell centers (i-j)*TW/2 + W/2, (i+j)*TH/2 + TH/2
# for i,j in 0..TILES-1; the map indexes it with (x % TILES, y % TILES)
atlas = np.zeros((TILES*TH, TILES*TW, 3), np.uint8)
for j in range(TILES):
    for i in range(TILES):
        cx = (i - j) * (TW//2) + W//2
        cy = (i + j) * (TH//2) + TH//2
        x0, y0 = cx - TW//2, cy - TH//2
        # sample with wraparound (the render is periodic over TILES tiles)
        xs = (np.arange(x0, x0+TW)) % W
        ys = (np.arange(y0, y0+TH)) % H
        atlas[j*TH:(j+1)*TH, i*TW:(i+1)*TW] = arr[np.ix_(ys, xs)]
Image.fromarray(atlas, "RGB").save(out, quality=92)
print("atlas", atlas.shape)
