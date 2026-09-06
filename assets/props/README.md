# Terrain props (pre-rendered 3D)

Environment sprites for the iso map, rendered in Blender 4.0 / Cycles from
`blender_prop.py` (camera: azimuth 45, elevation 30, orthographic, matching
the 64x32 diamond). `hires/` holds the 384 px renders; `web/public/props/`
holds the 128 px in-game versions + `props.json` (anchor = ground contact at
pixel 64,80).

Re-render a prop:  `blender -b -P blender_prop.py -- <vein|blocked|pod|rubble|scrap|deadland_a|deadland_b> out.png`

Kinds: blocked, vein, pod (human energy capsules), rubble, scrap (dropped by
destroyed units), deadland (decor outside the map, 2 variants).
