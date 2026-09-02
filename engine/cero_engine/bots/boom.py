"""Boom: the AoE2 economic opening. Found the city, pump workers, farm and
expand with depots, age up on schedule, then win with a big mixed army and a
second core."""

from __future__ import annotations

from cero_engine import rules
from cero_engine.bots.base import Bot, cheb


class BoomBot(Bot):
    name = "boom"

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
        target_workers = self.prefs.get("workers") or {1: 16, 2: 22, 3: 24}[tier]
        # Energy pays every worker AND the upkeep of the whole army: about 45%
        # of the crew on pods/farms, re-balanced when one bank piles up.
        energy_workers = self.energy_share(obs, self.prefs.get("energy_pct", 45))
        self.assign_workers(obs, orders, energy_workers)
        self.help_sites(obs, orders)

        assemblers = self.buildings(obs, "assembler", finished=False)
        labs = self.buildings(obs, "lab", finished=False)
        racks = self.buildings(obs, "rack", finished=False)
        saving_v2 = (firmware == "v1" and bool(self.buildings(obs, "assembler"))
                     and (workers >= 10 or self.prefs.get("age_up")))
        saving_v3 = (firmware == "v2" and (turn >= 28 or self.prefs.get("age_up"))
                     and len(self.buildings(obs, "rack")) >= 2
                     and bool(self.buildings(obs, "lab")))
        reserve = (120, 80) if saving_v2 else (350, 250) if saving_v3 else (0, 0)

        # Core: the age-up the moment it is affordable (AoE2: stop villagers,
        # click up), otherwise workers, otherwise economy techs.
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
                    techs += ["reinforced_core", "cocoon_battery"]
                self.research_at(obs, orders, "core", techs, reserve)

        # Build order: one new foundation per turn keeps the crews focused.
        # Farms come first the moment the wild pods cannot seat the energy crew.
        free_compute = res["compute_cap"] - res["compute_used"]
        want = self.prefs.pop("want", None)  # one building the coach asked for, now
        if want and self.can(obs, "build", want):
            core0 = self.my_core(obs)
            near = self.front_of_base(obs, 5) if want in ("turret", "wall") else None
            self.build_with_worker(obs, orders, want, near=near,
                                   hug=core0 if want == "cocoon" else None, crew=2)
        elif len(self.sites(obs)) < 2:
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
            elif free_compute < 3 and len(racks) < 10:
                self.build_with_worker(obs, orders, "rack")
            elif not assemblers and workers >= 6:
                self.build_with_worker(obs, orders, "assembler", crew=2)
            elif tier >= 2 and len(assemblers) < 2 and res["metal"] >= 100 and not saving_v3:
                self.build_with_worker(obs, orders, "assembler", crew=2)
            elif self.expand(obs, orders, max_depots=3 + tier):
                pass
            elif not labs and workers >= 12 and assemblers:
                self.build_with_worker(obs, orders, "lab", crew=2)
            elif tier >= 2 and len(self.buildings(obs, "core", finished=False)) < 2 \
                    and res["metal"] >= 100 and not saving_v3:
                self.build_with_worker(obs, orders, "core", near=self.expansion_site(obs),
                                       crew=3)
            elif tier >= 2 and len(self.buildings(obs, "turret", finished=False)) < 1 \
                    and not saving_v3:
                self.build_with_worker(obs, orders, "turret", near=self.front_of_base(obs, 4))
            elif tier >= 2 and len(assemblers) < 3 and res["metal"] >= 150 and not saving_v3:
                self.build_with_worker(obs, orders, "assembler", crew=2)

        # Lab: cheap combat techs once the army exists.
        if not saving_v3:
            self.research_at(obs, orders, "lab",
                             ["cannons_1", "armor_1", "actuators", "optics", "cannons_2",
                              "armor_2", "anti_air"], reserve)

        # Army: while banking for a firmware tier, spend only the surplus.
        wishlist = self.prefs.get("wishlist") or {
            1: ["striker"], 2: ["launcher", "rider", "striker", "wasp"],
            3: ["launcher", "rider", "drone_swarm", "walking_tower", "striker"]}[tier]
        if workers >= 8:
            self.train_army(obs, orders, wishlist, reserve)

        fusing_mode = firmware == "v3" and len(self.units(obs, "colossus")) < 2
        if fusing_mode:
            self.try_fuse(obs, orders)

        if self.prefs.get("hold"):
            pass  # the coach holds the army; the general handles it
        elif not self.defend(obs, orders, radius=14):
            exclude = ("striker",) if fusing_mode else ()
            army = self.army(obs, exclude)
            if 5 <= len(army) < 10 and self.raid_camp(obs, orders, min_army=5):
                pass
            else:
                self.push(obs, orders, min_army=12 if tier >= 2 else 8, exclude=exclude)
        self.scout(obs, orders)
        return orders

    def expansion_site(self, obs: dict) -> tuple[int, int]:
        """Somewhere a second core pays: near resources no drop-off reaches."""
        hx, hy = self.base_center(obs)
        best = None
        best_key = None
        for t in self.resource_tiles(obs):
            if t["kind"] == "cocoon" or self.bank_distance(obs, t["x"], t["y"]) <= 3:
                continue
            key = (cheb(hx, hy, t["x"], t["y"]), t["x"], t["y"])
            if best_key is None or key < best_key:
                best, best_key = (t["x"], t["y"]), key
        return best or (hx, hy)

    def front_of_base(self, obs: dict, dist: int) -> tuple[int, int]:
        hx, hy = self.base_center(obs)
        ex, ey = self.enemy_corner(obs)
        dx = 0 if ex == hx else (1 if ex > hx else -1)
        dy = 0 if ey == hy else (1 if ey > hy else -1)
        return hx + dx * dist, hy + dy * dist
