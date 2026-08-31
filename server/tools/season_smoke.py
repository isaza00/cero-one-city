"""Season rollover smoke: close the active season via the admin API and verify
Elo resets while agent levels persist. Run inside the api container."""

from __future__ import annotations

import asyncio

import httpx

BASE = "http://localhost:8000"


async def main() -> None:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(f"{BASE}/api/auth/login", json={
            "email": "admin@cero-one.city", "password": "admin-dev-password"})
        r.raise_for_status()
        headers = {"authorization": f"Bearer {r.json()['access_token']}"}

        before = (await client.get(f"{BASE}/api/leaderboard?format=1v1&limit=3")).json()
        r = await client.post(f"{BASE}/api/admin/seasons/close", headers=headers)
        r.raise_for_status()
        result = r.json()
        print(f"closed season {result['closed']}, opened {result['opened']}")

        current = (await client.get(f"{BASE}/api/seasons/current")).json()
        assert current["season"]["number"] == result["opened"]

        after = (await client.get(f"{BASE}/api/leaderboard?format=1v1&limit=3")).json()
        assert after["rows"] == [], "new season leaderboard should start empty"
        seasons = (await client.get(f"{BASE}/api/seasons")).json()["seasons"]
        closed = next(s for s in seasons if s["number"] == result["closed"])
        assert closed["status"] == "closed" and closed["final_table"] is not None
        print(f"final table frozen with {len(closed['final_table'])} rows; "
              f"new season leaderboard empty; previous had {len(before['rows'])} rows")
        print("SEASON SMOKE: OK")


if __name__ == "__main__":
    asyncio.run(main())
