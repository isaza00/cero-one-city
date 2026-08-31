"""Shared bot plumbing: observation helpers and a deterministic base class.

Bots consume the same observation dict agents receive (band C) and return raw
order lists, so they double as the "mock provider" on the server side.
"""

from __future__ import annotations

from cero_engine.pcg import PCG32


def cheb(ax: int, ay: int, bx: int, by: int) -> int:
    return max(abs(ax - bx), abs(ay - by))


class Bot:
    name = "bot"

    def __init__(self, player_id: int, seed: int = 0) -> None:
        self.player_id = player_id
        self.rng = PCG32((seed << 8) ^ (player_id + 1))
        self.failed_sites: set[tuple[int, int]] = set()

    # ------------------------------------------------------------- observation
    def units(self, obs: dict, utype: str | None = None) -> list[dict]:
        out = obs["units"]
        if utype:
            out = [u for u in out if u["type"] == utype]
        return out

    def idle_units(self, obs: dict, utype: str | None = None) -> list[dict]:
        return [u for u in self.units(obs, utype)
                if not u.get("standing_order") and "stiff" not in u.get("status", [])
                and "fusing" not in u.get("status", [])]

    def buildings(self, obs: dict, btype: str | None = None,
                  finished: bool = True) -> list[dict]:
        out = obs["buildings"]
        if btype:
            out = [b for b in out if b["type"] == btype]
        if finished:
            out = [b for b in out if not b.get("building_turns_left")]
        return out

    def free_producer(self, obs: dict, btype: str) -> dict | None:
        for b in self.buildings(obs, btype):
            if not b.get("producing") and not b.get("researching"):
                return b
        return None

    def veins(self, obs: dict) -> list[dict]:
        return [t for t in obs["visible_map"]["notable_tiles"] if t.get("terrain") == "vein"]

    def scrap_piles(self, obs: dict) -> list[dict]:
        return [t for t in obs["visible_map"]["notable_tiles"] if t.get("scrap")]

    def enemies(self, obs: dict, kind: str | None = None) -> list[dict]:
        out = [e for e in obs["enemies_visible"] if "id" in e]
        if kind:
            out = [e for e in out if e.get("kind") == kind]
        return out

    def my_core(self, obs: dict) -> dict | None:
        cores = self.buildings(obs, "core")
        return cores[0] if cores else None

    def enemy_corner(self, obs: dict) -> tuple[int, int]:
        size = obs["visible_map"]["size"]
        core = self.my_core(obs)
        if core is None:
            return size // 2, size // 2
        return size - 1 - core["x"], size - 1 - core["y"]

    def nearest(self, x: int, y: int, items: list[dict]) -> dict | None:
        best = None
        best_d = None
        for it in items:
            d = cheb(x, y, it["x"], it["y"])
            if best_d is None or d < best_d or (d == best_d and it.get("id", 0) < best.get("id", 0)):
                best, best_d = it, d
        return best

    # ------------------------------------------------------------ common moves
    def assign_workers(self, obs: dict, orders: list, energy_workers: int) -> None:
        """Keep `energy_workers` on cocoons (2 per cocoon) and the rest mining."""
        cocoons = self.buildings(obs, "cocoon")
        veins = self.veins(obs)
        idle = self.idle_units(obs, "worker")
        slots: list[tuple[int, int]] = []
        for c in cocoons:
            slots += [(c["x"], c["y"])] * 2
        assigned_e = sum(
            1 for u in self.units(obs, "worker")
            if (u.get("standing_order") or {}).get("type") == "gather"
            and any(tuple((u["standing_order"] or {}).get("target", ())) == s for s in slots))
        for u in idle:
            if assigned_e < energy_workers and slots:
                target = min(slots, key=lambda s: cheb(u["x"], u["y"], s[0], s[1]))
                slots.remove(target)
                orders.append({"actor_id": u["id"], "type": "gather", "target": [target[0], target[1]]})
                assigned_e += 1
                continue
            pile = self.nearest(u["x"], u["y"], self.scrap_piles(obs))
            vein = self.nearest(u["x"], u["y"], veins)
            target_tile = None
            if pile is not None and vein is not None:
                target_tile = pile if cheb(u["x"], u["y"], pile["x"], pile["y"]) < \
                    cheb(u["x"], u["y"], vein["x"], vein["y"]) else vein
            else:
                target_tile = vein or pile
            if target_tile is not None:
                orders.append({"actor_id": u["id"], "type": "gather",
                               "target": [target_tile["x"], target_tile["y"]]})
            elif cocoons:
                c = cocoons[0]
                orders.append({"actor_id": u["id"], "type": "gather", "target": [c["x"], c["y"]]})

    def find_site(self, obs: dict, w: int, h: int) -> tuple[int, int] | None:
        """Pick a plausible free anchor near the core (unknown tiles assumed plain)."""
        core = self.my_core(obs)
        if core is None:
            return None
        size = obs["visible_map"]["size"]
        taken: set[tuple[int, int]] = set(self.failed_sites)
        for b in obs["buildings"]:
            bw, bh = (2, 2) if b["type"] in ("core", "assembler") else (1, 1)
            for dy in range(-1, bh + 1):
                for dx in range(-1, bw + 1):
                    taken.add((b["x"] + dx, b["y"] + dy))
        for t in obs["visible_map"]["notable_tiles"]:
            taken.add((t["x"], t["y"]))
        for u in obs["units"]:
            taken.add((u["x"], u["y"]))
        for radius in range(2, 9):
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    if max(abs(dx), abs(dy)) != radius:
                        continue
                    ax, ay = core["x"] + dx, core["y"] + dy
                    if ax < 1 or ay < 1 or ax + w > size - 1 or ay + h > size - 1:
                        continue
                    tiles = [(ax + i, ay + j) for j in range(h) for i in range(w)]
                    if any(t in taken for t in tiles):
                        continue
                    return ax, ay
        return None

    def build_with_worker(self, obs: dict, orders: list, btype: str, w: int, h: int) -> bool:
        site = self.find_site(obs, w, h)
        if site is None:
            return False
        workers = self.units(obs, "worker")
        if not workers:
            return False
        worker = min(workers, key=lambda u: (cheb(u["x"], u["y"], site[0], site[1]), u["id"]))
        if cheb(worker["x"], worker["y"], site[0], site[1]) > 1:
            orders.append({"actor_id": worker["id"], "type": "move",
                           "to": [site[0], site[1] - 1 if site[1] > 0 else site[1] + h]})
            return False
        self.failed_sites.add(site)  # do not retry the same anchor forever
        orders.append({"actor_id": worker["id"], "type": "build", "building": btype,
                       "anchor": [site[0], site[1]]})
        return True

    def attack_move(self, obs: dict, orders: list, unit: dict) -> None:
        enemies = self.enemies(obs)
        target = self.nearest(unit["x"], unit["y"], enemies)
        if target is not None:
            orders.append({"actor_id": unit["id"], "type": "attack", "target_id": target["id"]})
        else:
            cx, cy = self.enemy_corner(obs)
            orders.append({"actor_id": unit["id"], "type": "move", "to": [cx, cy]})

    # ---------------------------------------------------------------- interface
    def act(self, obs: dict) -> list[dict]:  # pragma: no cover - overridden
        return []


def make_bot(name: str, player_id: int, seed: int = 0) -> Bot:
    from cero_engine.bots import BOTS
    return BOTS[name](player_id, seed)
