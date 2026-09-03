"""Async engine/session plumbing. Schema is applied with create_all at startup
(idempotent); Alembic can take over once the schema starts evolving in prod."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.settings import get_settings

_engine = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def engine():
    global _engine
    if _engine is None:
        _engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
    return _engine


def session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(engine(), expire_on_commit=False)
    return _session_factory


async def init_db() -> None:
    from app.db.models import Base
    async with engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all never alters existing tables: columns added after a table
        # first shipped are applied here, idempotently (Postgres).
        from sqlalchemy import text
        await conn.execute(text("ALTER TABLE shouts ADD COLUMN IF NOT EXISTS reply_text VARCHAR(400)"))
        await conn.execute(text("ALTER TABLE shouts ADD COLUMN IF NOT EXISTS reply_turn INTEGER"))


async def get_db() -> AsyncIterator[AsyncSession]:
    async with session_factory()() as session:
        yield session
