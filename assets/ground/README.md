# Ground tiles (pre-rendered 3D)

`blender_ground.py` renders a continuous 12x12-tile patch of cracked earth,
ash and broken asphalt from the game's iso camera (az 45, el 30, ortho) at 2x.
`slice_ground.py` cuts it into 64x32 diamond cells -> `web/public/ground/
ground_atlas.png` (cell (i,j) at (i*64, j*32)). MapRenderer draws map tile
(x,y) with cell (x % 12, y % 12), so neighbouring tiles are always continuous;
the pattern repeats every 12 tiles.

Re-render: `blender -b -P blender_ground.py -- ground_render_2x.png && python slice_ground.py ground_render_2x.png ../../web/public/ground/ground_atlas.png`
