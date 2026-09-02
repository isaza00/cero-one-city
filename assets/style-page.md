# Style page — Cero One City (brief for the pixel artist)

The single source of visual truth. Read this before drawing anything.
(v2 direction — replaces the earlier "comic / light" brief. Reference
implementation: `assets/sprites/` — the 13 shipped unit designs.)

## Identity

- **Pitch:** a machine planet long after the machines won. Big-headed
  skull robots wage small, brutal, tile-sized wars.
- **Tone:** menacing, battle-worn, deadpan. The machines are not cute —
  they are death with a big head. Menace comes from the units themselves
  AND from quantity.
- **The skull IS the brand.** Gray steel cranium with a light dome, deep
  black eye sockets, glowing lineage eyes, endoskeleton teeth. Head is
  still the dominant mass (~50–60% where the design allows).
- **Same factory, different ghost.** Every robot body is shared gunmetal
  steel. The ONLY color comes from the software possessing it: lineage
  glow in the eyes, chest core, energy cells, and muzzle charges.
- **Every combat unit shows its weapon.** Rifles, blades, cannons, drills,
  claws — armament is part of the silhouette, never implied.

## Technical rules

- **Palette:** Endesga 32 (Lospec) — no colors outside it.
  - Steel ramp: `#181425` (outline) → `#262b44` → `#3a4466` → `#5a6988`
    → `#8b9bb4` (skull) → `#c0cbdc` → `#ffffff`.
  - Wear: `#b86f50`, `#733e39` (rust chips, grime).
  - Human skin: `#e8b796`, `#c28569`.
- **Lineage glows (bright, dim):** swarm `#2ce8f5/#0099db`, forge
  `#e43b44/#a22633`, oracle `#63c74d/#3e8948`, parasite `#feae34/#d77643`,
  neutral `#c0cbdc/#8b9bb4`.
- **Tile size:** 32×32. Units fit one tile (may overflow 2–4 px upward).
  Buildings: 1×1 or 2×2 tiles.
- **Animation:** idle = 2 frames (eye pulse + one mechanical motion:
  gait, flap, recoil, claw snap). Exception: `walking_tower` ships 4
  frames for the drill spin.
- **Facing:** front-facing by default. Side-facing units (`rider`,
  `walking_tower`, `leech`) face RIGHT; the engine mirrors for left.
- **Outlines:** 1 px, `#181425`, no anti-aliasing, no gradients.

## The 13 unit designs (shipped reference)

worker (tool arm) · striker (rifle + blade) · launcher (skinny sniper,
telescopic lens eye, twin alternating cannons) · rider (robot war-dog:
side quadruped body, huge front-facing fanged skull, back turret) ·
wasp (insectoid: twin wing pairs, striped abdomen, spear stinger) ·
walking_tower (tunnel-boring machine: lateral cone drill + two small
counter-rotating cutters, tank treads) · drone_swarm (sentinel: eye-dome
with 10 segmented tentacles, side claws) · colossus (armored skull,
shoulder cannons, side cannon + giant front-facing muzzle ring) ·
human (the one organic: soldier — helmet, visible face, tactical vest,
lineage armband, rifle) · spark (cheap bot on wheels, shiv) · anvil
(open-cage exo-mech, twin gatling arms) · watcher (floating eye orb,
sensor dish, hover jets — unarmed) · leech (tracked pincer rig, single
sensor eye, giant snapping claw — no skull).

## Do / Don't

- DO make every unit readable at 100% zoom on a dark background (#0d1117).
- DO keep silhouettes distinct per unit type; weapons are silhouette.
- DO add wear: rust pixels, battle cracks, rivets, mismatched plates.
- DON'T put lineage color on body plates — glows only.
- DON'T make anything cute, rounded, or candy-colored.
- DON'T use gradients, sub-pixel AA, or off-palette colors.

## The 9 building designs (s2.0, `assets/tools/gen_buildings.mjs`)

All in 3/4 view, same steel ramp, lineage color only in lamps/glows. Each
names its Age of Empires II counterpart because that is what the player
must recognise at a glance:

core (town center: keep with corner towers, skull gate, beacon mast, 2×2) ·
assembler (barracks: sawtooth factory hall, hazard door, crane, chimney, 2×2)
· lab (blacksmith: domed reactor hall, twin tesla coils that arc, glass front
with the glowing reactor column, 2×2) · cocoon (farm: human energy capsule,
glow liquid, rising bubbles) · rack (house: server monolith, thinking LEDs) ·
depot (mining camp / mill: squat loading bunker, hazard pad, crate stack,
dipping crane, one lineage lamp) · turret (tower: sentry pod, twin barrels,
one burning eye) · wall (palisade: riveted steel plates between two posts,
one glow strip) · camp (neutral village: tarp tents, salvaged solar panel,
campfire that never dies).

Foundations are drawn by the renderer: the finished sprite ghosted (alpha
rises with the work done) under amber scaffold poles and a progress bar.
