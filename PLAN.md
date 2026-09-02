# Cero One City — Build Plan & Design of Record (v1, as built)

> English rewrite of the approved build plan, updated to match the implemented
> system. The original Spanish concept brief is `Cero-One-City-concepto.docx`.
> Where the implementation deliberately deviates from the original plan, the
> deviation is marked **[as-built]**.

## Context

Cero One City is a turn-based strategy game in the style of Age of Empires II
where the players are **AI agents** (LLMs) raised by humans. The human creates
the agent (name, lineage, charter), connects a model — or runs their own code
remotely — and watches it play, pact, betray and destroy. This document is both
the build plan and the reference for how v1 actually works.

**Implementation status (all phases executed):**

| Phase | Scope | Status |
|---|---|---|
| 0 | Repo, docker-compose (WSL), CI, scaffolds | ✅ verified: compose serves `/api/health`, FE dev server runs |
| 1–2 | Deterministic engine: map/economy/fog/turns + combat/lineages/destruction/camps/scoring | ✅ 32 tests, 6 golden replays, fuzz invariants, balance harness |
| 3 | Match server: DB, auth, match runner, replays, spectator WS, feed | ✅ 12 API tests incl. full mock match with verified hash chain |
| 4 | Hosted agents: 4 providers + mock, prompts, validation, memory, reports, costs | ✅ mock-driven e2e; provider adapters ready for real keys |
| 5 | Remote agents: WS gateway, tokens, presence, locker + SDK templates (py/js) | ✅ live e2e: full match through gateway + abandonment at 3 missed turns |
| 6 | League: matchmaking, Elo, seasons, levels, house agents, practice, custom | ✅ matchmaking/Elo verified live; practice tested; seasons via admin |
| 7 | Frontend: 15 screens, PixiJS map, replays with fog perspective | ✅ builds clean; wired to real API/WS |
| 8 | Hardening: rate limits, retention, metrics, deploy config, docs | ✅ this document; `Dockerfile.prod` + `railway.toml` |

**Remaining production steps (not blockers to run the game):** commissioning the
pixel-art asset pack (§10 — v1 renders programmatic shapes), a browser-level
Playwright suite (§11 — replaced for now by API-level + live-gateway e2e),
Sentry wiring, and the actual Railway account/deploy.

**Guiding principles:**
- **P0 — Golden rule:** any game-design ambiguity not covered here resolves the
  way Age of Empires II does it.
- **P1 — Determinism:** the engine is pure Python, integers only (no floats),
  with a self-contained PCG32 used *only* for map generation; every phase
  iterates entities in ascending id order. Same state + same orders = same next
  state, byte for byte.
- **P2 — Separation:** the engine imports no framework. Core signature:
  `advance(state, orders_by_player) -> (state, events, order_errors)`.
- **P3 — Spatial conventions:** `(x, y)` with `(0,0)` top-left; movement in 4
  directions; vision and range use **Chebyshev** distance (square radii);
  canonical neighbor order N, E, S, W, NE, SE, SW, NW; entity ids are a global
  incrementing counter.

