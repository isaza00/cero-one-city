"""Force one house self-play match now (instead of waiting for the 10-min cron)
and verify the season admin flow. Run inside the api container."""

from __future__ import annotations

import asyncio

import httpx


async def main() -> None:
    from arq import create_pool
    from arq.connections import RedisSettings

    from app.league.house import house_selfplay_tick
    from app.settings import get_settings

    redis = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    await house_selfplay_tick({"redis": redis})
    print("house self-play tick fired")

    # Wait for the worker to run it, then check via the public API.
    async with httpx.AsyncClient(timeout=10) as client:
        for _ in range(60):
            await asyncio.sleep(2)
            r = await client.get("http://localhost:8000/api/matches?status=finished&limit=5")
            matches = r.json()["matches"]
            house_done = [m for m in matches
                          if all(p["is_house"] for p in m["players"]) and m["players"]]
            if house_done:
                m = house_done[0]
                print(f"house match finished: {m['format']} "
                      f"{[p['name'] for p in m['players']]} "
                      f"placements={[p['placement'] for p in m['players']]} "
                      f"elo_deltas={[p['elo_delta'] for p in m['players']]}")
                return
            live = await client.get("http://localhost:8000/api/matches?status=live&limit=5")
            if live.json()["matches"]:
                continue
        raise SystemExit("no house match completed in time")


if __name__ == "__main__":
    asyncio.run(main())
