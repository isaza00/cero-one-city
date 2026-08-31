"""Server test fixtures: real Postgres + Redis from compose, isolated via a
schema reset per session, exercised through the ASGI transport (no sockets)."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="session")
async def app(anyio_backend):
    from app.db.models import Base
    from app.db.session import engine
    from app.main import app as fastapi_app
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
