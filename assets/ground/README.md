# Ground tiles (pre-rendered 3D)

`blender_ground.py` renders a continuous 12x12-tile patch of cracked earth,
ash and broken asphalt from the game's iso camera (az 45, el 30, ortho) at 2x
-> `ground_render_2x.png` (1536x768, kept in the repo as the slicing source).

The slicer cuts it into one cell per tile -> `web/public/ground/
ground_atlas.jpg` + `ground.json`. The atlas is 2 texels per world pixel
(128x64 cells for the 64x32 diamond), so a HiDPI screen zoomed in still has
detail; MapRenderer scales the sprites by 0.5 (`world_tile / tile`). Cells are
OPAQUE rectangles cut from the continuous render: the corner triangles hold
exactly what the neighbouring tiles paint there, so the overlapping sprites
compose into one seamless surface at any zoom and mipmaps have no alpha
edge to darken. Map tile (x,y) uses cell (x % 12, y % 12).

Re-slice (no Python needed, uses the web app's Playwright Chromium):

    cd web && node scripts/slice-ground.mjs ../assets/ground/ground_render_2x.png public/ground/ground_atlas.jpg 2

`slice_ground.py` is the same lattice for a machine with PIL + numpy.
Re-render: `blender -b -P blender_ground.py -- ground_render_2x.png`.
