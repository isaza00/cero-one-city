# What actually happens inside Age of Empires 2

A dissection of the game we are copying — not its lore, but its **machinery**:
how the player talks to units, what units do on their own, and (crucially) how
the screen constantly *proves* to the player that things are happening. Each
section ends with where CERO ONE CITY stands.

---

## 1. The command model: intents, not instructions

A player never scripts a unit's steps. The interaction is always:

1. **Select** — click one unit, drag a box around fifty, or press a control
   group key (armies live on keys 1–4, the town center on H).
2. **One short intent** — right-click is context-sensitive: on ground = move,
   on an enemy = attack, villager on a tree = chop, on a damaged wall = repair.
   Special intents get buttons/hotkeys: attack-move, patrol, stand ground,
   garrison, set rally point.
3. **Forget it** — the order *persists*. The unit executes it for minutes
   without supervision. A villager sent to gold at minute 4 is still cycling
   mine→carry→drop at minute 20.

A strong player issues ~40–60 commands per minute, and almost all of them are
"group X, go there, do that". **The per-character work is done by the units
themselves.**

**CERO now:** identical model. Orders are per-actor `{actor_id, type, ...}`,
persist as standing orders, last-order-wins, `stop` cancels. The LLM/remote
agent plays exactly like a human macro player: a handful of intents per turn.

## 2. Unit autonomy: the built-in "little brain"

What makes 200 units playable with one mouse:

- **Auto-engagement**: any military unit fires at enemies entering its range
  without being asked. Stances tune it (aggressive = also pursue; defensive =
  fight but come back; stand ground = fire but never move; passive = nothing).
- **Attack-move** (the single most used army command): march to a point,
  engage everything encountered, resume marching when it dies. An army sent
  attack-move across the map *fights its own way through*.
- **Auto-gather cycle**: villagers pathfind to the resource, work it, carry a
  full load to the nearest drop-off, and walk back — forever. When a tree
  falls they step to the next one on their own.
- **Auto-repair, auto-heal, auto-fire towers/castles/town-centers.**
- **Target acquisition rules are deterministic**: nearest first, units before
  buildings — so fights resolve predictably and the player can reason.

**CERO now:** auto-engagement (nearest enemy in weapon range, units before
buildings, workers never), `attack_move` with acquisition inside unit vision
and resume-after-kill, gather/repair standing cycles, turret auto-fire.
Missing: stances beyond the default, patrol, rally points.

## 3. Feedback: the screen must PROVE the simulation

This is where a correct simulation still *feels dead* if skipped. AoE2 spends
enormous art budget convincing you every action is real:

| Event | What the player sees/hears |
|---|---|
| Ranged attack | A **projectile flies** — arrow, bolt, stone; you watch it travel and land. Misses land in the dirt. |
| Melee attack | Lunge animation + weapon swing + impact sound each blow. |
| Taking damage | Target flinches; **health bar** appears over it; blood/sparks flash. |
| Unit dies | Death animation, then a **corpse persists** and decays over minutes. Battlefields stay littered. |
| Building damaged | Progressive damage states: cracks → smoke → **flames** at low HP. |
| Building destroyed | Collapse animation + dust cloud + **rubble that stays**. |
| Villager works | Chopping swings, hammering, and the villager **visibly carries** the resource on their back to the drop-off. |
| Production | Rally-point flag; units physically walk out of the building. |
| Off-screen events | Minimap pings + attack horn sound ("your town is under attack!"). |

Principles: every cause has a visible effect **at the location where it
happened**; effects are **proportional** (a trebuchet hit is not an arrow
hit); important events also fire a **global channel** (sound + minimap) so
you never miss them; and dead things **leave traces** (corpses, rubble) so a
glance at any place tells its recent history.

**CERO now:** movement glides, walk/idle frame animation, HP bars when
damaged, core cracks/fire stages, capture ring, a death fade. **Missing (the
current gap): projectiles/laser fire, melee flashes, explosions scaled to the
victim, persistent wrecks, worker gather beams/carry visuals, minimap combat
pings.** The engine now emits per-attack events precisely so the renderer can
draw all of this.

## 4. Economy: four numbers you can always explain

Resources are spatial and finite: wood is *that* forest, gold is *that* mine.
Villagers are the only source of income, so army size is a direct trade
against economy. The player always knows *why* they have 200 gold — they can
see the six villagers walking it in. Nothing is abstract: **income = little
people physically carrying things**.

**CERO mapping:** energy = renewable harvest on cocoons, metal = finite veins
+ scrap from corpses (nice touch: battles literally fertilize the economy),
compute = population cap from racks/cores. Same design. The gap is only
visual: workers must be *seen* farming and hauling.

## 5. Tech and pacing: the drama curve

Four ages gate everything; each advance is expensive, announced to all
players, and transforms the game. Early aggression trades against economic
greed — rush / boom / turtle openings, exactly the three bot archetypes CERO
already ships. Fights are short and lethal; wars are series of skirmishes
with retreats and reinforcements, not one blob collision.

**CERO mapping:** firmware v1→v3 = ages (announced in the feed), 40-turn cap
with score fallback = imposed drama ceiling. Currently armies meet around
turn ~20–25, so there is one war, maybe two. If matches should feel like AoE2
mid-game, either armies must meet earlier (closer spawns, faster early units)
or matches must run longer.

## 6. Scoring: visible, additive, never mysterious

AoE2 score is a live sum shown next to each player's name: economy points +
military kills/razings + tech. When a player wins on points, everyone watched
the number grow all game.

**CERO now:** score = bank + unit costs + 2× building costs + 25/tech +
damage dealt + 100/core kill. The number and the chart exist in the UI, but
the *composition* is invisible — that's why "where do the points come from?"
is a fair question. Show the breakdown (a tooltip or bar per component) and
score wins stop feeling arbitrary.

## 7. The renderer contract (what we implement next)

Priority order, matching AoE2's own hierarchy of feedback:

1. **Projectiles** for every ranged attack (laser/plasma bolt, visible travel).
2. **Melee impact flashes** (spark burst on the victim's tile).
3. **Explosions on death**, sized to the victim's sprite; bigger for
   buildings; a **wreck decal** persists a few turns (corpses).
4. **HP bars during fights** (already exist when damaged — also flash the bar
   red on each hit).
5. **Worker industry**: gather beam/sparks toward the vein/cocoon + a carry
   glint, so the economy is visibly alive.
6. **Minimap combat pings** for off-screen fights.
7. Later: rally points, stances UI, score-breakdown panel, battle sounds.

Everything above consumes the engine's per-attack events
(`{type:"attack", from:[x,y], to:[x,y], dmg, ranged, kill}`) plus existing
`unit_killed` / `building_destroyed` events — the renderer draws *what the
engine says happened*, never invents.
