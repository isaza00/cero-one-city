"""Server test fixtures: real Postgres + Redis from compose, isolated via a
schema reset per session, exercised through the ASGI transport (no sockets)."""

from __future__ import annotations

import os
from urllib.parse import urlsplit, urlunsplit

import pytest
from httpx import ASGITransport, AsyncClient


def _isolate_from_live_stack() -> None:
    """Point the suite at <db>_test and Redis db 1 BEFORE the app reads its
    settings. The suite drops every table at start: it must never touch the
    database (or the worker's queue) of the running stack."""
    from app.settings import Settings
    defaults = Settings()
    db_url = os.environ.get("DATABASE_URL", defaults.database_url)
    parts = urlsplit(db_url)
    name = parts.path.lstrip("/")
    if not name.endswith("_test"):
        os.environ["DATABASE_URL"] = urlunsplit(parts._replace(path=f"/{name}_test"))
    os.environ["TEST_DATABASE_TEMPLATE_URL"] = db_url
    redis_url = os.environ.get("REDIS_URL", defaults.redis_url)
    parts = urlsplit(redis_url)
    if parts.path in ("", "/", "/0"):
        os.environ["REDIS_URL"] = urlunsplit(parts._replace(path="/1"))


_isolate_from_live_stack()


async def _ensure_test_database() -> None:
    """CREATE DATABASE <name>_test if missing (connecting to the live one)."""
    import asyncpg
    from app.settings import get_settings
    test_url = get_settings().database_url
    name = urlsplit(test_url).path.lstrip("/")
    assert name.endswith("_test"), f"refusing to reset a non-test database: {name}"
    template = os.environ["TEST_DATABASE_TEMPLATE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(template)
    try:
        if not await conn.fetchval("select 1 from pg_database where datname = $1", name):
            await conn.execute(f'create database "{name}"')
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="session")
async def app(anyio_backend):
    from app.db.models import Base
    from app.db.session import engine
    from app.main import app as fastapi_app
    await _ensure_test_database()
    async with engine().begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with fastapi_app.router.lifespan_context(fastapi_app):
        yield fastapi_app


@pytest.fixture()
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture()
async def user_client(client):
    """A registered, authenticated client."""
    import secrets
    email = f"tester-{secrets.token_hex(4)}@example.com"
    r = await client.post("/api/auth/register", json={
        "email": email, "password": "password123", "display_name": "Tester"})
    assert r.status_code == 200, r.text
    data = r.json()
    client.headers["authorization"] = f"Bearer {data['access_token']}"
    client.refresh_token = data["refresh_token"]
    client.user = data["user"]
    return client
