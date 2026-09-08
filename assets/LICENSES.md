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

## Real-time 3D world (`web/public/world/`)

| Asset | Source | Terms | Changes |
|---|---|---|---|
| Soldier glTF model and animation (the armed human and the unarmed survivor) | Adobe Mixamo, distributed in [Three.js r185 examples](https://github.com/mrdoob/three.js/tree/r185/examples/models/gltf) | [Mixamo royalty-free use in games](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html); not CC0 or a standalone asset pack | Weathered cloth materials, normalization, weapon attachment, animation blending. The Xbot rig was dropped: machines are procedural (`web/src/three/UnitModels.ts`) |
| HUD portraits (`web/public/portraits/`) | Rendered in this repository from the assets above with `web/tools/render-portraits.mjs` | Same terms as their source models; procedural machines and buildings are original | Fixed three-quarter view, in-game lighting and ground |
| Rubble diffuse/normal/roughness maps | [Poly Haven contributors](https://polyhaven.com/a/rubble) | [CC0](https://polyhaven.com/license) | Runtime tint, repetition and road overlay |
| Concrete diffuse/normal/roughness maps | [Poly Haven contributors](https://polyhaven.com/a/concrete) | [CC0](https://polyhaven.com/license) | Runtime tint and normal strength |
| Rocky Terrain 02 diffuse/normal/roughness maps | [Poly Haven contributors](https://polyhaven.com/a/rocky_terrain_02) | [CC0](https://polyhaven.com/license) | Runtime tint and repetition |
| Terrain, ruins, structures, equipment, drones, effects | Created in this repository | Original programmatic geometry | No film assets or trademarks |

In-app provenance: `/art-credits`. Exact source/download URLs and SHA-256 hashes are in `web/public/world/sources.json`. Downloads are reproducible with `web/tools/fetch-world-assets.mjs`.
