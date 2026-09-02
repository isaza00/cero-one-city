"""Turtle: the AoE2 fast-castle-into-towers player. Found the city, a solid
economy, turrets and walls facing the enemy, tech to v3, then walking towers
break the game open."""

from __future__ import annotations

from cero_engine import rules
from cero_engine.bots.base import Bot, footprint


class TurtleBot(Bot):
    name = "turtle"

    def act(self, obs: dict) -> list[dict]:
        orders: list[dict] = []
        res = obs["resources"]
        turn = obs["turn"]
        firmware = obs["research"]["firmware"]
        tier = self.firmware_tier(obs)

        if self.found_city(obs, orders):
            self.scout(obs, orders)
            return orders

        workers = len(self.units(obs, "worker"))
        target_workers = {1: 14, 2: 18, 3: 20}[tier]
        energy_workers = self.energy_share(obs, 45)
        self.assign_workers(obs, orders, energy_workers)
        self.help_sites(obs, orders)

        assemblers = self.buildings(obs, "assembler", finished=False)
        labs = self.buildings(obs, "lab", finished=False)
        racks = self.buildings(obs, "rack", finished=False)
        turrets = self.buildings(obs, "turret", finished=False)
        saving_v2 = firmware == "v1" and bool(self.buildings(obs, "assembler")) and workers >= 9
        saving_v3 = (firmware == "v2" and turn >= 26 and len(self.buildings(obs, "rack")) >= 2
                     and bool(self.buildings(obs, "lab")) and len(turrets) >= 2)
        reserve = (120, 80) if saving_v2 else (350, 250) if saving_v3 else (0, 0)

        if saving_v2 and self.research_at(obs, orders, "core", ["firmware_v2"]):
            pass
        elif saving_v3 and self.research_at(obs, orders, "core", ["firmware_v3"]):
            pass
        elif not self.train_workers(obs, orders, target_workers):
            if self.lineage_unique(obs) == "watcher" and not self.units(obs, "watcher") \
                    and self.can_afford(obs, "watcher"):
                core = self.free_producer(obs, "core")
                if core is not None:
                    orders.append({"actor_id": core["id"], "type": "produce", "unit": "watcher"})
            else:
                techs = ["fast_mining", "rich_harvest", "cargo_servos"]
                if tier >= 2:
                    techs += ["reinforced_core"]
                self.research_at(obs, orders, "core", techs, reserve)

        free_compute = res["compute_cap"] - res["compute_used"]
        if len(self.sites(obs)) < 2:
            core = self.my_core(obs)
            energy_slots = sum(3 for p in self.pods(obs)
                               if p.get("pod_left", 0) >= 40
                               and self.bank_distance(obs, p["x"], p["y"]) <= 2)
            energy_slots += self.cocoon_slots(obs)
            # A new farm only pays if there is a human to put in it (a stray in
            # sight, one being carried, or room left in the cocoons we have).
            spare_room = sum(rules.COCOON_HUMANS_MAX - c.get("humans", 0)
                             for c in self.buildings(obs, "cocoon", finished=False))
            can_farm = self.humans_available(obs) > spare_room
            if energy_workers > energy_slots and can_farm and self.can(obs, "build", "cocoon"):
                self.build_with_worker(obs, orders, "cocoon", hug=core)
            elif free_compute < 3 and len(racks) < 9:
                self.build_with_worker(obs, orders, "rack")
            elif not assemblers and workers >= 6:
                self.build_with_worker(obs, orders, "assembler", crew=2)
            elif not labs and workers >= 10 and assemblers:
                self.build_with_worker(obs, orders, "lab", crew=2)
            elif tier >= 2 and len(turrets) < (2 if saving_v3 else 4) \
                    and self.can(obs, "build", "turret"):
                self.build_with_worker(obs, orders, "turret",
                                       near=self.front_of_base(obs, 5 + len(turrets)))
            elif tier >= 2 and len(turrets) >= 2 and self.wall_front(obs, orders):
                pass
            elif self.expand(obs, orders, max_depots=2 + tier):
                pass

        if not saving_v3:
            self.research_at(obs, orders, "lab",
                             ["armor_1", "cannons_1", "optics", "armor_2", "cannons_2",
                              "anti_air"], reserve)

        wishlist = {1: ["striker"], 2: ["launcher", "striker"],
                    3: ["walking_tower", "drone_swarm", "launcher"]}[tier]
        if workers >= 8:
            self.train_army(obs, orders, wishlist, reserve)

        towers = self.units(obs, "walking_tower")
        if not self.defend(obs, orders, radius=12):
            if towers and len(self.army(obs)) >= 6:
                self.push(obs, orders, min_army=6)
            elif saving_v3 and self.raid_camp(obs, orders, min_army=4):
                pass
            else:
                # Hold near the towers until siege arrives.
                pass
        self.scout(obs, orders)
        return orders

    def front_of_base(self, obs: dict, dist: int) -> tuple[int, int]:
        hx, hy = self.base_center(obs)
        ex, ey = self.enemy_corner(obs)
        dx = 0 if ex == hx else (1 if ex > hx else -1)
        dy = 0 if ey == hy else (1 if ey > hy else -1)
        return hx + dx * dist, hy + dy * dist

    def wall_front(self, obs: dict, orders: list) -> bool:
        """A short palisade line in front of the turrets (never a closed ring:
        the crews must keep walking out)."""
        walls = self.buildings(obs, "wall", finished=False)
        if len(walls) >= 6 or not self.can(obs, "build", "wall"):
            return False
        fx, fy = self.front_of_base(obs, 8)
        hx, hy = self.base_center(obs)
        # The line runs perpendicular to the home->enemy direction.
        horizontal = abs(fx - hx) < abs(fy - hy)
        taken = self.taken_tiles(obs)
        existing = {(w["x"], w["y"]) for w in walls}
        for i in (0, 1, -1, 2, -2, 3):
            x, y = (fx + i, fy) if horizontal else (fx, fy + i)
            if (x, y) in taken or (x, y) in existing or (x, y) in self.failed_sites:
                continue
            # keep the line from cutting through a building footprint
            if any((x, y) in footprint(b) for b in obs["buildings"]):
                continue
            return self.build_with_worker(obs, orders, "wall", anchor=(x, y))
        return False
