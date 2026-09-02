# Age of Empires II → Cero One City: the complete mapping

Cero One City is Age of Empires II played by AI agents, with a robot theme. This
document is the design of record for that claim: every system of AoE2 - how a
match starts, how the economy works, how you build, how you age up, how you
fight, how you lose, and how the screen proves all of it - and what it is in
Cero, with the exact numbers (`engine/cero_engine/rules.py`, ruleset **s2.0**).

The rule of thumb for every decision here: **if a good AoE2 player would
recognise the situation, keep it; if a system exists only because AoE2 is a
real-time game with a mouse, translate it into a turn-scale order the agent
gives once.**

---

## 0. Glossary (AoE2 word → Cero word)

| AoE2 | Cero | Notes |
|---|---|---|
| Villager | worker | 25 energy, trained at the core, 1 turn |
| Scout cavalry | the starting striker | vision 5, mov 6; the bots tour the map with it |
| Food | energy | pods (finite, found) and cocoons (farms) |
| Gold | metal | veins, scrap, ruins |
| Wood / stone | metal | one building material instead of two |
| Population | compute | core +10, rack +4 (swarm +6) |
| Berries / sheep / deer / boar | **wild pods** (`pod` tiles) | 200 energy each, 8 per worker per turn, finite |
| Farm | cocoon | 25 metal, 8 energy/worker/turn, 2 workers, renewable |
| Town Center | core | 100 metal, 2x2, drop-off, trains workers, ages up |
| House | rack | 40 metal, +4 compute |
| Mining camp / mill / lumber camp | depot | 30 metal, drop-off point |
| Barracks + stable + archery range | assembler | 80 metal, one factory for every combat unit |
| Blacksmith | lab | 20 energy / 60 metal, military techs |
| Tower | turret | v2, attack 9 range 6, anti-air |
| Palisade wall | wall | 5 metal, 60 hp, blocks; attack-move walks around |
| Dark → Feudal → Castle Age | firmware v1 → v2 → v3 | researched at the core with building requirements |
| Wheelbarrow | cargo_servos | +10 carry, x2 build speed, repair 20 |
| Relic / neutral village | human camp | loot (+80/+80) or recruit (50 energy) |
| Trebuchet | walking_tower | range 8, full damage + bonus to buildings |
| Knight | rider | mov 10, 55 hp |
| Archer / skirmisher | launcher | range 4, bonus vs infantry |
| Militia / man-at-arms | striker | the v1 unit, five fuse into a colossus at v3 |
| Resign / all TCs razed with no villager | founded city loses its last core; a nomad crew loses its last worker | see §6 |

---

## 1. The start: Nomad

AoE2 (Nomad mode) drops you on the map with villagers and no buildings; the
first minute is *find a spot, build the Town Center*. Standard AoE2 gives you
the TC but still nothing else: no farms, no army, no houses.

**Cero (s2.0):** every player starts with **4 workers + 1 striker, 75 energy,
100 metal, and no buildings at all**. The map generator (`mapgen.py`) clears a
start zone and arranges the classic start resources around an *ideal* 2x2 site:
a cluster of 4 wild pods two tiles east of it, a 2-tile metal vein two tiles
west, and a second pod cluster and vein further out (the "back" resources a
depot unlocks). Starts are symmetric (180° in 1v1, 90° in FFA) and sit at
`size/4` from the corners, so the corners behind each base are safe expansion
land and armies meet in ~15 turns instead of 30.

The first order of every match is therefore visible on the map: four workers
walk to a tile and **found the city** - a core foundation rises over two turns
(8 work points, 4 builders). The observation hands agents the engine's own
`suggested_anchor` for the core (the free explored 2x2 whose ring touches the
most pods and veins), the same heuristic the scripted bots use.

Until the core stands nobody can train, research or bank a single resource:
a nomad crew that gathers pods fills its cargo and waits. That pressure - build
the TC first - is the AoE2 opening, kept intact.

## 2. Resources: four numbers you can always explain

AoE2's economy is spatial and legible because *income is little people
physically carrying things*. Cero keeps every piece of that model:

- **Energy = food.** Two sources, exactly like berries→farms:
  - **Wild pods** (`pod` terrain): dormant humans in capsules scattered by the
    generator - the start clusters, expansion clusters across the wasteland.
    200 energy each, 8 per worker per turn (10 with `rich_harvest`), finite;
    when one runs dry the worker steps to the nearest pod within 6 tiles by
    itself (the villager-to-the-next-bush reflex). A 4-pod cluster feeds 3
    workers for ~25 turns - about when a boomer needs farms.
  - **Cocoons** (farms): 25 metal, 2 workers, 8/turn each, renewable. Build
    them hugging the core so harvesting banks on the spot (AoE2 farms ring
    the TC for the same reason).
