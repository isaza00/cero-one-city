# Asset license registry

Every asset that ships must be recorded here (PLAN.md §10). One row per item.

| Asset | Source | License | Author | Proof/link | Notes |
|---|---|---|---|---|---|
| (none yet — v1 renders programmatic PixiJS shapes) | | | | | |

Rules:
- Commissioned work (bighead sprites, portraits, buildings): attach the
  contract/invoice reference and the usage rights granted.
- Store originals under `assets/raw/`, packaged atlases under `assets/packs/`.
- AI-generated images are allowed **only** for concept art, backgrounds and
  loading screens — never for characters (brief requirement).
- CC-BY items must be credited in the app's credits screen.

## Unit sprite pack v4 (`assets/sprites/`)
- 13 units × 5 tints, 2 idle frames (walking_tower: 4), 32×32, Endesga 32.
- Generated internally (procedural pixel art, no external assets). No license restrictions.

## Building sprite pack v2 (`assets/sprites/atlas_buildings_*.png`, s2.0)
- 9 buildings × 5 tints, 2 frames, 32×32 and 64×64 cells, Endesga 32.
- Generated internally with `assets/tools/gen_buildings.mjs` on the
  dependency-free `pixelcanvas.mjs` (no browser). No license restrictions.
