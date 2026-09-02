"""Rush: the AoE2 drush/flush. Found the city, a lean economy, an early
assembler, and strikers thrown at the enemy as soon as there are four."""

from __future__ import annotations

from cero_engine.bots.base import Bot


class RushBot(Bot):
    name = "rush"

    def act(self, obs: dict) -> list[dict]:
        orders: list[dict] = []
        res = obs["resources"]

        if self.found_city(obs, orders):
            self.scout(obs, orders)
            return orders

        workers = len(self.units(obs, "worker"))
        army_now = len(self.army(obs))
        # Lean but not starving: 10 workers, half on energy once the army is
        # big (the striker stream costs energy up front and upkeep afterwards).
        energy_workers = max(self.energy_share(obs, 40), (army_now + 2) // 3)
        self.assign_workers(obs, orders, energy_workers=energy_workers)
        self.help_sites(obs, orders)

        self.train_workers(obs, orders, target=10)
        if self.lineage_unique(obs) == "watcher" and not self.units(obs, "watcher") \
                and self.can_afford(obs, "watcher"):
            core = self.free_producer(obs, "core")
            if core is not None:
                orders.append({"actor_id": core["id"], "type": "produce", "unit": "watcher"})

        free_compute = res["compute_cap"] - res["compute_used"]
        assemblers = self.buildings(obs, "assembler", finished=False)
        racks = self.buildings(obs, "rack", finished=False)
        cocoons = self.buildings(obs, "cocoon", finished=False)
        labs = self.buildings(obs, "lab", finished=False)
        pods_left = sum(1 for p in self.pods(obs) if p.get("pod_left", 0) >= 40)
        army_size = len(self.army(obs))
        if len(self.sites(obs)) < 2:
            if not assemblers and workers >= 4:
                self.build_with_worker(obs, orders, "assembler", crew=3)
            elif free_compute < 2 and len(racks) < 10:
                self.build_with_worker(obs, orders, "rack")
            elif pods_left < 2 and len(cocoons) < 2 + army_size // 6:
                # The pods are gone: farms keep the striker stream (and its upkeep) alive.
                self.build_with_worker(obs, orders, "cocoon", hug=self.my_core(obs))
            elif len(assemblers) < 2 and res["metal"] >= 100 and workers >= 8:
                self.build_with_worker(obs, orders, "assembler", crew=2)
            elif not labs and len(assemblers) >= 2 and res["metal"] >= 90:
                self.build_with_worker(obs, orders, "lab", crew=2)

        # Cheap blacksmith upgrades make the striker mass bite (AoE2 feudal
        # forging + scale mail before the flush hits).
        self.research_at(obs, orders, "lab", ["cannons_1", "armor_1", "actuators"], (40, 30))
        self.train_army(obs, orders, ["striker"])

        if not self.defend(obs, orders, radius=12):
            # Mass six before the first push, then every reinforcement joins.
            self.push(obs, orders, min_army=6 if army_size < 8 else 1)
        self.scout(obs, orders)
        return orders
