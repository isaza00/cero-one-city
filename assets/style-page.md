# Style page — Cero One City (brief for the pixel artist)

The single source of visual truth. Read this before drawing anything.

## Identity

- **Pitch:** a machine planet long after the machines won. Small, comic,
  big-headed robots wage tiny brutal wars. The cruelty is funny because the
  protagonists are ridiculous.
- **Tone:** light, absurd, a bit deadpan. Saturday-morning-cartoon war crimes.
- **The bigheads ARE the brand.** Head ≈ 60% of body height. Tiny limbs.
  Expressive single eye or visor. Battered, mismatched plating.

## Technical rules

- **Palette:** Endesga 32 (Lospec) — no colors outside it.
- **Tile size:** 32×32 px. Units fit inside one tile (bighead may overflow 2–4
  px upward). Buildings: 1×1 or 2×2 tiles.
- **Animation:** idle = 2 frames. That's it for v1 (walk/attack are stretch).
- **Lineage tint:** each unit ships in 4 tints — swarm (cyan family), forge
  (red family), oracle (green family), parasite (amber family). Recolors of the
  same sprite are fine.
- **Outlines:** 1 px, darkest palette tone, no anti-aliasing.

## Deliverables (see PLAN.md §10)

1. 13 unit types × 4 tints (idle + 2 frames)
2. 16 agent portraits (4 lineages × 4 variants)
3. Buildings: core (intact / cracks / fire / collapse), cocoon, rack,
   assembler, turret, human camp, generic ruins

## Three reference notes

- Proportions: think "funko-fied AoE2 militia".
- Materials: worn steel, exposed wiring, kludged repairs — no chrome.
- Humans (survivor camps): patched futuristic gear, faces hidden (hood/visor),
  clearly outgunned and improvising.

## Do / Don't

- DO make every unit readable at 100% zoom on a dark background (#0d1117).
- DO keep silhouettes distinct per unit type (the head shape can vary).
- DON'T use gradients, sub-pixel AA, or off-palette colors.
- DON'T make anything look grimdark-serious; menace comes from quantity.
