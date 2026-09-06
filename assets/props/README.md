# Terrain props (pre-rendered 3D)

Environment sprites for the iso map, rendered in Blender 4.0 / Cycles from
`blender_prop.py` (camera: azimuth 45, elevation 30, orthographic, matching
the 64x32 diamond). The 384 px renders are served as-is from
`web/public/props/` with `props.json`: the frame covers 128 world px
(`world_size`), i.e. 3 texels per world pixel so zooming in on a HiDPI screen
keeps detail, and the ground contact (tile center) is at pixel 192,240.

Re-render a prop:  `blender -b -P blender_prop.py -- <vein|blocked|pod|rubble|scrap|deadland_a|deadland_b> ../../web/public/props/<name>.png`

Kinds: blocked, vein, pod (human energy capsules), rubble, scrap (dropped by
destroyed units), deadland (decor outside the map, 2 variants).

Variety per tile (scale and brightness jitter) comes from the renderer, not
from extra renders; props are never mirrored because they all cast their
shadow to the right.
