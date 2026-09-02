"""Random-but-legal-ish bot: exercises every order type for fuzzing invariants
(founding, gathering at every resource kind, crews, depots, walls, rally,
production, research, combat)."""

from __future__ import annotations

from cero_engine import rules
from cero_engine.bots.base import Bot


class RandomBot(Bot):
    name = "random"

    def act(self, obs: dict) -> list[dict]:
        orders: list[dict] = []
        size = obs["visible_map"]["size"]

        if self.found_city(obs, orders):
            return orders

        for u in self.units(obs):
            roll = self.rng.randint(100)
            if roll < 25:
                orders.append({"actor_id": u["id"], "type": "move",
                               "to": [self.rng.randint(size), self.rng.randint(size)]})
            elif roll < 40:
                enemies = self.enemies(obs)
                if enemies:
                    target = enemies[self.rng.randint(len(enemies))]
                    orders.append({"actor_id": u["id"], "type": "attack",
                                   "target_id": target["id"]})
            elif roll < 65 and u["type"] == "worker":
                pool = self.resource_tiles(obs)
                if pool:
                    t = pool[self.rng.randint(len(pool))]
                    orders.append({"actor_id": u["id"], "type": "gather",
                                   "target": [t["x"], t["y"]]})
            elif roll < 72 and u["type"] == "worker":
                sites = self.sites(obs)
                if sites:
                    s = sites[self.rng.randint(len(sites))]
                    orders.append({"actor_id": u["id"], "type": "build", "target_id": s["id"]})
            elif roll < 75:
                orders.append({"actor_id": u["id"], "type": "stop"})

        core = self.free_producer(obs, "core")
        if core is not None and self.rng.randint(100) < 60:
            orders.append({"actor_id": core["id"], "type": "produce", "unit": "worker"})
        elif core is not None and self.rng.randint(100) < 30:
            techs = [t["tech"] for t in obs["menus"]["techs"] if t["available"] and t["at"] == "core"]
            if techs:
                orders.append({"actor_id": core["id"], "type": "research",
                               "tech": techs[self.rng.randint(len(techs))]})
        assembler = self.free_producer(obs, "assembler")
        if assembler is not None and self.rng.randint(100) < 70:
            units = [u["unit"] for u in obs["menus"]["units"]
                     if u["available"] and u["at"] == "assembler"]
            if units:
                orders.append({"actor_id": assembler["id"], "type": "produce",
                               "unit": units[self.rng.randint(len(units))]})
        lab = self.free_producer(obs, "lab")
        if lab is not None and self.rng.randint(100) < 40:
            techs = [t["tech"] for t in obs["menus"]["techs"] if t["available"] and t["at"] == "lab"]
            if techs:
                orders.append({"actor_id": lab["id"], "type": "research",
                               "tech": techs[self.rng.randint(len(techs))]})
        if self.rng.randint(100) < 25:
            options = [b["building"] for b in obs["menus"]["build"]
                       if b["available"] and b["building"] != "core"]
            if options:
                btype = options[self.rng.randint(len(options))]
                hug = self.my_core(obs) if btype == "cocoon" else None
                self.build_with_worker(obs, orders, btype, hug=hug,
                                       crew=1 + self.rng.randint(2))
        if core is not None and self.rng.randint(100) < 10:
            orders.append({"actor_id": core["id"], "type": "rally",
                           "to": [self.rng.randint(size), self.rng.randint(size)]})
        if self.rng.randint(100) < 5:
            rivals = [p for p in range(4) if p != self.player_id]
            orders.append({"type": "diplomacy", "action": "propose_truce",
                           "target_player": rivals[self.rng.randint(len(rivals))]})
        _ = rules  # keep the rules import for future weights
        return orders
