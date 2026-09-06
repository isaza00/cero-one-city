"""Slice the rendered ground patch into 64x32 diamond tiles.
Input: ground_big.png (TILES*64*AA x TILES*32*AA). Output: ground_atlas.png
with TILES x TILES cells of 64x32 (cell (i,j) at (i*64, j*32)), each a
diamond cut from the continuous render so neighbours match seamlessly."""
import sys
import numpy as np
from PIL import Image

src = sys.argv[1]; out = sys.argv[2]
TILES = 12; TW, TH = 64, 32
img = Image.open(src).convert("RGB")
img = img.resize((TILES*TW, TILES*TH), Image.LANCZOS)      # 2x AA -> game res
arr = np.array(img)
W, H = img.size

# diamond alpha mask (64x32), slightly oversized so seams overlap by ~0.5px
yy, xx = np.mgrid[0:TH, 0:TW]
mask = (np.abs((xx + 0.5) - TW/2) / (TW/2) + np.abs((yy + 0.5) - TH/2) / (TH/2)) <= 1.02
mask_a = (mask * 255).astype(np.uint8)

# iso lattice over the render: diamond centers (i-j)*32 + W/2, (i+j)*16 + 16
# tile (i,j) for i,j in 0..TILES-1 ; the map indexes it with (x % TILES, y % TILES)
atlas = np.zeros((TILES*TH, TILES*TW, 4), np.uint8)
for j in range(TILES):
    for i in range(TILES):
        cx = (i - j) * (TW//2) + W//2
        cy = (i + j) * (TH//2) + TH//2
        x0, y0 = cx - TW//2, cy - TH//2
        # sample with wraparound so the whole lattice has pixels
        xs = (np.arange(x0, x0+TW)) % W
        ys = (np.arange(y0, y0+TH)) % H
        patch = arr[np.ix_(ys, xs)]
        cell = np.dstack([patch, mask_a])
        atlas[j*TH:(j+1)*TH, i*TW:(i+1)*TW] = cell
Image.fromarray(atlas, "RGBA").save(out)
print("atlas", atlas.shape)
