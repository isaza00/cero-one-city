# 3D battlefield

Live matches and replays now open in real-time 3D by default. No URL flag is required. Use **Classic 2D** in the battlefield toolbar for the original sprite renderer; **Enter 3D** switches back. `?renderer=2d` forces the classic view on initial load. The 3D renderer requires WebGL2.

Drag to pan, use the wheel to zoom, and right-drag to orbit. Click a unit or building to select it. The minimap remains connected to the camera.

## Included

- One locally bundled rig, the Mixamo Soldier, for the armed human and the unarmed survivor: independent animation mixers, idle/walk crossfades, speed-adjusted walking, smooth turns and the weapon attachment that tells guard from survivor.
- The fifteen-type cast of machines as original procedural, articulated models (`src/three/UnitModels.ts`): exposed endoskeletons, walkers, cycles, aircraft, drones, tripods and crawlers with faction plates, muzzles and per-joint motion. No chrome humanoid is scaled to stand in for a machine.
- HUD portraits rendered from those same models (`web/public/portraits/`, regenerated with `node tools/render-portraits.mjs`): unit, building and resource tiles, per faction, framed from one three-quarter view under the in-game light.
- Scanned diffuse, normal and roughness maps for rubble, concrete and rocky terrain; a mostly flat suburb with a few low hills, a faint tile grid, and asphalt avenues with worn lane paint that disappear where the street was destroyed.
- The district (`src/three/Features.ts`, `src/three/Props.ts`): the engine's `blocked` and `rubble` tiles are classified by shape and by their position on the street grid (shared with the engine through `src/three/roads.ts`) into houses with gable roofs, flat apartment blocks, the concrete skeletons of taller buildings cut in half (pillars, slabs, wall fragments, rebar), traffic jams of cars, vans and buses queued lane by lane (burnt, crushed, flipped, doors and tyres torn off), groves of living and dead trees, salvage pits with a derrick over each metal vein, and rubble fields with skeletons and bone piles near the houses and car parts near the streets. No loose stones anywhere. This is a war in progress: bomb craters dent the ground with scorched earth around them, three houses in five are burnt black, the cars are burnt, crushed and rusting, groves hold charred and flaming trees, the outlying blobs are burnt smallholdings (fenced charred crop rows, a shed, dead cattle), and one shared rule (`isBurning`) puts flames on a feature and smoke above it. The palette and lighting are deliberately dark. Everything is at human scale and every prop stands on an impassable tile, so units walk around it, never through it. Static props are merged per 16×16-tile chunk; when a tile changes (rubble cleared, a building razed) only that chunk is rebuilt.
- Resource capsules (pods) and salvage-pit derricks (veins); the concrete ruins and rebar are part of the district above.
- Distinct industrial core, assembler, lab, server rack, cocoon, turret, wall and depot silhouettes.
- Physically based metal, environment reflections, camera-following soft shadows and atmospheric distance fog.
- Player visibility filtering, resource depletion, health bars, construction progress, projectile impacts, recoil and death transitions.
- Fog of war as a light map (`WorldFog.ts`): every frame a top-down pass draws the explored memory (dim, softened) and a soft round light around every unit and building the perspective owns, into a render target that all world materials multiply by. The light follows units while they walk; the engine's square rule still decides which enemies are drawn.
- Units walk the engine's route: between turns the client re-derives the shortest plain-tile, building-free path (engine step order) and slides along its waypoints, so nobody cuts through houses, cars or foundations. Fliers go straight.
- Deaths are a short sequence (about 3.4 s): the body drops towards open ground (buildings crumble in on themselves), lies charred for a moment, then sinks into the street with a puff of dust before the actor is released.
- Lazy loading, shared character geometry, vertex-coloured per-chunk merging of all static props, bounded transient effects and explicit resource cleanup.

## Windows / WSL validation

Vite runs as a Windows process. Use Windows Node and Windows Playwright Chromium:

```powershell
cd D:/Cero-One-City/web
node node_modules/typescript/bin/tsc -b
node node_modules/@playwright/test/cli.js test e2e/world-renderer.spec.ts --reporter=line
node tools/verify-live-world.mjs
node tools/verify-apocalypse.mjs
wsl python engine/tools/dump_map.py 101 1v1 web/test-results/district-map.json   # from the repo root, with the engine installed
node tools/verify-district.mjs
node tools/render-portraits.mjs
node tools/open-window.mjs "http://localhost:5173/matches/<id>"
```

`verify-apocalypse.mjs` renders a fixed district with the whole cast against a mocked API (no match is created) and writes screenshots plus metrics under `web/test-results/apocalypse/`. `render-portraits.mjs` regenerates `web/public/portraits/` from the same renderer; run it after any change to the unit models, buildings or lighting.

Tests check geometry, rig normalization, movement, fog, attacks, selection, rewind, cleanup, the default renderer, and repeated 2D/3D switching. Live matches start near a base, while replays initially fit the world.

The live verifier opens a real Windows Chromium window, checks the current public live match without creating a match, samples frame timing, exercises camera controls, and saves near/full-map screenshots under `web/test-results/`. The **Full map** button fits the tactical map; atmospheric fog scales with camera distance so the overview remains readable.

## Asset provenance

See `/art-credits` in the app and `web/public/world/sources.json` for sources, terms, file sizes and SHA-256 hashes. `node web/tools/fetch-world-assets.mjs` reproduces the bundle. Mixamo assets are incorporated into this game, not offered as a standalone asset library. Poly Haven textures are CC0.

## Production scope

This is a working 3D visual upgrade, not a claim of AAA production quality. The human is a licensed stock rig, not a bespoke character or a film replica; machines, buildings, drones and ruins are original procedural geometry. The bundled rig supplies idle and walk clips; machine gaits, work, recoil and death feedback are procedural, not motion-captured actions. No paid assets were purchased.

Elevation is cosmetic: authoritative pathfinding, attack range and line of sight remain on the existing game grid. The client-side route between two turn positions is a display reconstruction, never a rule. Corpse transitions last a few seconds; salvage persists according to simulation state. `web/tools/verify-fog-motion.mjs --headed` screenshots the fog lamp, a walk round an obstacle and a death on a real generated map (headless Chromium is too slow for time-based checks). Fog does not retain cached models of buildings after they leave visibility. Further production work includes bespoke hero/enemy models, authored attack/work/death clips, richer environment meshes, LODs and low-end GPU profiling. Simulation rules, networking and game balance are unchanged.
