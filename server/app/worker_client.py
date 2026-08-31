"""Enqueue arq jobs from the API process."""

from __future__ import annotations

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.settings import get_settings

_pool: ArqRedis | None = None


async def pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    return _pool


async def enqueue(job: str, *args) -> None:
    await (await pool()).enqueue_job(job, *args)
