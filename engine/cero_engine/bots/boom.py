"""Boom: economy first, firmware v2, then a launcher/rider army."""

from __future__ import annotations

from cero_engine.bots.base import Bot


class BoomBot(Bot):
    name = "boom"

    def act(self, obs: dict) -> list[dict]:
        orders: list[dict] = []
        res = obs["resources"]
        firmware = obs["research"]["firmware"]
        researching = obs["research"]["in_progress"]

        self.assign_workers(obs, orders, energy_workers=4)

        core = self.free_producer(obs, "core")
        workers = len(self.units(obs, "worker"))
        if core is not None:
            if workers < 8 and res["energy"] >= 25 \
                    and res["compute_cap"] - res["compute_used"] >= 1:
                orders.append({"actor_id": core["id"], "type": "produce", "unit": "worker"})
            elif firmware == "v1" and researching is None \
                    and res["energy"] >= 120 and res["metal"] >= 80:
                orders.append({"actor_id": core["id"], "type": "research", "tech": "firmware_v2"})
            elif firmware != "v1" and researching is None \
                    and res["energy"] >= 50 and res["metal"] >= 40:
                done = set(obs["research"]["done"])
                for tech in ("fast_mining", "rich_harvest", "cocoon_battery"):
                    if tech not in done:
                        orders.append({"actor_id": core["id"], "type": "research", "tech": tech})
                        break

        racks = len(self.buildings(obs, "rack"))
        if res["compute_cap"] - res["compute_used"] < 3 and res["metal"] >= 40 and racks < 6:
            self.build_with_worker(obs, orders, "rack", 1, 1)
        cocoons = len(self.buildings(obs, "cocoon"))
        if cocoons * 2 < min(workers, 6) and res["metal"] >= 25:
            self.build_with_worker(obs, orders, "cocoon", 1, 1)
        if not self.buildings(obs, "assembler") and res["metal"] >= 80:
            self.build_with_worker(obs, orders, "assembler", 2, 2)

        assembler = self.free_producer(obs, "assembler")
        if assembler is not None and firmware != "v1":
            n_launchers = len(self.units(obs, "launcher"))
            n_riders = len(self.units(obs, "rider"))
            unit = "launcher" if n_launchers <= n_riders else "rider"
            orders.append({"actor_id": assembler["id"], "type": "produce", "unit": unit})
        elif assembler is not None and res["energy"] >= 20 and res["metal"] >= 15:
            orders.append({"actor_id": assembler["id"], "type": "produce", "unit": "striker"})

        army = [u for u in self.units(obs)
                if u["type"] in ("striker", "launcher", "rider", "wasp", "anvil")]
        enemies = self.enemies(obs)
        threat = [e for e in enemies if e.get("kind") == "unit"]
        if threat:
            core_b = self.my_core(obs)
            if core_b is not None:
                near = [e for e in threat
                        if max(abs(e["x"] - core_b["x"]), abs(e["y"] - core_b["y"])) <= 10]
                if near:  # defend
                    for u in army:
                        orders.append({"actor_id": u["id"], "type": "attack",
                                       "target_id": near[0]["id"]})
        if len(army) >= 8:
            for u in army:
                so = u.get("standing_order") or {}
                if so.get("type") == "attack":
                    continue
                self.attack_move(obs, orders, u)
        return orders
