"""Turtle: defensive turrets, tech to v3, then walking towers break the siege."""

from __future__ import annotations

from cero_engine.bots.base import Bot


class TurtleBot(Bot):
    name = "turtle"

    def act(self, obs: dict) -> list[dict]:
        orders: list[dict] = []
        res = obs["resources"]
        firmware = obs["research"]["firmware"]
        researching = obs["research"]["in_progress"]

        self.assign_workers(obs, orders, energy_workers=4)

        core = self.free_producer(obs, "core")
        workers = len(self.units(obs, "worker"))
        if core is not None:
            if workers < 7 and res["energy"] >= 25 \
                    and res["compute_cap"] - res["compute_used"] >= 1:
                orders.append({"actor_id": core["id"], "type": "produce", "unit": "worker"})
            elif firmware == "v1" and researching is None \
                    and res["energy"] >= 120 and res["metal"] >= 80:
                orders.append({"actor_id": core["id"], "type": "research", "tech": "firmware_v2"})
            elif firmware == "v2" and researching is None \
                    and res["energy"] >= 350 and res["metal"] >= 250 \
                    and len(self.buildings(obs, "rack")) >= 2:
                orders.append({"actor_id": core["id"], "type": "research", "tech": "firmware_v3"})

        racks = len(self.buildings(obs, "rack"))
        if (res["compute_cap"] - res["compute_used"] < 3 or racks < 2) \
                and res["metal"] >= 40 and racks < 6:
            self.build_with_worker(obs, orders, "rack", 1, 1)
        if not self.buildings(obs, "assembler") and res["metal"] >= 80:
            self.build_with_worker(obs, orders, "assembler", 2, 2)
        if firmware != "v1" and len(self.buildings(obs, "turret")) < 3 \
                and res["energy"] >= 30 and res["metal"] >= 50:
            self.build_with_worker(obs, orders, "turret", 1, 1)
        if len(self.buildings(obs, "cocoon")) * 2 < min(workers, 6) and res["metal"] >= 25:
            self.build_with_worker(obs, orders, "cocoon", 1, 1)

        assembler = self.free_producer(obs, "assembler")
        if assembler is not None:
            if firmware == "v3" and res["energy"] >= 60 and res["metal"] >= 80:
                orders.append({"actor_id": assembler["id"], "type": "produce",
                               "unit": "walking_tower"})
            elif firmware != "v1" and res["energy"] >= 25 and res["metal"] >= 20:
                orders.append({"actor_id": assembler["id"], "type": "produce", "unit": "launcher"})

        towers = self.units(obs, "walking_tower")
        escorts = [u for u in self.units(obs) if u["type"] in ("launcher", "striker")]
        if towers:
            for u in towers + escorts:
                so = u.get("standing_order") or {}
                if so.get("type") in ("attack", "attack_move"):
                    continue
                self.attack_move(obs, orders, u)
        else:
            # Hold near the core; intercept anything that comes close.
            core_b = self.my_core(obs)
            threats = [e for e in self.enemies(obs) if e.get("kind") == "unit"]
            if core_b is not None and threats:
                near = [e for e in threats
                        if max(abs(e["x"] - core_b["x"]), abs(e["y"] - core_b["y"])) <= 8]
                for u in escorts:
                    if near:
                        orders.append({"actor_id": u["id"], "type": "attack",
                                       "target_id": near[0]["id"]})
        return orders