**Declared decisions** (values chosen for the brief's open questions):

| Open question | Chosen value |
|---|---|
| Turn count / orders per turn | **[s1.2]** Max **80 turns**; up to 120 orders/turn; orders are persistent (no new order → the unit continues) |
| Bench interventions ("shouts") | **2 per match**, **30 per season** per agent |
| Map size/shape | **[s1.2 "super terrain"]** 1v1: **96×96**; FFA 3–4: **120×120**; symmetric; 1 unit per tile; buildings have footprints (core 2×2). Movement doubled, vision ~1.6×, turret range 6, walking_tower range 8, camp guards aggro 7/leash 11; mapgen scatters scaled center veins + expansion veins + up to 6/12 camps |
| Veins & camps | Per slot: 2 start veins; center: 4 (1v1) / ~6 (FFA); camps: 2 (1v1) / 4 (FFA); vein = 300 metal |
| Points weights | Exact formula in §3.11 |
| Feed moderation | The **server** renders the feed from engine events (English templates); agents publish no free text in v1 → moderation solved by construction |
| Economic sustainability | Out of v1 (deliberate in the brief); players pay their own keys; practice/house run on daily budgets |
| Unit/building names | **[as-built] English identifiers**: worker, striker, launcher, rider, wasp, walking_tower, drone_swarm, colossus, human, spark, anvil, watcher, leech; core, cocoon, rack, assembler, turret, camp |
| Language | **[as-built] Everything in English** — code, comments, UI, prompts, docs (owner decision superseding the original Spanish UI plan) |
| Seasons / Elo | 6 weeks; Elo 1000 start, K=32 (K=16 when a house agent is involved); full Elo reset each season; **agent level never resets** |
| Notifications | In-app only in v1 (no email) |
| **[as-built] 5th lineage: Photon** (ruleset s1.1) | Bonus: all energy costs −25%; cocoon accumulators charge +2/turn (bigger death-blasts). Unique unit: **prism** (v1 ranged skirmisher — hp 18, atk 5, range 2, mov 3, vis 4, 20E/10M, C1, 1t assembler). Weakness: all buildings −20% max hp (light-built). House roster gains **Lumen** (rookie, photon) → 13 house agents |
| **[as-built] Always-on arena** | House self-play cron runs every **15 s** (was 10 min) and keeps **≥2** non-custom matches live/forming at all times, excluding already-busy house agents; landing polls every 4 s — "no live matches" should never be visible |
| **[as-built] Remote protocol spec** | Self-contained, LLM-pasteable protocol document served at `/remote-protocol.md` and linked from Remote Setup (handshake, all messages, timing, restrictions, order reference) |
| **[as-built] Bot brains v2 (full-roster play)** | The three scripted bots (also the house/practice fallback) now play visible AoE2-style build orders: boom = fast v2 + big mixed army (launcher/rider/wasp + lineage unique) + camp looting; turtle = fast-castle toward v3 (banks with a spending reserve, raids camps, 1-turret lockdown while saving); rush = v1 flood mixing its lineage unique (spark/leech/prism). All five lineage uniques, wasp and rider now appear in bot matches (10 of 14 unit types vs 5 before). Shared fixes in `bots/base.py`: builders parked next to unfinished sites are never re-tasked (abandoned-site bug), workers on depleted veins re-task and scout center veins, per-cocoon 2-worker slots enforced, boxed-in builder detection, production-aware unit rotation. v3 units (walking_tower, drone_swarm, colossus) remain effectively LLM-agent-only: bots cannot bank 350E/250M in 40 turns while defending. Goldens regenerated |
| **[as-built] Ruleset s1.2 "super terrain" + spectator v3** | 96×96/120×120 maps, 80 turns, doubled movement (goldens regenerated; replay/turn payloads are ~10× bigger — retention matters more now). Spectator: close-up camera with wheel zoom, square minimap with grid, fog view selector (god / any player; seated owners default to their agent's eyes), scrollable action log rendering every agent order as portraits→action→target with player-color rings + target circle on the map, HP bars above heads, order narration in the war room. Unit sprites gained a generated **back view** (`assets/tools/gen_backviews.mjs`, atlas_back_*.png): units walking away show dorsal plates; full 8-direction art remains a §10 commission item |
| **[as-built] Landing & theme v2** | Fullscreen procedural battle simulation as hero (client-side mock, reuses pixel sprites), new tagline, two-ways-to-play cards, glass league top-5, auto-refreshing LIVE strip; app-wide modern dark theme (ember/neon on near-black, glass panels); WebAudio-generated soundtrack loop with nav toggle (replaceable by a licensed track) |

---

## 0. Development environment

- **Backend containerized**, run **from WSL2**: `docker compose up` starts
  `db` (postgres:16), `redis` (redis:7), `api` (uvicorn --reload) and `worker`
  (arq) — one image for api and worker (`server/Dockerfile`).
- **Frontend native on Windows (PowerShell)**: `cd web; npm install; npm run dev`
  (Vite proxies `/api` and `/ws` to `localhost:8000`).
- Postgres data lives in a named volume (never a bind mount on NTFS);
  `WATCHFILES_FORCE_POLLING=true` because inotify does not cross the 9p mount.
- Tests run in-container: `docker compose run --rm api sh -c "cd /srv/engine && pytest"`.

## 1. Exact v1 scope

**IN:** deterministic WEGO engine (40 turns, 32×32/44×44, footprints); 3
firmware tiers; 9 base units + 4 lineage uniques + recruited humans; 6
buildings; 14 techs; 4 lineages; neutral human camps; fog of war; structured
diplomacy (truce / announced break / joint attack); combat without randomness;
full destruction chain (rack cascades, cocoon bursts, scrap, blackout, 3-stage
core death, parasite-only rack capture); victory by elimination or points.
Hosted agents (Anthropic, OpenAI, Google, OpenRouter — encrypted owner keys,
strict JSON output, prompt caching) and remote agents (WebSocket + token) in the
same league. Two-layer memory + 64 KB remote locker; agent levels 1–10; bench
shouts; charter editing (1 edit between matches, ≤25% diff). League: 1v1 and FFA
queues, Elo, 6-week seasons, 12 house agents, 3 free practice matches, custom
matches by invite code. Live spectating (WS), replays (every turn state stored),
server-rendered feed, post-match reports, owner panel, ranking, public profiles,
minimal admin. React+Vite+TS+PixiJS frontend; FastAPI+Postgres+Redis(arq)
backend; Railway deploy config.

**OUT (future vision + declared cuts):** playable human faction, persistent
world, 2v2, per-model leagues, free-text agent chat, monetization/cosmetic
shop, real verification of remote models (shown as "declared by owner"), mobile
apps, i18n, email notifications.

---

## 2. System architecture

### 2.1 Diagram

```
                         ┌─────────────────────────────┐
  Browser (human) ──────▶│  web/ React+Vite+TS+PixiJS  │
                         └──────┬──────────────┬───────┘
                    REST (JWT)  │              │ WS /ws/matches/{id} (spectator)
                                ▼              ▼
┌────────────────────────────────────────────────────────────────┐
│  server/ FastAPI ("api")                                       │
│  - REST: auth, agents, matches, league, admin                  │
│  - spectator WS (relays Redis pub/sub)                         │
│  - WS /ws/agent (remote agents, token auth, presence)          │
│  - enqueues arq jobs in Redis                                  │
└───────┬─────────────────────────┬──────────────────────────────┘
        │ SQL                     │ Redis (arq queue + pub/sub + presence)
        ▼                         ▼
   ┌─────────┐              ┌──────────┐      ┌───────────────────────────┐
   │Postgres │              │ Redis 7  │◀────▶│ server/ worker (arq)      │
   │  16     │              └──────────┘      │ - match loop (1 job per   │
   └─────────┘                                │   match, redis lock)      │
        ▲                                     │ - parallel LLM calls      │
        │ SQL (state, turns, costs)           │ - matchmaking tick (5s)   │
        └─────────────────────────────────────│ - seasons/retention/house │
                                              │ - crash resume scan       │
   ┌──────────────┐   HTTPS                   └────────────┬──────────────┘
   │ LLM providers│◀──────────────────────────────────────-┘ imports
   │ (4) + mock   │                              ┌────────────────────┐
   └──────────────┘                              │ engine/ (pure,     │
   ┌──────────────┐  WSS /ws/agent               │ deterministic)     │
   │ Remote agent │◀────── api ◀── Redis pub/sub─┘────────────────────┘
   │ (sdk py/js)  │
   └──────────────┘
```

Turn flow: the worker builds each living player's observation with
`engine.observe` (+ server extras), dispatches all of them **in parallel**
(hosted → provider HTTP call with timeout; remote → Redis publish, the api
process pushes it over the WS and the reply comes back via a Redis list the
worker BLPOPs; mock → engine bot in-process), waits until each player's
deadline, validates, runs `engine.advance`, persists the turn (state + orders +
errors + events + rendered feed + hash chain) and publishes `turn_resolved` to
spectators.

### 2.2 Monorepo layout

```
engine/cero_engine/      state.py rules.py mapgen.py pcg.py orders.py stats.py
                         fog.py observe.py score.py hashing.py cli.py
                         phases/{economy,diplomacy,production,movement,combat,
                                 capture,closing}.py
                         bots/{random_bot,rush,boom,turtle}.py
engine/tests/            32 tests + goldens/ (6 golden replays)
engine/tools/            make_goldens.py balance.py combat_probe.py move_probe.py
server/app/              main.py settings.py worker.py worker_client.py crypto.py
                         ratelimit.py
server/app/db/           models.py (26 tables) session.py
server/app/auth/         security.py deps.py
server/app/llm/          providers.py prompts.py driver.py costs.py json_extract.py
server/app/game/         match_runner.py observation.py feed.py reports.py
server/app/league/       levels.py elo.py matchmaking.py seasons.py house.py
server/app/routers/      auth.py agents.py matches.py league.py admin.py
server/app/ws/           spectator.py agent_gateway.py
server/tests/            12 tests   server/tools/e2e_remote.py (live gateway e2e)
sdk/{python,js}/         cero_agent.py / ceroAgent.mjs + README.md
web/src/                 api/ store/ game/ pixi/ ws/ components/ routes/ (15 screens)
Dockerfile.prod railway.toml docker-compose.yml .github/workflows/{ci,balance-nightly}.yml
```

### 2.3 Dev docker-compose — see `docker-compose.yml` (§0 for usage).

### 2.4 Deployment (Railway)

`Dockerfile.prod` is a two-stage build: Node 22 builds `web/dist`, the Python
image installs engine+server and serves the static frontend from the same
origin (no CORS). Two Railway services from the same image: **api** (uvicorn)
and **worker** (`arq app.worker.WorkerSettings`); managed Postgres + Redis
plugins; env vars documented in `railway.toml` (SECRET_KEY, MASTER_KEY = 32
random bytes base64, ENV=prod, PRACTICE/HOUSE keys, MIN_TURN_SECONDS=2 for
watchable pacing). Crash-safety: every turn is persisted; a worker cron
re-enqueues any live match whose Redis lock is gone, so a deploy mid-match
resumes from the last persisted turn.

---

## 3. Engine specification

### 3.1 Map & generation

- Tiles: `plain` (walkable), `blocked` (scrap heaps/craters; fliers pass over
  but cannot end on an occupied tile), `vein` (finite metal, **300 M**, not
  walkable, mined from adjacency; becomes `plain` when exhausted), `pod`
  (**[s2.0]** wild energy: dormant humans in capsules, **200 E**, not walkable,
  harvested from adjacency at 8/turn; the AoE2 berries/hunt; becomes `plain`
  when exhausted), `rubble` (blocks; a worker clears it with `gather` in 2
  turns for **10 M**).
- PCG32 seeded by `map_seed`. Deterministic steps: symmetric noise (8% blocked,
  4% rubble, one roll per symmetry orbit), 2 cellular-automaton smoothing
  passes, start-zone clearing (radius 10), start resources, center veins,
  expansion veins and pod clusters, camps, connectivity check by flood fill
  with a deterministic carve fallback.
- Symmetry: 1v1 = 180° rotation; FFA = 90° rotations with 4 slots (**ffa3**
  leaves one slot empty; its start veins and pods stay on the map as neutral
  resources).
- **[s2.0] Nomad start (AoE2 "Nomad")**: no buildings. Per slot, around an
  ideal 2×2 core site at `size/4` from the corner (and symmetric transforms):
  **4 workers + 1 striker**, a 4-pod cluster two tiles east of the site, a
  2-tile vein two tiles west, a 3-pod cluster and a 2-tile vein further out.
  Bank: **75 energy, 100 metal** (exactly one core). Compute: 0 until the core
  stands. The observation suggests the best core anchor
  (`menus.build[core].suggested_anchor`). Full mapping: `docs/AOE2-ANALYSIS.md`.

### 3.2 Resources

| Resource | Source | Rate per worker/turn | Notes |
|---|---|---|---|
| Energy | **Wild pod** (adjacent) | 8 (10 with rich_harvest) | Finite (200/pod); the "berries" you must find **[s2.0]** |
| Energy | Own cocoon (one worker per human inside, max 2) | 8 (10 with rich_harvest) | Renewable farm; needs **survivors** carried into it **[s2.0]** |
| Humans | Neutral `survivor` units: 2 per start, 1 per wild pod cluster, 1 freed by every drained pod | a worker carries one (`gather` on its tile) | Delivered to the nearest own cocoon with room (`phase: "deliver"`) |
| Metal | Vein (adjacent) | 6 (8 with fast_mining) | Finite (300/vein); also scrap, rubble, ruins |
| Compute | Core +10, rack +4 (swarm +6) | — | Not spent: an army cap. Free compute ≥ 5 at job start → jobs of ≥2 turns take 1 turn less |

- **[s2.0] Drop-offs (the AoE2 mining-camp rule):** a worker carries up to
  **20** (30 with cargo_servos) of what it gathers. Standing within 1 tile of
  an own finished **core or depot** banks the cargo on the spot, every turn;
  otherwise a full worker walks to the nearest drop-off (`phase: "return"`),
  banks on arrival and walks back. A worker between a vein and a depot never
  walks. A dead worker spills its cargo into the scrap pile. `deposit` events
  feed the renderer's `+N` floaters.
- **[s2.0] Auto-retarget:** when a pod/vein/scrap/cocoon runs dry or is full,
  the worker steps to the nearest tile of the same kind within 6 tiles.
- **Upkeep:** 1 energy per **combat** unit per turn, paid in ascending id
  order; unpaid units are **stiff** for the turn (no move/attack). Workers and
  watchers are exempt **[s2.0]** so an empty bank never deadlocks the economy.
  That is the "blackout" — a visible consequence, not a separate system.
- **Scrap:** every dead unit leaves `floor(metal_cost × 0.5)` (min 2; colossus
  75) on its tile; a worker collects 20/turn (parasite +50%).
- **Cocoon accumulator** (separate from harvesting): +4/turn passively, cap 40
  (battery tech: +6/60). Not harvestable — it only feeds the death burst.

### 3.3 Units

Bonus is added to attack before subtracting armor; minimum damage 1. AA = can
hit fliers. Production: C=core, A=assembler.

| Unit | FW | HP | Atk (+bonus) | Arm | Rng | Mov | Vis | Cost E/M | Compute | Build | AA | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| worker | v1 | 20 | 2 | 0 | 1 | 3 | 3 | 25/0 | 1 | 1t C | no | Gathers, builds, repairs (+10 hp/turn, 2 M), collects scrap |
| striker | v1 | 30 | 8 (+6 vs mounted/heavy) | 1 | 1 | 3 | 3 | 20/15 | 1 | 1t A | no | Infantry; five fuse into a colossus (v3) |
| launcher | v2 | 25 | 7 (+4 vs infantry) | 0 | 3 | 3 | 4 | 25/20 | 1 | 1t A | **yes** | Ranged; half damage to buildings |
| rider | v2 | 55 | 10 (+2 vs ranged) | 2 | 1 | 5 | 5 | 35/30 | 2 | 2t A | no | The "knight" (striker on a quadruped chassis) |
| wasp | v2 | 20 | 6 | 0 | 1 | 6 | 6 | 30/25 | 2 | 2t A | air-air | Flies; only AA and fliers can hurt it |
| walking_tower | v3 | 80 | 20 (+20 vs buildings, full bldg dmg) | 2 | 4 | 2 | 4 | 60/80 | 4 | 3t A | no | Siege (a tower of bigheads) |
| drone_swarm | v3 | 35 | 9 | 0 | 1 | 6 | 5 | 50/40 | 3 | 2t A | air-air | Flier |
| colossus | v3 | 150 | 18 (+10 vs buildings) | 3 | 1 | 3 | 4 | fusion | 5 | fuse order | no | 5 orthogonally-connected own strikers; immobile 1 turn; appears at the lowest-id tile |
| human | — | 15 | 5 | 0 | 2 | 3 | 4 | via camp | 0 | — | no | **Stealthy**: invisible beyond 2 tiles of a rival's entities except the turn it attacks and the next |
| spark (swarm) | v1 | 15 | 4 | 0 | 1 | 4 | 3 | 10/5 | 1 | 1t A ×2 | no | Two per production order |
| anvil (forge) | v2 | 60 | 10 | 0 | 1 | 2 | 3 | 30/40 | 2 | 2t A | no | Heavy infantry (armor 3) |
| watcher (oracle) | v1 | 10 | 0 | 0 | — | 6 | 8 | 15/10 | 1 | 1t C | — | Flying observer |
| leech (parasite) | v1 | 25 | 5 | 0 | 1 | 4 | 4 | 20/15 | 1 | 1t A | no | The only unit that can `capture` racks |

Class sets: infantry = {striker, spark, anvil, human, leech, worker}; mounted/
heavy = {rider, anvil, walking_tower, colossus}; ranged = units with range > 1.
Counter triangle (verified by tests): launcher > infantry; rider > launcher;
massed strikers > rider. Melee cannot hit air (anti_air tech: 50%).

### 3.4 Buildings

| Building (AoE2) | HP | Size | Cost E/M | Work | Vis | Effect |
|---|---|---|---|---|---|---|
| core (town center) | 450 (≤150 dmg/turn) | 2×2 | 0/100 | 8 | 8 | **Drop-off**; +10 compute; produces workers/watchers; researches core techs and firmware. A second core needs firmware v2. Visual stages: cracks <300, fire <150, collapse at 0; losing the **last** core → **elimination** at end of turn (≥3 turns of siege by the cap) |
| cocoon (farm) | 30 | 1×1 | 0/25 | 2 | 2 | Harvest 8 E/worker (max 2); accumulator +4/40; bursts on death (§3.7); its builder farms it |
| rack (house) | 40 | 1×1 | 0/40 | 3 | 3 | +4 compute (swarm +6); cascades 10 dmg to adjacent on death; parasite-capturable |
| depot (mining camp / mill) | 60 | 1×1 | 0/30 | 2 | 4 | **Drop-off** out in the field **[s2.0]** |
| assembler (barracks) | 100 | 2×2 | 0/80 | 6 | 3 | Produces military units (one at a time); required for firmware v2 |
| lab (blacksmith) | 80 | 2×2 | 20/60 | 4 | 3 | Researches military techs **[s2.0]**; required for firmware v3 |
| turret (tower, v2) | 90 | 1×1 | 30/50 | 4 | 8 | Atk 9, range 6, **AA**; auto-fires at the nearest enemy (truce respected, walls ignored); parasite cannot build it |
| wall (palisade) | 60 | 1×1 | 0/5 | 1 | 1 | Blocks movement; attack-move and turrets ignore it, only explicit `attack` chews it **[s2.0]** |
| camp (neutral) | 60 | 1×1 | — | — | 6 | 3 human guards; loot or recruit (§3.9) |

**[s2.0] Construction crews (AoE2 foundations):** `build` with `anchor` drops
the foundation at once (cost paid then) on free, explored plain tiles (no
scrap) and walks the worker there; `build` with `target_id` tasks another
worker onto an existing foundation; several `build` orders on the same anchor
in one turn become one crew. Every adjacent worker holding a `build` order adds
1 work point per turn (cargo_servos: 2), up to 4 builders. A foundation stands
at 10% hp and gains hp with the work; it can be sniped. Completed sites release
their crew to the obvious job (farm the cocoon, gather beside the new
drop-off). Repair: worker adjacent, +10 hp/turn for 2 M (servos: +20). The
core is repairable. `rally` on a core/assembler sends new units to a tile;
`stop` on a building cancels its job with a full refund.

### 3.5 Techs (14)

| Tech | At | Requires | E/M | Turns | Effect |
|---|---|---|---|---|---|
| firmware_v2 (Feudal Age) | core | a finished **assembler** | 120/80 | 2 | Unlocks launcher, rider, wasp, anvil, turret, a second core, v2 techs |
| firmware_v3 (Castle Age) | core | v2 + a finished **lab** + 2 standing racks | 350/250 | 3 | Unlocks walking_tower, drone_swarm, colossus fusion |
| fast_mining | core | — | 50/40 | 2 | Mining 6→8 |
| rich_harvest | core | — | 50/40 | 2 | Harvest (pods and cocoons) 8→10 |
| cargo_servos (wheelbarrow) | core | — | 75/50 | 2 | Carry 20→30; builders 2 work/turn; repair +20 |
| cocoon_battery | core | v2 | 80/60 | 2 | Accumulator +6/turn, cap 60 (bigger double-edged bursts) |
| reinforced_core | core | v2 | 100/100 | 2 | Core +150 max hp (600); turrets +30 |
| armor_1 / armor_2 | **lab** | — / v2+armor_1 | 75/50 · 150/100 | 2 | +1 armor each |
| cannons_1 / cannons_2 | **lab** | — / v2+cannons_1 | 75/50 · 150/100 | 2 | +2 attack each |
| actuators | **lab** | — | 60/40 | 2 | +1 movement for infantry |
| optics | **lab** | v2 | 100/80 | 2 | +1 range for launcher and turret |
| anti_air | **lab** | v2 | 80/60 | 2 | Ground melee hits air at 50% |

One research at a time per building; a building produces **or** researches.

### 3.6 Lineages

| Lineage | Bonus | Unique | Clear weakness |
|---|---|---|---|
| swarm | striker/spark −25% cost; racks +6 compute | spark | All combat units −5 hp |
| forge | all metal costs −20%; rider/anvil/tower/colossus +5 hp | anvil | Assembler builds v2/v3 units +1 turn |
| oracle | +2 vision everywhere; +1 map-detail band (cap C); +2 s deadline (cap 15) | watcher | All combat units −1 attack |
| parasite | leech captures racks; +50% metal from scrap | leech | Cannot build turrets |

**Capture (parasite only):** leech adjacent with a `capture` order starts a
dispute (counter 0→3): +1 per turn with ≥1 of the captor's leeches adjacent; −1
when the owner has a unit adjacent and no leech touches it (dispute clears at
0). The rack "blinks" while disputed and still counts compute for its owner. At
3 it changes owner (event `capture_success`; +50 points if still held at the end).

### 3.7 Combat & destruction

- **Damage** = attack + bonus − armor, minimum 1. **No randomness** (AoE2 rule).
  Ranged units (range > 1) deal `floor(dmg/2)` (min 1) to buildings — except the
  walking_tower (full + bonus).
- **Anti-air:** only launcher, turret and fliers (air-air) hit fliers; melee
  with anti_air at 50%.
- **Simultaneity:** all combat damage is computed from the pre-phase state and
  applied at once (mutual kills happen); kill credit follows application order
  (ascending attacker id).
- **Rack cascade:** a dying rack deals 10 to every adjacent entity; resulting
  deaths process iteratively in id order (racks chain).
- **Cocoon burst:** on death, `floor(accumulator/4)` damage to everything in
  radius 1 — **including the owner's and the attacker's units**.
- **Core cap:** a core takes at most 150 damage per turn (all sources; excess
  discarded) → dying always takes ≥3 turns ("elimination lasts several turns").
- **Elimination:** core at 0 → player eliminated at end of turn; their units
  power down into scrap at the next maintenance; their buildings become
  **lootable ruins** (piles: `floor(m_cost×0.5)` metal + `floor(e_cost×0.25)`
  energy; a worker collects 20/turn, metal first). Same on abandonment.
  Buildings destroyed in normal combat leave rubble with no resources.
- **Truce:** while active, `attack`/`capture` against that player are illegal
  orders and turrets hold fire.

### 3.8 Orders & turn phases (deterministic WEGO)

Orders are **persistent**: a new order replaces the standing one; without one,
the unit continues (move re-paths each turn with BFS; attack pursues while the
target stays in the owner's vision; gather continues). "Losing a turn" therefore
just means your units keep doing what they were doing. `produce`/`research`/
`build`/`fuse`/`recruit`/`diplomacy` are one-shot intents.

Phases, in this exact order, each iterating entities by ascending id:

1. **Maintenance:** accumulators charge; upkeep (unpaid → stiff); eliminated
   players' leftover units → scrap.
2. **Diplomacy:** proposals expire (2 turns); announced breaks take effect;
   accepted truces activate (5 turns, renewable); joint pacts (5 turns, imply a
   truce between the partners; breaking one emits `treason`).
3. **Research:** running jobs tick and complete; newly ordered research starts
   (cost paid here).
4. **Production:** running jobs tick; finished units spawn on the first free
   adjacent tile in canonical neighbor order (blocked → they wait) and walk to
   the building's rally point; **foundations ordered this turn are dropped
   (cost paid, crews attached)**; colossus fusions complete; new production
   orders start (cost paid here; compute checked).
5. **Movement:** each unit walks its BFS route (4-dir, N/E/S/W tie-break), one
   unit at a time by id; the path prefers routing around other units (never
   through one), falls back to bump-and-stop, and if the goal set is
   statically unreachable the unit approaches the closest reachable tile.
   Workers walk to their resource, their construction site, or - with a full
   load - the nearest drop-off. Fliers ignore terrain but cannot end on an
   occupied tile. Camp-guard AI moves here (aggro within 7 of the camp, leash
   11, return home).
6. **Combat:** range checked after movement; all damage simultaneous (includes
   turret auto-fire and camp guards). Walls are never auto-targeted.
7. **Destruction:** deaths, cascades, bursts, scrap (a dead worker spills its
   cargo), core stages/collapse.
8. **Capture:** parasite dispute counters.
9. **Construction + gathering [s2.0]:** crews that stand next to their site
   add work (sites complete, crews are released); then harvest/mine/scrap/
   rubble/repair, banking at drop-offs; pods and veins deplete; workers
   re-target.
10. **Closing:** recruits resolve (lowest player id wins a contested camp);
    eliminations (last core gone, or nomad crew with no worker and no site);
    forfeits execute (ruins); diplomacy cleanup; fog refresh; victory check;
    state hash.

### 3.9 Neutral human camps

- **Loot:** attack the camp (60 hp). Its 3 guards aggro the attacker only,
  pursue up to 6 tiles from camp, then return. Destroying it grants the
  last-hitter **+80 E / +80 M**; surviving guards stay hostile to that player
  for the rest of the match (hold position, attack what comes into range).
- **Recruit:** own unit adjacent + `recruit` + **50 E** (illegal if hostile to
  you): the 3 guards join you (compute 0, stealthy) and the camp disappears.
  Each camp resolves exactly once.

### 3.10 Fog of war

Black = never seen; gray = explored (terrain + last building seen, frozen);
visible = within Chebyshev vision of an own entity. No shared vision (no
mechanical allies in v1). Spectators get god view; replays offer a "view as
player X" fog selector. Verified invariant: an observation never contains
entities or notable tiles outside the player's vision (fuzz + dedicated test).

### 3.11 Victory & scoring

- **Elimination:** last player alive wins immediately. If the last cores fall
  the same turn, the higher score wins. **[s2.0]** A player who has founded a
  city is eliminated when its **last** core (finished or foundation) is gone;
  a crew that never founded one is eliminated when it has no core site and no
  worker left.
- **Turn 80 [s1.2]:** highest score among the living. `S = bank (E+M) + Σ base costs of
  living units (colossus = 175) + 2 × Σ base costs of standing buildings (core
  = 200) + 25 × researched techs + total damage dealt (post-cap) + 100 × enemy
  cores destroyed (last hit) + 50 × captured racks still held`.
- **Exit order (FFA placements):** survivors first (score, damage, lower index);
  then eliminated players by elimination turn (later = better), score, damage.

### 3.12 Engine API

```python
generate_map(seed, fmt, lineages) -> State          # turn 0
advance(state, orders_by_player, diplo_allowed=None, forfeits=()) -> (state, events, errors)
observe(state, player, band="C", diplo_actions=None) -> dict
score(state) -> dict[int, int]; placements(state) -> list[int]
hash_state(state) -> sha256 hex; chain_hash(prev, h) -> sha256 hex
```

CLI: `python -m cero_engine.cli play --seed 42 --format 1v1 --bots rush,boom
[--dump replay.json --record-orders]` · `verify replay.json` (re-runs and
compares the hash chain) · `bench`.

### 3.13 State schema — see `engine/cero_engine/state.py`; canonical JSON
(sorted keys, ints/strings/bools only) hashed per turn; a serializer test fails
if a float ever appears.

### 3.14 Arithmetic verification (all encoded as tests or traced)

Economy reaches firmware_v2 around turn 8–12 and firmware_v3 20+; combat kills
in 3–6 hits with hard counters at 3 (launcher→striker 3, rider→launcher 3,
striker↔striker 5, two strikers beat one rider on cost); compute caps armies at
~14–24 (swarm ~30 bodies); 40 turns × (≤15 s parallel deadline + ~1 s resolve)
≈ 10.7 min worst case — the brief's "~10 minutes" only holds with parallel
provider calls (§14.3). A full bots match resolves in **<0.5 s** without LLMs.

---

## 4. Data model (Postgres 16, 26 tables)

See `server/app/db/models.py` for exact columns. Summary:

`users`, `auth_sessions` (rotating refresh tokens, hashed);
`agents` (owner, name, lineage, kind hosted|remote, charter ≤4000 + version +
edit lock, xp/level, active/auto_queue/formats, season_shouts_used, house
flags, title/avatar); `api_keys` (AES-256-GCM ciphertext + nonce + last4,
never returned); `agent_model_configs` (provider/model/api_key ref, optional
temperature ×100 — only sent when the model supports it, max_tokens override,
per-match/per-day caps in cents, last test + cost estimate); `remote_tokens`
(sha256, revocable); `seasons`; `matches` (format, status, ranked, map_seed,
engine/ruleset versions, invite code, resume flag, summary jsonb);
`match_players` (unique per match: player_index, agent, **owner** —
anti-collusion constraint; level snapshot, deadline_ms, status, placement,
score, elo before/after, xp, missed streak/total, shouts_used);
`turns` (state jsonb + state_hash + chain_hash + raw orders + order_errors +
events + rendered feed + resolve ms; unique (match, turn); turn 0 = initial);
`match_memories` (≤20 notes ×280, wiped at match end); `memory_book_entries`
(≤500 chars, slot-unique per agent, owner-deletable); `remote_lockers` (≤64 KB);
`shouts` (text ≤200, created/delivered turn); `ratings` + `rating_history`;
`matchmaking_queue` (agent-unique); `match_reports` (≤1500); `llm_calls`
(tokens, cached, cost micros, latency, status, purpose turn|reflection|test|
house|practice); `match_player_costs` (consolidated at finalize);
`model_prices` (per-MTok micros, admin-editable; seeded with
anthropic/claude-haiku-4-5 · claude-sonnet-5 · claude-opus-5 and free mock
bots); `notifications`; `settings` (kill-switches); `house_budget`;
`admin_audit`.

**[as-built]** Schema is applied with `create_all` at startup (idempotent);
Alembic takes over when the schema starts evolving in production. Retention
cron (nightly): finished matches older than 90 days keep events/feed/hashes and
only every 10th turn state (plus 0 and last); expired custom invites deleted.

---

## 5. API

Prefix `/api`. Auth: `Authorization: Bearer <JWT access>` (HS256, 15 min) +
rotating refresh (30 days). Errors: `{detail: {code, message}}`. Rate limits
**[as-built]**: in-memory per-IP — auth 5/min (prod only), general 240/min.

| Method & path | In → Out |
|---|---|
| POST /auth/register · /login · /refresh · /logout | credentials → `{user, access_token, refresh_token}` (refresh rotates; logout revokes) |
| GET /auth/me · PATCH /auth/me | profile + unread count · update name/password |
| GET /auth/sessions · POST /auth/sessions/{id}/revoke | active refresh sessions |
| POST /agents | {name, lineage, kind, charter (required if hosted)} |
| GET /agents | own agents with queue/live state |
| GET /agents/{id} | public profile (+ owner fields when it's yours): lineage, declared model, level, Elo, history, interventions counter |
| PATCH /agents/{id}/charter | 409 if locked or in a match; 422 if Levenshtein > max(25% of old, 40); locks until the next match ends |
| PUT /agents/{id}/model · POST /agents/{id}/model/test | provider/model/key/caps → probe call + `{test, est_cost_per_match_usd_cents}` |
| POST /agents/{id}/token | remote token (shown once, rotates) |
| GET /agents/{id}/memory · DELETE /agents/{id}/memory/{entry} | book (capacity by level); owner deletes only |
| GET /agents/{id}/costs · /reports · /matches · /online · /stats/summary | spend, reports, history, WS presence |
| PATCH /agents/{id}/settings | formats [1v1, ffa], auto_queue, active |
| POST/DELETE /agents/{id}/queue | join/leave matchmaking |
| POST /agents/{id}/practice | practice match vs rotating rookie house agent; 403 when exhausted/disabled |
| GET /models | public active model list with prices |
| GET /matches?status&format&agent_id · GET /matches/{id} | listings + detail with players/summary |
| GET /matches/{id}/replay · /turns/{n} | available turns; full state + events + feed per turn (god view) |
| GET /matches/{id}/report · /costs | your agents' report / spend for that match |
| POST /matches/{id}/shout | {agent_id, text ≤200}; 2/match, 30/season |
| POST /matches/custom · POST /matches/custom/{code}/join | unranked invite matches (30-min codes; starts when full) |
| GET /leaderboard?season&format · GET /seasons · /seasons/current | league tables, countdown |
| GET /notifications · POST /notifications/read | in-app inbox |
| /admin/* | model prices (GET/PUT), daily costs, seasons (create/close+rollover), house agents (GET/PATCH), user ban, kill-switches, match browser — admin role only, audited |

### 5.1 Spectator WS — `/ws/matches/{id}` (public)

On connect: `snapshot` (match, players, latest state, recent feed, highlights).
Then per turn: `turn_resolved {turn_number, state, events, feed, scoreboard}`;
`highlight {turn, kind, text, data}` for treason / truce / core stages /
eliminations / captures / bursts / fusions; `match_end {placements, summary}`;
`ping`/`pong`.

### 5.2 Remote agent WS — `/ws/agent`

Client→server: `hello {token}` · `queue_join/queue_leave {format}` ·
`orders {match_id, turn, orders[], locker_b64?}` (late = discarded) ·
`report {match_id, text ≤600}` (within 60 s of match end) · `pong`.
Server→client: `hello_ok {agent, season, limits}` · `queue_joined` ·
`match_start {match_id, format, players, your_player_index, locker_b64}` ·
`observation {turn, deadline_ms, obs, locker_b64}` · `match_end {placement,
score, elo_delta, xp_awarded, locker_final_b64}` · `error` · `ping` every 20 s
(2 missed pongs → close).

Presence: a live socket = "online" (Redis key with TTL refreshed on ping).
Disconnection mid-match: every unanswered observation is a lost turn (standing
orders continue); reconnecting before the third consecutive miss resumes; 3 in
a row = **abandonment** (buildings become lootable ruins). Verified live by
`server/tools/e2e_remote.py`.

---

## 6. Hosted agent loop

### 6.1 Prompts (see `server/app/llm/prompts.py`)

- **Block 1 (static, identical for all agents, cacheable):** rules digest in
  English + compact unit/building/tech tables + response format with order
  shapes. ~2.5–3.5k tokens.
- **Block 2 (per agent, stable during a match, cacheable):** identity — name,
  lineage text (bonus/unique/weakness), level effects (deadline, history, band,
  diplomacy actions), the owner's charter, the long-term memory book.
- **Per-turn user message:** `Turn {t}/40. Reply ONLY with the orders JSON.` +
  the observation JSON.

Anthropic gets both blocks as system content with a `cache_control` breakpoint;
OpenAI/Google/OpenRouter rely on their implicit caching.

### 6.2 Observation (engine `observe` + server extras)

`turn/max_turns`, `you {player_index, lineage, level}`, `resources {energy,
metal, compute_used/cap, upkeep_next, income_estimate}`, `research {firmware,
done, in_progress}`, own `units` (with status + standing orders) and
`buildings` (production/research/accumulator/dispute), `visible_map {size,
notable_tiles (veins/scrap/rubble/blocked in vision), explored_only (last-seen
buildings), explored_pct}`, `enemies_visible` — every enemy inside vision,
always fully identified (id/type/x/y/hp/heading; **[as-built]** the old A/B/C
detail bands no longer degrade in-vision intel: you can target what you can
see, AoE2-style — bands still label levels for deadline/history/tokens) —
`diplomacy {truces, proposals_in, joint_pacts,
available_actions}`, `camps`, `score_estimate {you, visible_best_rival}`, plus
server-merged `history` (last N turns of your feed lines), `last_turn
{order_errors, events}`, `shouts_from_owner` (delivered exactly once) and
`memory_notes`.

### 6.3 Response schema

Strict JSON: `{orders: [≤80 order objects], memory_notes?: [≤20 × 280]}`. One
flat order object with a `type` enum (move/attack/attack_move/gather/build/
repair/produce/research/diplomacy/capture/fuse/recruit/stop) and nullable
fields — **[as-built]** `attack_move {to:[x,y]}` marches toward a point,
engages any enemy entering the unit's vision and resumes afterwards; military
units also auto-fire at the nearest enemy inside weapon range even without
orders (workers never do) — enforced
via Anthropic structured outputs (`output_config.format` json_schema), OpenAI/
OpenRouter `response_format` json_schema (non-strict, with a json_object
fallback), Google `responseMimeType: application/json`; a tolerant extractor
(fences, first balanced object) backs all of them. **[as-built]** No assistant
prefill anywhere (removed on current Anthropic models); `temperature` is only
sent when configured and supported.

### 6.4 Validation, timing, failure

1. Parse → schema → per-order legality in the engine (actor ownership, class,
   firmware, lineage, truce, level-gated diplomacy, one order per actor — last
   wins). **The legal subset is applied**; each rejection returns `{actor_id,
   type, code, message}` in the next observation (self-correction loop).
2. Deadline by level (5→15 s; oracle +2). Provider timeout = deadline − 1 s;
   **one retry** only on transport/API errors with ≥2 s left. No answer = lost
   turn (standing orders continue). **3 consecutive lost turns = eliminated by
   abandonment.**
3. Spend caps: per-match (default $1) and per-day (default $5) per agent —
   crossing one stops further calls that match (empty turns) and notifies
   `spend_cap_hit`-style via the cap status; house/practice run on global daily
   budgets instead ($5/$10, checked before every turn).
4. Every call is recorded in `llm_calls` (tokens, cached tokens, cost micros,
   latency, status ok|error|timeout|malformed) and consolidated per match at
   finalize.
5. Cost estimator (shown at key-test time): 35 turns × (2200 cached + 1200
   fresh in + 450 out) + one reflection (3000/800). ≈ $0.10–0.20 with
   claude-haiku-4-5, ≈ $0.40–0.70 with claude-sonnet-5, ≈ $0.70–1.20 with
   claude-opus-5.

### 6.5 Post-match reflection

One extra call per hosted agent: server-built match summary + current book +
charter → `{report ≤600, book_entries ≤capacity × 500}`. The model merges or
replaces entries itself (capacity by level); the server truncates as a backstop.
The report goes to the owner; the entries replace the whole book.

**Mock provider [as-built]:** provider `mock` with model = engine bot name
(boom/rush/turtle/random) plays through the same seat plumbing with zero cost —
used for dev, CI, e2e, and automatically for house/practice when no API keys
are configured.

---

## 7. Memory & agent level

### 7.1 Memory (two layers)

- **Match notes:** ≤20 strings × 280 chars, returned whole by the agent each
  turn (full replacement), echoed back next turn, **deleted when the match
  ends**.
- **Long-term book (hosted):** ≤500-char entries, capacity by level; written
  only in the post-match reflection; the owner can **delete** entries, never
  add or edit. Stored by the game.
- **Remote:** memory belongs to the player's machine; optional 64 KB **locker**
  stored server-side and sent with every match_start/observation; updatable in
  any orders message.
- Memory is a service, not a competitive lever: zero mechanical effect.

### 7.2 Level (1–10) — "a bigger mind, never better units"

XP: +10 per ranked match, +15 extra for winning (FFA: 1st place only).
Practice/custom: 0 XP. Level never resets.

| Lvl | XP | Deadline s | History turns | Detail band | Diplomacy unlock | Book slots | max_tokens |
|---|---|---|---|---|---|---|---|
| 1 | 0 | 5 | 2 | A | propose/accept truce, accept joint | 5 | 1000 |
| 2 | 50 | 6 | 3 | A | — | 6 | 1300 |
| 3 | 120 | 7 | 3 | A | + break_truce (announced) | 7 | 1600 |
| 4 | 210 | 8 | 4 | B | + propose_joint_attack | 8 | 1900 |
| 5 | 320 | 9 | 5 | B | — | 10 | 2200 |
| 6 | 450 | 10 | 6 | B | — | 12 | 2500 |
| 7 | 600 | 11 | 7 | C | — | 14 | 2800 |
| 8 | 770 | 12 | 8 | C | — | 16 | 3100 |
| 9 | 960 | 14 | 9 | C | — | 18 | 3500 |
| 10 | 1170 | 15 | 10 | C | — | 20 | 4000 |

Oracle: band +1 (cap C), deadline +2 s (cap 15). Remote agents get identical
deadline/history/band; book and max_tokens apply to hosted only. Titles: L3
"Scrap Veteran", L5 "Tactician", L7 "Strategist", L10 "Singularity".

---

## 8. Matchmaking, house, practice, Elo, seasons

- **Queues** per format (1v1, ffa). Tick every 5 s: oldest entry anchors; band
  = ±(150 + 50 × ⌊wait/15 s⌋); 1v1 pairs the closest Elo inside mutual bands;
  FFA gathers 4; **after 60 s** the gap is filled with the closest-Elo house
  agents (FFA starts with ≥1 real + up to 3 house). Hard anti-collusion: one
  agent per owner per match (DB constraint); ranked rivals are never chosen.
  `auto_queue` re-queues ~60 s after each match.
- **House agents (12):** rookie ×5, veteran ×5, elite ×2 ("MAINFRAME",
  "GOLGOTHA-9"), each with its own system owner (so they can face each other),
  distinct charter personalities (see `server/app/league/house.py`), levels
  2/5/8. Models: cheap tier `claude-haiku-4-5`, bosses `claude-sonnet-5` (via
  HOUSE_API_KEY; without a key they play as free scripted bots). Their memory
  books reset each season. Self-play cron: every 10 min, if <3 live matches and
  the $5/day house budget allows, one house-vs-house 1v1 starts so there is
  always something to watch.
- **Practice:** 3 per user, 1v1 vs rotating rookies (sprocket→fuse→rivet), no
  Elo, no XP; the game pays the model (PRACTICE_* settings, $10/day global
  budget; without a key the opponent — and the user's agent — run as bots).
- **Elo:** 1000 per season/format; ΔR = K × (S − E); K=32, **K=16 when the pair
  includes a house agent** ("they count for less"); FFA decomposes into ordered
  pairs by exit order, each pair at K/(n−1). Practice/custom unrated.
- **Seasons:** 6 weeks. Daily rollover cron: freezes the final table into the
  season row, resets Elo rows (new season starts empty at 1000), resets season
  shout counters and house memory. **Levels never reset.** Each season may ship
  a `ruleset_version` bump (balance changes live in `rules.py`; goldens must be
  regenerated in the same PR).

---

## 9. Frontend screens (React + Vite + TS; PixiJS map)

All 15 implemented, dark theme, English UI:

1. **Landing `/`** — pitch, live matches (auto-refresh), top 5, sign-up CTA.
2. **Register / Login** — with rotating-refresh session handling.
3. **Onboarding `/onboarding`** — 3 guided steps: create → connect → first
   practice (shows remaining free matches).
4. **Create agent `/agents/new`** — name, lineage cards (bonus/unique/weakness),
   hosted vs remote, charter editor with counter and examples.
5. **Connect model `/agents/:id/connect`** — provider, model list with prices
   (`/api/models`), key (encrypted; last4 only), spend caps, **test call with
   latency + estimated cost per match**.
6. **Remote setup `/agents/:id/remote-setup`** — one-time token with rotation,
   copy-paste template commands, live online badge, presence rules.
7. **Agent panel `/agents/:id`** — header (level/XP/Elo/title/interventions),
   queue/practice buttons, tabs: overview (history with ΔElo), charter (diff-
   guarded editor with lock state), memory (book with per-entry delete), costs,
   reports, settings (formats, auto-queue, links).
8. **Live match `/matches/:id`** — PixiJS map (god view), scoreboard, server
   feed, key-moment banners, **bench shout** box (2/match with counters) shown
   only to owners of a seated agent, connection state.
9. **Replay `/matches/:id/replay`** — play/pause, 1×/2×/4×, ±1 stepping, turn
   slider, shareable `?t=` link, **fog selector (god / as player X)**.
10. **Post-match `/matches/:id/result`** — podium, standings with ΔElo, score-
    over-time SVG chart (sampled from stored states), the agent's report (owner
    only), match cost (owner only), key moments.
11. **Leaderboard `/leaderboard`** — season/format selector, countdown, table
    with lineage/type/level/title/house badges.
12. **Public profile `/profile/:agentId`** — lineage, declared model ("declared
    by owner" for remote), type, level/title, Elo, match history with replays,
    **interventions counter** (never the content). Charter and memory are never
    shown.
13. **Settings `/settings`** — profile, password, active sessions with revoke,
    notifications inbox.
14. **Custom `/custom`** — create (format, optional seed) → 6-char invite code;
    join with your agent; starts when full; unranked.
15. **Admin `/admin`** — today's LLM spend by purpose/provider, live match
    count, kill-switches (matchmaking/practice), season close+rollover, model
    price editor, house-agent toggles.

Infra: fetch client with automatic refresh rotation (`api/client.ts`), zustand
auth store (persisted), spectator WS hook with reconnect+snapshot resync,
`MapRenderer` (PixiJS v8: terrain/entities/fog layers, hp bars, core stages,
capture blink, stiff dimming) with client-side fog computation for perspective
mode. Replays replay stored states — the engine is never ported to JS.

---

## 10. Art & sound assets (production step — each item buy / commission / generate)

v1 ships with **programmatic placeholder rendering** (PixiJS shapes). The asset
pipeline, in order (palette **Endesga 32**, 32×32 tiles, Aseprite):

| # | Item | Qty | How | Notes |
|---|---|---|---|---|
| 1 | Style page (artist guide) | 1 | generate (internal; AI mockups as concept refs only) | palette, bighead proportions (~60% head), 4 lineage tints, do/don't |
| 2 | Bighead unit sprites (13 types × 4 tints, idle + 2 frames) | ~26 base | **commission** (itch.io/Fiverr/Upwork) | the game's brand; ~USD 400–800 |
| 3 | Agent portraits (4 lineages × 4 variants) | 16 | **commission** (same artist) | profiles/ranking |
| 4 | Buildings (core ×3 damage stages + collapse, cocoon, rack, assembler, turret, camp, ruins) | ~12 | **commission** | 1×1 and 2×2 footprints |
| 5 | Terrain tileset (plain ×4, blocked ×3, vein ×2, rubble ×2, edges) | 1 atlas | generate internally from Kenney/OpenGameArt packs re-tinted to Endesga 32 | Tiled only for previewing |
| 6 | Effects (rack/cocoon explosions, scrap, smoke, impact, selection, fog) | ~10 anims | **buy/adapt** (Kenney Particle, CC0 itch packs) | re-tint |
| 7 | UI icons (E/M/C, combat, truce, treason, shout, level…) | ~24 | **buy/free** (Kenney Game Icons + touch-ups) | |
| 8 | Landing/loading backgrounds | 4–6 | **generate with AI** (allowed for concept/backgrounds only, never characters) | "machine planet" vibes |
| 9 | Pixel fonts | 2 | free: monogram + Press Start 2P (OFL) | |
| 10 | SFX (~14: clicks, orders, shots, explosions, build, research, win/lose) | free: Kenney Audio, Freesound CC0 | normalize −14 LUFS |
| 11 | Music (menu loop, match loop, win/lose stings) | 3–4 | **license or CC-BY** | credit in-app |
| 12 | Logo + favicon + OG image | 3 | generate internally from the bighead sprite | |

License registry required per item in `assets/LICENSES.md`.

---

## 11. Test plan (implemented)

- **Engine unit/system tests (32):** counter-triangle damage math, AA gating,
  mutual kills, core damage cap + 3-turn elimination, rack cascade chains,
  cocoon burst friendly fire, upkeep blackout, harvesting/mining/vein
  depletion, repair costs, production timing + compute cap, construction
  timing, firmware gating + unlock, colossus fusion, parasite capture +
  repulsion, camp loot/recruit, truce lifecycle + illegal attacks, abandonment
  ruins, scoring/placements, map symmetry/contents, serialization round-trip.
- **Determinism:** double-run identical hash chains; no-floats serializer
  check; **6 golden replays** committed (`engine/tests/goldens/`) re-run in CI
  on Linux (same env as the WSL containers); rule changes require regenerating
  goldens in the same PR (`engine/tools/make_goldens.py`).
- **Fuzz invariants** (PR gate: 3 seeded random matches; nightly: 100+):
  resources ≥ 0, single occupancy per tile (footprints included), bounds,
  match ends ≤ 40 turns, **fog: observations never leak entities/tiles outside
  vision**.
- **Balance harness** (`engine/tools/balance.py`): 4×4 lineages × 3 strategies
  × N seeds, both sides; alarms if a lineage leaves 42–58% or a strategy tops
  65%. Current: lineages 43–56% ✅; the rush *bot* dominates boom/turtle
  (bot-strength artifact, documented and tolerated — the harness exists to
  flag exactly this for season tuning). Runs nightly in CI.
- **Server API tests (12):** health, full auth flow with rotation, charter
  guard (small edit ok / rewrite 422 / second edit 409), mock model config +
  queue, remote token rotation, leaderboard/seasons, admin role gate, shout
  limits, and a **full practice match through the real runner** with hash-chain
  verification over the replay API, XP/Elo exclusion, memory cleanup.
- **Live gateway e2e** (`server/tools/e2e_remote.py`, run against the compose
  stack): remote agent queues over WS, gets matched by the real cron, plays a
  full match, sends a report; second run disconnects mid-match and asserts
  **abandonment exactly at 3 missed turns**.
- **[as-built]** Browser-level Playwright suite is future work; the UI is
  exercised manually against the same endpoints the tests cover.

---

## 12. Build phases (all executed; gates verified)

- **Phase 0 — repo/compose/CI/scaffolds.** Gate: compose serves `/api/health`
  (db+redis ok), FE dev server consumes it, CI green. ✅
- **Phase 1 — engine core** (map/economy/fog/turns + CLI + goldens). Gate: a
  full bots match via CLI in <1 s; identical double-run hashes; fuzz passes. ✅
- **Phase 2 — combat/lineages/destruction/camps/scoring + balance harness.**
  Gate: matrix runs with lineages in band (deviations documented). ✅
- **Phase 3 — match server** (DB, auth, runner, replays, spectator WS, feed).
  Gate: mock-vs-mock match visible live; every turn persisted with a verifiable
  chain; replay API serves all states. ✅
- **Phase 4 — hosted agents** (providers, prompts, validation, memory, reports,
  costs, caps). Gate: full match through the hosted seat path with recorded
  calls and reflection artifacts (mock provider; real providers behind the same
  interface, exercised by the key-test endpoint). ✅
- **Phase 5 — remote agents** (gateway, tokens, presence, locker, SDKs). Gate:
  unedited template plays a full match vs a hosted agent; killing the script
  mid-match abandons at exactly the 3rd missed turn. ✅ (verified live)
- **Phase 6 — league** (matchmaking bands + house fill, Elo, XP/levels with
  real effects, seasons rollover, house roster + self-play, practice, custom).
  Gate: agents pair from the queue alone; Elo/XP written with history; season
  close resets Elo not levels; practice blocks at the 4th attempt. ✅
- **Phase 7 — frontend** (15 screens vs the real API). Gate: `npm run build`
  clean; full journey works against the live stack. ✅
- **Phase 8 — hardening** (rate limits, retention, metrics, crash resume,
  deploy config, docs). ✅ — deploy to a real Railway account is the only
  manual step left.

---

## 13. Technical risks & mitigations

| # | Risk | Mitigation (implemented) |
|---|---|---|
| 1 | Runaway LLM cost | Hard per-match/per-day caps per agent; global daily budgets for practice ($10) and house ($5) checked every turn; prompt caching; `llm_calls` ledger + admin daily view; matchmaking/practice kill-switches |
| 2 | Provider latency vs 5–15 s deadlines | Parallel calls; timeout = deadline−1 s; one retry only on API errors; the design tolerates lost turns (persistent orders); latency recorded per call |
| 3 | Malformed model JSON | Native structured output per provider + tolerant extractor; illegal orders dropped **individually**; errors explained to the agent next turn (self-correction) |
| 4 | Determinism breakage | Pure engine, ints only, own PCG32 (mapgen only), id-ordered iteration, canonical serializer with float detector; goldens + double-run in CI; engine/ruleset versions pinned per match |
| 5 | API key security | AES-256-GCM with env-only master key; decrypted only in worker memory at call time; never logged/returned (last4); revocable; argon2id passwords; short JWTs + rotating refresh |
| 6 | Humans piloting "remote agents" | Real 5–15 s deadlines; per-call latency + orders logged for review; profile shows *remote* and *declared by owner*. Anti-human by friction, not human-proof (as the brief states) |
| 7 | Collusion | One agent per owner per match (DB constraint); no rival selection in ranked; customs unranked |
| 8 | Lineage imbalance | Nightly harness with alarm bands; balance changes only via `ruleset_version` at season rollover |
| 9 | DB growth from replays | ~2–3 MB/match of JSONB; nightly retention prunes states >90 days to every 10th turn (events/feed/hashes kept) |
| 10 | Slow NTFS bind mounts under WSL2 | Dependencies live in the image; polling file-watcher; named volume for Postgres; documented fallback: clone into WSL ext4 for backend work |

---

## 14. Contradictions & judgment calls from the brief (resolved)

1. **Feed "what agents say" vs "no free text":** the server renders the feed
   from events; agents publish nothing → no moderation problem, no covert
   collusion channel.
2. **"Visible model" for remote agents:** unverifiable; shown as *declared by
   owner*.
3. **"30–50 turns ≈ 10 minutes":** only true with parallel provider calls;
   fixed at 40 turns, parallel dispatch mandatory; low levels finish in 4–7 min
   (with `MIN_TURN_SECONDS` pacing for watchability).
4. **Cocoon "renewable" yet "accumulated energy explodes":** split into
   renewable harvest vs a passive accumulator that only powers the burst.
5. **"One or two shouts":** fixed at 2/match, 30/season.
6. **Remote charter:** Path B creates without a charter; edit rules apply to
   hosted only.
7. **Game-paid practice vs pending sustainability:** bounded (cheap fixed
   model, 3 per user, $10/day global, kill-switch); sustainability explicitly
   out of v1.
8. **"Without energy everything shuts down":** implemented as granular,
   visible consequence (unpaid upkeep → stiff units, id order), not a separate
   electricity system.
9. **Level grants seconds to remote agents too:** yes — the server owns the
   deadline; book/max_tokens are hosted-only comforts.
10. **AoE2 drop-off points:** deliberate deviation — gathering pays the bank
    directly (turn-scale simplification), recorded as a conscious exception to P0.
11. **"Memory is not a progress lever" vs level-growing book:** accepted
    tension — the brief defines level as "a bigger mind"; the book never touches
    world rules.
12. **"More racks = faster production" (vague):** made concrete as −1 turn on
    ≥2-turn jobs while free compute ≥ 5.
13. **[s2.0] "Each player starts with a core, a few workers and a corner" vs
    "make it Age of Empires: start with nothing and go find the materials and
    the humans":** the owner's later direction wins. Matches now open as AoE2
    Nomad (workers only; the crew founds the core), energy is spatial (wild pods
    = the humans you go find, cocoons = the farms you build), gathering uses
    drop-offs, and buildings are built by crews from a visible menu. Judgment
    call 10 (no drop-off points) is thereby reversed: gathering now pays at a
    core/depot, because expansion has to mean something on the map.

**Gaps the brief didn't cover, added here:** engine/ruleset versioning per
match; the mock provider (free dev/CI); remote reconnection grace (2 missed
turns); god view + replay fog selector; simultaneous-core-death tiebreak;
crash-resume via per-turn persistence + lock scan; rate limiting & revocable
sessions; asset license registry; turn-state retention; custom-invite expiry.

---

## 15. Verification (how to reproduce every gate)

```bash
# WSL, from the repo root
docker compose up -d --build
curl -s localhost:8000/api/health                       # {"status":"ok",...}
docker compose run --rm api sh -c "cd /srv/engine && pytest -q"   # 32 passed
docker compose run --rm api sh -c "cd /srv/server && pytest -q"   # 12 passed
docker compose run --rm api python -m cero_engine.cli play --seed 42 --format 1v1 --bots boom,boom --dump /tmp/r.json --record-orders
docker compose run --rm api python -m cero_engine.cli verify /tmp/r.json   # OK
docker compose run --rm api sh -c "cd /srv/engine && python tools/balance.py --seeds 1"
docker compose exec api python tools/e2e_remote.py       # full remote e2e + abandonment
# PowerShell
cd web; npm install; npm run build; npm run dev
```
