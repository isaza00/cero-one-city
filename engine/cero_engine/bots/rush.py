"""Rush: minimal economy, an early assembler, strikers thrown at the enemy."""

from __future__ import annotations

from cero_engine.bots.base import Bot


class RushBot(Bot):
    name = "rush"

    def act(self, obs: dict) -> list[dict]:
        orders: list[dict] = []
        res = obs["resources"]

        self.assign_workers(obs, orders, energy_workers=2)

        core = self.free_producer(obs, "core")
        workers = len(self.units(obs, "worker"))
        if core is not None and workers < 5:
            orders.append({"actor_id": core["id"], "type": "produce", "unit": "worker"})

        if not self.buildings(obs, "assembler") and res["metal"] >= 80:
            self.build_with_worker(obs, orders, "assembler", 2, 2)

        if (res["compute_cap"] - res["compute_used"] < 2 and res["metal"] >= 40
                and len(self.buildings(obs, "rack")) < 3):
            self.build_with_worker(obs, orders, "rack", 1, 1)

        assembler = self.free_producer(obs, "assembler")
        if assembler is not None and res["energy"] >= 25 and res["metal"] >= 20:
            orders.append({"actor_id": assembler["id"], "type": "produce", "unit": "striker"})

        army = [u for u in self.units(obs) if u["type"] not in ("worker",)]
        if len(army) >= 3:
            for u in army:
                so = u.get("standing_order") or {}
                if so.get("type") == "attack":
                    continue
                self.attack_move(obs, orders, u)
        return orders
