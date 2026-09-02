# Map view spec — the invariants

Every change to the map presentation (renderer, fog, minimap, camera) must
keep ALL of these true. Verify with `node web/tools/snap-live.mjs out.png`
against a live match — once in default view, once zoomed, once per fog mode.

## 1. Camera
- Reloading a live match opens at **fit zoom**: the whole map visible at
  regular size. No forced close-up, no center-on-anything that moves the view.
- Mouse wheel zooms between fit and 2.4×, anchored under the cursor.
- Drag and minimap-click pan only when zoomed in; the world never drifts
  off-screen (camera clamped).

## 2. Minimap
- Square, top-down, one cell per tile, faint tile lattice.
- Shows the SAME fog as the main view (black unknown, dim explored, lit
  visible; entities only where the current perspective could see them).
- Camera locator: a plain **rectangle**, centered where the camera looks,
  sized to the screen's coverage. Drawn only when zoomed in — never when the
  whole map is on screen.

## 3. Fog of war (the seamless-darkness rule)
- Default perspective: the viewer's seated agent, else **"all"** (union of
  every player's knowledge). God view is opt-in via the selector.
- Everything unknown is ONE continuous darkness in the app background color
  (#0b0f14), fully opaque, extending PAST the map border (FOG_PAD): the
  unexplored interior and the world beyond the edge must be visually
  indistinguishable. No diamond silhouette, no seams, no color steps.
- The decorative dead-land ring and the extended grid lattice are drawn in
  god view ONLY.
- Light is ROUND: radial gradients around every eye the perspective owns,
  blurred — never per-tile squares.
- Explored-but-unseen ground: dim terrain memory; buildings show as last
  seen; units are NEVER drawn outside current vision.

## 4. Entities
- Sprites pick one of 8 poses from the movement heading (front, back,
  profiles, quarter turns; left = mirrored right).
- HP bars sit ABOVE units, and only appear when damaged.
- Order flashes: rings in the OWNER's player color on commanded units, a big
  circle in the same color on the target (inner red ring when hostile).

## 5. Determinism / robustness
- The renderer never invents state: everything drawn derives from the last
  `turn_resolved` state plus its events.
- Any size map must work (32–128 tested); nothing may hardcode 96.
- Perf guards: terrain redraws only when tiles change (`terrainKey`), fog is
  one canvas update per turn, minimap fog sets are cached per state object.

## 6. The economy on screen (s2.0)
- `pod` tiles draw as capsule clusters with a green life-light (minimap: green);
  a depleted pod/vein turns to plain with a small puff (`pod_depleted` /
  `vein_depleted` events).
- Foundations (`build_progress > 0`) draw the finished sprite ghosted, alpha
  rising with `1 - build_progress / build_total`, under amber scaffold poles
  and a progress bar; `site_placed` pulses the footprint, `built` pops a ring,
  `core_founded` a big ring + feed banner.
- Builders adjacent to their site show hammer sparks (industry layer); workers
  adjacent to their resource show the gather beam; a worker carrying cargo
  shows a crate (green energy / steel metal) sized by load, with an arrow while
  in `phase: "return"`.
- `deposit` events float a `+N` marker at the drop-off in the resource color.
- The city panel (side bar) and the unit card derive everything from the last
  `turn_resolved` state: counts of standing buildings, sites with work done /
  total and crew size, worker employment (idle / building / hauling).
