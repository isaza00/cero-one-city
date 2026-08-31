"""FastAPI application: REST + WebSockets + static frontend in production."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import redis.asyncio as aioredis
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select, text

from app.db.session import engine, init_db, session_factory
from app.routers import admin as admin_router
from app.routers import agents as agents_router
from app.routers import auth as auth_router
from app.routers import league as league_router
from app.routers import matches as matches_router
from app.settings import get_settings
from app.ws import agent_gateway, spectator
from cero_engine import ENGINE_VERSION
from cero_engine.rules import RULESET_VERSION

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cero.api")


async def _seed() -> None:
    from app.auth.security import hash_password
    from app.db.models import User
    from app.league.house import seed_house
    from app.league.seasons import current_season
    from app.llm.costs import seed_model_prices
    settings = get_settings()
    async with session_factory()() as db:
        await seed_model_prices(db)
        await seed_house(db)
        await current_season(db)
        admin = (await db.execute(select(User).where(
            User.email == settings.admin_email))).scalar_one_or_none()
        if admin is None:
            db.add(User(email=settings.admin_email,
                        password_hash=hash_password(settings.admin_password),
                        display_name="Admin", role="admin", practice_remaining=0))
            await db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_db()
    await _seed()
    app.state.redis = aioredis.from_url(get_settings().redis_url)
    yield
    await app.state.redis.aclose()
    await engine().dispose()


app = FastAPI(title="Cero One City", lifespan=lifespan)

from app.ratelimit import rate_limit_middleware  # noqa: E402

app.middleware("http")(rate_limit_middleware)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500,
                        content={"error": {"code": "internal",
                                           "message": "internal server error"}})


@app.get("/api/health")
async def health() -> dict:
    db_ok, redis_ok = False, False
    try:
        async with engine().connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        pass
    try:
        redis_ok = bool(await app.state.redis.ping())
    except Exception:
        pass
    return {"status": "ok" if (db_ok and redis_ok) else "degraded",
            "db": db_ok, "redis": redis_ok,
            "engine_version": ENGINE_VERSION, "ruleset_version": RULESET_VERSION}


@app.get("/api/metrics")
async def metrics() -> dict:
    """Small operational counters (protected by obscurity in dev; behind admin in prod)."""
    from sqlalchemy import func

    from app.db.models import LlmCall, Match
    async with session_factory()() as db:
        live = (await db.execute(select(func.count(Match.id)).where(
            Match.status == "live"))).scalar_one()
        calls_today = (await db.execute(select(func.count(LlmCall.id)))).scalar_one()
    return {"live_matches": int(live), "llm_calls_total": int(calls_today)}


app.include_router(auth_router.router)
app.include_router(agents_router.router)
app.include_router(matches_router.router)
app.include_router(league_router.router)
app.include_router(admin_router.router)
app.include_router(spectator.router)
app.include_router(agent_gateway.router)

# Production: serve the built frontend from the same origin (no CORS needed).
_dist = os.environ.get("WEB_DIST", "/srv/web/dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="web")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"],
                       allow_methods=["*"], allow_headers=["*"])
