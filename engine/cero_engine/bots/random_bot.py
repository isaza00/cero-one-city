"""Random-but-legal-ish bot: exercises every order type for fuzzing invariants."""

from __future__ import annotations

from cero_engine.bots.base import Bot


class RandomBot(Bot):
    name = "random"

    def act(self, obs: dict) -> list[dict]:
        orders: list[dict] = []
        size = obs["visible_map"]["size"]

        for u in self.units(obs):
            roll = self.rng.randint(100)
            if roll < 30:
                orders.append({"actor_id": u["id"], "type": "move",
                               "to": [self.rng.randint(size), self.rng.randint(size)]})
            elif roll < 45:
                enemies = self.enemies(obs)
                if enemies:
                    target = enemies[self.rng.randint(len(enemies))]
                    orders.append({"actor_id": u["id"], "type": "attack",
                                   "target_id": target["id"]})
            elif roll < 60 and u["type"] == "worker":
                veins = self.veins(obs)
                cocoons = self.buildings(obs, "cocoon")
                pool = veins + [{"x": c["x"], "y": c["y"]} for c in cocoons]
                if pool:
                    t = pool[self.rng.randint(len(pool))]
                    orders.append({"actor_id": u["id"], "type": "gather",
                                   "target": [t["x"], t["y"]]})

        core = self.free_producer(obs, "core")
        if core is not None and self.rng.randint(100) < 60:
            orders.append({"actor_id": core["id"], "type": "produce", "unit": "worker"})
        assembler = self.free_producer(obs, "assembler")
        if assembler is not None and self.rng.randint(100) < 70:
            orders.append({"actor_id": assembler["id"], "type": "produce", "unit": "striker"})
        if self.rng.randint(100) < 15:
            self.build_with_worker(obs, orders, "cocoon", 1, 1)
        return orders
