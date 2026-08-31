"""Small in-memory rate limiter middleware (per instance, per IP).

Auth endpoints: 5/min. Everything else under /api: 120/min. Good enough for v1
on a single api instance; swap for a Redis limiter when scaling out.
"""

from __future__ import annotations

import time

from fastapi import Request
from fastapi.responses import JSONResponse

_WINDOW = 60.0
_buckets: dict[tuple[str, str], list[float]] = {}


def _allow(key: tuple[str, str], limit: int) -> bool:
    now = time.monotonic()
    bucket = _buckets.setdefault(key, [])
    while bucket and now - bucket[0] > _WINDOW:
        bucket.pop(0)
    if len(bucket) >= limit:
        return False
    bucket.append(now)
    if len(_buckets) > 20_000:  # crude memory guard
        _buckets.clear()
    return True


async def rate_limit_middleware(request: Request, call_next):
    from app.settings import get_settings
    path = request.url.path
    if path.startswith("/api"):
        ip = request.client.host if request.client else "unknown"
        strict_auth = get_settings().env == "prod"
        if strict_auth and path.startswith("/api/auth/") and request.method == "POST" \
                and not path.endswith("/logout"):
            if not _allow((ip, "auth"), 5):
                return JSONResponse(status_code=429, content={
                    "error": {"code": "rate_limited",
                              "message": "too many auth attempts, wait a minute"}})
        elif not _allow((ip, "api"), 240):
            return JSONResponse(status_code=429, content={
                "error": {"code": "rate_limited", "message": "slow down"}})
    return await call_next(request)