- **Metal = gold and wood.** Veins (300, 6/turn, 8 with `fast_mining`), scrap
  left by dead robots (20/turn), ruins of eliminated players. Every building
  costs metal, so metal is also wood.
- **Compute = population.** Core +10, rack +4 (swarm +6). Not spent; a cap.
  Free compute ≥ 5 speeds 2+ turn jobs by one turn.
- **Upkeep:** every *combat* unit pays 1 energy per turn; unpaid units freeze
  stiff (the brief's blackout). Workers and watchers are exempt so an empty
  bank never deadlocks the economy - AoE2 has no upkeep at all; this is the
  minimum that keeps "no energy, no army".

### 2.1 Drop-offs: the mining-camp rule

AoE2 villagers gather to a carry capacity and walk their load to the nearest
drop-off (TC, mill, mining camp). Distance to the drop-off IS the efficiency of
a resource, which is why expansion means *building a camp by the far gold*.

Cero implements the full cycle at turn scale (`phases/economy.py`):

| Rule | Value |
|---|---|
| Carry capacity | 20 (30 with `cargo_servos`) |
| Drop-offs | core, depot (finished) |
| Banking | a loaded worker standing within 1 tile of a drop-off banks instantly |
| Full load, no drop-off in reach | `phase: "return"`: the movement phase walks it to the nearest drop-off, it banks on arrival, walks back |
| Camped between resource and drop-off | banks every turn (the AoE2 "camp right next to the gold" efficiency) |
| Death | a loaded worker spills its cargo into the scrap pile |

The renderer shows the cargo (a crate glint over the worker), the return trip,
and a `+N` floater at the drop-off on every deposit, so a glance at a base
explains its income. The `deposit` event exists for exactly this.

## 3. Building: foundations and crews

AoE2 construction: click a spot, a foundation appears (wood is deducted then),
villagers walk to it and build together; more villagers = faster; a
foundation has little hp until finished; you can task more villagers onto an
existing foundation later.

Cero (`orders.py` + `phases/production.py`):

- `{"type":"build","actor_id":worker,"building":"depot","anchor":[x,y]}` drops
  the foundation immediately (cost paid then) on free, explored, plain tiles
  and gives the worker a `build` standing order - the engine walks it there.
  Adjacency is no longer required.
- `{"type":"build","actor_id":worker,"target_id":site}` tasks another worker
  onto an existing foundation. Several `build` orders on the same anchor in
  the same turn become one site with a crew.
- Every adjacent worker holding a `build` order adds **1 work point per turn**
  (2 with `cargo_servos`), up to 4 builders per site. Work per building: core
  8, assembler 6, lab 4, turret 4, rack 3, depot 2, cocoon 2, wall 1.
- A foundation stands at 10% hp and gains hp with each work point; it can be
  sniped (walls, turrets and armies target it like any building).
- When a site completes the crew is released to the obvious job: the cocoon's
  builder farms it, a depot's or core's crew spreads over the pods and veins
  around it (energy and metal alternating, two per tile).
- `menus.build` in every observation lists all eight buildings with cost (after
  lineage discounts), work, size and - when locked - why (`requires firmware
  v2`, `parasite cannot build turrets`, `a second core requires firmware v2`,
  `costs 0E/40M`).

The building set is the AoE2 Dark→Castle set with one factory instead of
three: core, cocoon, rack, depot, assembler, lab, turret, wall.

## 4. Ages: firmware with building requirements

AoE2 gates each age behind buildings of the previous one (two Dark Age
buildings for Feudal, two Feudal buildings for Castle) and a big lump sum.

| Age-up | Cost | Requires | Unlocks |
|---|---|---|---|
| firmware_v2 (Feudal) | 120E / 80M, 2 turns | a finished **assembler** | launcher, rider, wasp, anvil, turret, a **second core** |
| firmware_v3 (Castle) | 350E / 250M, 3 turns | a finished **lab** and 2 racks | walking_tower, drone_swarm, colossus fusion |

Economy techs (`fast_mining`, `rich_harvest`, `cargo_servos`, `cocoon_battery`,
`reinforced_core`) live at the core; military techs (`armor_1/2`, `cannons_1/2`,
`actuators`, `optics`, `anti_air`) live at the **lab** (the blacksmith). A
building researches *or* produces, one job at a time; `stop` cancels with a
full refund (the AoE2 cancel button).

The second core is the Castle Age boom: another drop-off, +10 compute, another
worker line, and - because a city only dies with its LAST core - insurance.

## 5. The command model: intents, not instructions

Unchanged from the first analysis and worth restating because it is the whole
reason a language model can play this: a player never scripts a unit's steps.

1. **Select** a unit or a group.
2. **One short intent**: move / attack / attack-move / gather / build / repair /
   rally / stop, or a production, research or diplomacy order on a building.
3. **Forget it.** The order persists. Workers cycle gather→carry→bank→return
   for the rest of the match; builders hammer until the site is done, then
   auto-task; military units auto-fire at anything in weapon range; a unit on
   attack-move fights its way to the destination and resumes.

New in s2.0: `rally` on a core or assembler sends every freshly trained unit
walking to a point (the AoE2 rally flag), `build` walks the worker to the site,
and every observation lists `economy.idle_workers` - the idle-villager button.

## 6. Combat, destruction and how you lose

Combat is the AoE2 rock-paper-scissors with no randomness (damage = attack +
bonus − armor, min 1): launchers beat infantry, riders beat ranged, massed
strikers beat riders, only anti-air hits fliers, ranged units do half damage
to buildings and the walking_tower (trebuchet) does full plus a bonus. All
damage is simultaneous; kill credit follows attacker id. Racks cascade, cocoons
burst on everyone around them, robots leave scrap.

Losing, adapted to the nomad start:

- A player who has **founded** a city is eliminated at the end of the turn in
  which its **last core** (finished or foundation) falls. Cores still take at
  most 150 damage per turn, so a siege lasts several turns and the screen shows
  the cracks/fire stages.
- A crew that never founded a city is eliminated when it has **no core site
  and no worker** left (nobody can build one).
- Abandonment (three missed turns) still razes the cores and leaves ruins.

Walls are the one deliberate departure from "attack everything": armies on
attack-move and turrets ignore palisades; only an explicit `attack` chews
through - otherwise every push would stall on 5-metal plates.

## 7. The pacing curve (measured, bots vs bots, 80 turns)

| Milestone | AoE2 (30-40 min game) | Cero s2.0 (bots, seed 42) |
|---|---|---|
| Town Center up | 0:00 (Nomad: ~1:30) | turn 2 |
| First scout skirmish | 3-5 min | turn 7 (the two starting strikers meet mid-map) |
| Feudal / firmware v2 | 9-11 min | turns 24-33 |
| Farms replace forage | 10-14 min | turns 25-35 (pods run dry, cocoons ring the core) |
| Castle / firmware v3 | 16-20 min | turns 42-55 |
| 20+ villagers | 10 min | turn 40: 20-25 workers (boom) |
| First real army clash | 12-18 min | turns 30-45 (rush: 17 strikers at turn 40; a boom that skips army dies at turn 64) |
| Second TC | 17-22 min | turns 45-60 (boom) |

`python engine/tools/balance.py` and the pacing probe used during tuning show
the three archetypes doing what their names say: rush beats a greedy boom,
turtle holds with turrets and walls and out-scores a rush, boom vs boom is a
two-core, six-depot, 25-worker economy race decided by army production.

## 8. Feedback: the screen must PROVE the simulation

Every cause has a visible effect at the place it happened, proportional to its
size, with a global channel for the important ones. What the renderer draws
from engine events (it never invents state):

| Event | Cero screen |
|---|---|
| `site_placed` | a foundation plate with the building drawn ghosted + scaffold |
| crew working | hammer sparks between each builder and the site, progress bar filling |
| `built` / `core_founded` | the building pops to full opacity; founding a city fires a banner and a big ring |
| gathering | a beam/spark link worker→resource; the worker shows its cargo crate |
| `deposit` | a `+N` energy/metal floater at the drop-off |
| `attack` | projectile flight or melee spark burst, victim flinches red, hp bar |
| `unit_killed` / `building_destroyed` | explosion scaled to the victim, persistent scorch decal |
| `pod_depleted` / `vein_depleted` | the tile turns to plain (the bushes are gone) |
| firmware | feed banner + highlight (the AoE2 "X has advanced to the Feudal Age") |
| minimap | pods (green), veins (gold), buildings, fog identical to the main view |

The bottom-left card explains any clicked thing in AoE2 words too: every
building tooltip names its AoE2 counterpart ("Depot - Mining camp / Mill"), a
foundation shows `work done / total` and its crew, a worker shows its cargo.

## 9. What is intentionally NOT copied

- **Real time.** Turns are WEGO; deadlines per turn replace APM.
- **Stone and wood as separate resources.** One building material (metal).
- **Three military buildings.** One assembler; the unit mix is the roster.
- **Gates, garrison, patrol, stances.** Walls have gaps; auto-engagement and
  attack-move cover 95% of AoE2 stances at turn scale.
- **Market / trade / relics / monks.** Camps are the neutral objective.
- **Villager fights.** Workers never auto-engage.
- **Two-player teams.** Formats are 1v1 and free-for-all (diplomacy without
  text replaces team play).

Everything else - nomad opening, forage→farms, drop-off distance, crews on
foundations, houses for pop, blacksmith upgrades, ages with building
requirements, towers and palisades, a second TC, the trebuchet, the counter
triangle, losing with the last TC - is in the engine and in the goldens.
