# Cero One City

A turn-based, Age-of-Empires-II-style strategy game where the players are **AI
agents raised by humans**. You don't pilot your agent: you create it, pick a
lineage, write its charter, plug in a model (Anthropic, OpenAI, Google or
OpenRouter - or run your own code over WebSocket) and watch it learn, pact,
betray and destroy. Menacing bighead skull-robots, finite metal, cascading explosions.

- **Concept document:** `Cero-One-City-concepto.docx` (Spanish, original brief)
- **Build plan / design of record:** [PLAN.md](PLAN.md)

## Architecture at a glance

```
browser -- React + Vite + PixiJS ----+
                REST + WS            v
        FastAPI api ---- Postgres 16 (state, turns, league, costs)
              |     +--- Redis 7 (arq jobs, pub/sub, presence)
        arq worker -- match loop -- deterministic pure-Python engine
              +--- LLM providers (Anthropic/OpenAI/Google/OpenRouter/mock)
remote agents -- WebSocket gateway (token auth, presence, deadlines)
```

| Directory | What it is |
|---|---|
| `engine/` | Pure deterministic game engine: integers only, PCG32 only in mapgen, WEGO turn resolution, fog, scoring. No framework imports. |
| `server/` | FastAPI (REST + spectator WS + remote-agent gateway) and the arq worker (match runner, matchmaking, seasons, house agents, retention). |
| `web/` | React + TypeScript + PixiJS frontend: 15 screens, live spectating, replays with fog perspective, admin. |
| `sdk/` | Remote-agent templates (Python and JavaScript) + protocol reference. |
| `assets/` | Art & sound pipeline (pixel art 32x32; see PLAN.md section 10). |

## Development

The backend runs in containers **from WSL2**; the frontend runs natively on
Windows with **PowerShell**.

```bash
# WSL2
cd /mnt/d/Cero-One-City
docker compose up --build          # db + redis + api (:8000) + worker
curl http://localhost:8000/api/health
```

```powershell
# PowerShell
cd D:\Cero-One-City\web
npm install
npm run dev                        # http://localhost:5173 (proxies /api and /ws)
```

Log in as the seeded dev admin (`admin@cero-one.city` / `admin-dev-password`) or
register a user - new users get 3 free practice matches against the house
(without provider API keys configured, house/practice agents play as free
scripted bots, so everything works offline).

### Tests

```bash
docker compose run --rm api sh -c "cd /srv/engine && pytest -q"     # 53 tests
node assets/tools/gen_buildings.mjs                                  # regenerate building sprites (plain Node)
docker compose run --rm api sh -c "cd /srv/server && pytest -q"     # 12 tests
docker compose exec api python tools/e2e_remote.py                  # live remote-agent e2e
docker compose run --rm api python -m cero_engine.cli play --seed 42 --format 1v1 --bots rush,boom
docker compose run --rm api sh -c "cd /srv/engine && python tools/balance.py --seeds 2"
```

Determinism is enforced by golden replays (`engine/tests/goldens/`), a
double-run hash-chain test, a no-floats serializer check and fuzz invariants -
all in CI on Linux (the same environment as the WSL containers). If you change
rules, regenerate goldens in the same PR: `python engine/tools/make_goldens.py`.

## Deployment

`Dockerfile.prod` builds a single image (engine + server + built frontend) -
see `railway.toml` for the two-service (api + worker) Railway setup with
managed Postgres and Redis, required environment variables included.

## The game in one breath

It is Age of Empires II with robots (ruleset **s2.0**, the full mapping is in
[docs/AOE2-ANALYSIS.md](docs/AOE2-ANALYSIS.md)). You start as **nomads**: four
workers, one striker, no buildings. Your crew founds a **core** (the town
center), harvests the wild **pods** around it (dormant humans in capsules: the
game's berries) and mines the metal vein, carrying every load to the core or to
a **depot** you build by far resources. Energy trains workers and feeds the army,
metal builds everything: **cocoons** (farms), **racks** (houses, +compute),
**assembler** (barracks), **lab** (blacksmith), **turrets** and **walls**. Any
number of workers build a foundation together. Firmware v1 -> v2 -> v3 are the
ages (each gated by buildings) and unlock strikers -> launchers/riders/wasps/
turrets/a second core -> walking towers, drone swarms and the five-striker
colossus. Five lineages, 14 techs, structured diplomacy with no free text, camps
of human survivors to loot or recruit, and a city that dies with its last core.
Win by elimination or on points at turn 80. Every observation carries the
build/train/research **menus** with costs and lock reasons, so an agent always
sees what it can build. Full numbers: [PLAN.md](PLAN.md) section 3.
