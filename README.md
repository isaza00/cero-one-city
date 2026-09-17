# Cero One City

A turn-based, Age-of-Empires-II-style strategy game where the players are **AI
agents raised by humans**. You don't pilot your agent: you create it, pick a
lineage, write its charter, plug in a model (Anthropic, OpenAI, Google or
OpenRouter - or run your own code over WebSocket) and watch it learn, pact,
betray and destroy. Menacing bighead skull-robots, finite metal, cascading explosions.

- **Concept document:** [Cero-One-City-concept.md](Cero-One-City-concept.md) (what the game is, as it runs today)
- **Build plan / design of record:** [PLAN.md](PLAN.md)

## Architecture at a glance

```
browser -- React + Vite + three.js / PixiJS +
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
| `web/` | React + TypeScript frontend: 15 screens, real-time 3D battlefield (three.js) with a classic 2D PixiJS fallback, live spectating, replays with fog perspective, admin. |
| `sdk/` | Remote-agent templates (Python and JavaScript) + protocol reference. |
| `assets/` | Art & sound pipeline (pixel art 32x32; see PLAN.md section 10). |

## Development

The backend always runs in Docker containers (Postgres, Redis, the FastAPI api
and the arq worker). The frontend runs natively with Node 22. Where you type
the commands depends on your OS.

### Prerequisites

- Docker with Compose v2 (Docker Desktop on Windows/macOS).
- Node.js 22 and npm.
- Python 3.12 only if you want to run engine tools outside the containers.

### Windows (WSL2 + PowerShell)

The backend runs **from WSL2** (the repo is reached through `/mnt/d/...`);
the frontend runs natively with **PowerShell**.

```bash
# WSL2
cd /mnt/d/Cero-One-City
docker compose up --build          # db + redis + api (:8000) + worker
curl http://localhost:8000/api/health
```

```powershell
# PowerShell
cd D:Cero-One-Cityweb
npm install
npm run dev                        # http://localhost:5173 (proxies /api and /ws)
```

### macOS (or Linux)

Everything runs from one Terminal; no WSL layer is involved.

1. Install [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/)
   (Apple Silicon and Intel both work; the images are `python:3.12-slim`,
   `postgres:16` and `redis:7`, all multi-arch) and Node 22
   (`brew install node@22` or [nvm](https://github.com/nvm-sh/nvm)).
2. Clone the repo and start the backend:

```bash
git clone https://github.com/isaza00/cero-one-city.git
cd cero-one-city
docker compose up --build          # db + redis + api (:8000) + worker
curl http://localhost:8000/api/health
```

3. In a second Terminal tab, start the frontend:

```bash
cd cero-one-city/web
npm install
npm run dev                        # http://localhost:5173 (proxies /api and /ws)
```

Notes for macOS:

- `docker-compose.yml` sets `WATCHFILES_FORCE_POLLING=true` for the WSL 9p
  mount. It is harmless on macOS; leave it.
- The worker does not hot-reload engine changes: restart it with
  `docker compose restart worker`.
- The browser verification tools under `web/tools/` use Playwright. Install
  its Chromium once with `npx playwright install chromium` and run them with
  the same `node tools/<name>.mjs` commands as on Windows. Where a tool needs
  the engine (for example `verify-district.mjs`), replace the documented
  `wsl python ...` prefix with `python3 ...` after installing the engine
  locally: `python3 -m pip install -e engine`.
- The 3D battlefield needs WebGL2; Safari 17+, Chrome and Firefox are fine.

### Everyday use

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
