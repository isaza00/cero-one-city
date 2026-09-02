"""Shared bot plumbing: observation helpers and the AoE2 macro every scripted
bot runs - found the city, keep every worker busy, expand with depots, build
from the menu, train, research, scout, fight.

Bots consume the same observation dict agents receive (band C) and return raw
order lists, so they double as the "mock provider" on the server side. They
are deterministic: every choice iterates sorted data and the only randomness
is the seeded PCG32 the random bot uses.
"""

from __future__ import annotations

from cero_engine import rules
from cero_engine.pcg import PCG32

LINEAGE_UNIQUE = {"swarm": "spark", "forge": "anvil", "oracle": "watcher",
                  "parasite": "leech", "photon": "prism"}
FW_TIER = {"v1": 1, "v2": 2, "v3": 3}
SIZE_OF = {b: (s["w"], s["h"]) for b, s in rules.BUILDINGS.items()}
# How many workers one resource tile takes before the next tile is better.
TILE_CAP = {"pod": 3, "vein": 3, "cocoon": rules.MAX_WORKERS_PER_COCOON, "scrap": 2,
            "survivor": 1}


def cheb(ax: int, ay: int, bx: int, by: int) -> int:
    return max(abs(ax - bx), abs(ay - by))


def footprint(b: dict) -> list[tuple[int, int]]:
    w, h = SIZE_OF.get(b["type"], (1, 1))
    return [(b["x"] + dx, b["y"] + dy) for dy in range(h) for dx in range(w)]


class Bot:
    name = "bot"

    def __init__(self, player_id: int, seed: int = 0) -> None:
        self.player_id = player_id
        self.rng = PCG32((seed << 8) ^ (player_id + 1))
        self.failed_sites: set[tuple[int, int]] = set()
        self.scout_leg = 0

    # ------------------------------------------------------------- observation
    def units(self, obs: dict, utype: str | None = None) -> list[dict]:
        out = obs["units"]
        if utype:
            out = [u for u in out if u["type"] == utype]
        return sorted(out, key=lambda u: u["id"])

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
            out = [b for b in out if not b.get("under_construction")]
        return sorted(out, key=lambda b: b["id"])

    def sites(self, obs: dict, btype: str | None = None) -> list[dict]:
        out = [b for b in obs["buildings"] if b.get("under_construction")]
        if btype:
            out = [b for b in out if b["type"] == btype]
        return sorted(out, key=lambda b: b["id"])

    def free_producer(self, obs: dict, btype: str) -> dict | None:
        for b in self.buildings(obs, btype):
            if not b.get("producing") and not b.get("researching"):
                return b
        return None

    def notables(self, obs: dict, terrain: str) -> list[dict]:
        return [t for t in obs["visible_map"]["notable_tiles"] if t.get("terrain") == terrain]

    def veins(self, obs: dict) -> list[dict]:
        return self.notables(obs, "vein")

    def pods(self, obs: dict) -> list[dict]:
        return self.notables(obs, "pod")

    def scrap_piles(self, obs: dict) -> list[dict]:
        return [t for t in obs["visible_map"]["notable_tiles"] if t.get("scrap")]

    def enemies(self, obs: dict, kind: str | None = None) -> list[dict]:
        out = [e for e in obs["enemies_visible"] if "id" in e]
        if kind:
            out = [e for e in out if e.get("kind") == kind]
        return sorted(out, key=lambda e: e["id"])

    def my_core(self, obs: dict) -> dict | None:
        cores = self.buildings(obs, "core")
        return cores[0] if cores else None

    def dropoffs(self, obs: dict) -> list[dict]:
        return [b for b in self.buildings(obs) if b.get("dropoff")]

    def base_center(self, obs: dict) -> tuple[int, int]:
        """Where "home" is: the first core (finished or site), else the crew."""
        cores = self.buildings(obs, "core", finished=False)
        if cores:
            return cores[0]["x"] + 1, cores[0]["y"] + 1
        units = self.units(obs)
        if not units:
            size = obs["visible_map"]["size"]
            return size // 2, size // 2
        return (sum(u["x"] for u in units) // len(units),
                sum(u["y"] for u in units) // len(units))

    def enemy_corner(self, obs: dict) -> tuple[int, int]:
        size = obs["visible_map"]["size"]
        cx, cy = self.base_center(obs)
        return size - 1 - cx, size - 1 - cy

    def nearest(self, x: int, y: int, items: list[dict]) -> dict | None:
        best = None
        best_key = None
        for it in items:
            key = (cheb(x, y, it["x"], it["y"]), it.get("id", 0), it["x"], it["y"])
            if best_key is None or key < best_key:
                best, best_key = it, key
        return best

    def menu(self, obs: dict, kind: str, name: str) -> dict | None:
        key = {"build": "building", "units": "unit", "techs": "tech"}[kind]
        for entry in obs["menus"][kind]:
            if entry[key] == name:
                return entry
        return None

    def can(self, obs: dict, kind: str, name: str) -> bool:
        entry = self.menu(obs, kind, name)
        return bool(entry and entry["available"])

    def firmware_tier(self, obs: dict) -> int:
        return FW_TIER[obs["research"]["firmware"]]

    def lineage_unique(self, obs: dict) -> str | None:
        return LINEAGE_UNIQUE.get(obs["you"].get("lineage") or "")

    # -------------------------------------------------------------- founding
    def found_city(self, obs: dict, orders: list) -> bool:
        """The nomad opening: every worker builds the first core. Returns True
        while the city has no finished core (the caller skips other building)."""
        if self.my_core(obs) is not None:
            return False
        workers = self.units(obs, "worker")
        if not workers:
            return True
        site = next((s for s in self.sites(obs, "core")), None)
        if site is not None:
            for w in workers:
                so = w.get("standing_order") or {}
                if so.get("type") == "build" and so.get("target_id") == site["id"]:
                    continue
                orders.append({"actor_id": w["id"], "type": "build", "target_id": site["id"]})
            return True
        entry = self.menu(obs, "build", "core")
        if entry is None or not entry["available"]:
            return True  # broke: nothing to do until metal turns up
        anchor = entry.get("suggested_anchor") or self.find_site(obs, 2, 2)
        if anchor is None:
            return True
        for w in workers:
            orders.append({"actor_id": w["id"], "type": "build", "building": "core",
                           "anchor": [anchor[0], anchor[1]]})
        return True

    # --------------------------------------------------------------- economy
    def resource_tiles(self, obs: dict) -> list[dict]:
        """Every gatherable tile in sight with its kind and remaining value."""
        out: list[dict] = []
        for t in obs["visible_map"]["notable_tiles"]:
            if t.get("terrain") == "pod" and t.get("pod_left", 0) > 0:
                out.append({"x": t["x"], "y": t["y"], "kind": "pod", "left": t["pod_left"]})
            elif t.get("terrain") == "vein" and t.get("vein_left", 0) > 0:
                out.append({"x": t["x"], "y": t["y"], "kind": "vein", "left": t["vein_left"]})
            elif t.get("scrap"):
                left = t["scrap"].get("e", 0) + t["scrap"].get("m", 0)
                if left > 0:
                    out.append({"x": t["x"], "y": t["y"], "kind": "scrap", "left": left})
        room = 0
        for c in self.buildings(obs, "cocoon"):
            humans = c.get("humans", 0)
            room += rules.COCOON_HUMANS_MAX - humans
            if humans > 0:  # an empty cocoon incubates nothing
                out.append({"x": c["x"], "y": c["y"], "kind": "cocoon", "left": 10 ** 6,
                            "cap": humans})
        # Stray humans are worth fetching only when a cocoon can take them.
        carrying = sum(1 for u in self.units(obs, "worker") if (u.get("carrying") or {}).get("h"))
        if room - carrying > 0:
            for s in sorted(obs.get("survivors") or [], key=lambda s: s["id"])[:room - carrying]:
                out.append({"x": s["x"], "y": s["y"], "kind": "survivor", "left": 1})
        return sorted(out, key=lambda t: (t["x"], t["y"]))

    def humans_available(self, obs: dict) -> int:
        """Survivors in sight plus humans already being carried: what new cocoons
        could incubate."""
        carrying = sum(1 for u in self.units(obs, "worker") if (u.get("carrying") or {}).get("h"))
        return len(obs.get("survivors") or []) + carrying

    def cocoon_slots(self, obs: dict) -> int:
        return sum(c.get("humans", 0) for c in self.buildings(obs, "cocoon"))

    def bank_distance(self, obs: dict, x: int, y: int) -> int:
        """Tiles between a resource and the nearest finished drop-off (0-1 means a
        worker can stand next to both and bank every turn)."""
        best = 99
        for b in self.dropoffs(obs):
            for fx, fy in footprint(b):
                best = min(best, cheb(x, y, fx, fy))
        return best

    def assign_workers(self, obs: dict, orders: list, energy_workers: int) -> None:
        """Keep `energy_workers` on energy (pods/cocoons) and the rest on metal
        (veins/scrap). Preference: tiles that bank instantly (within 2 of a
        drop-off), then the closest. Builders and repairers are left alone."""
        tiles = self.resource_tiles(obs)
        by_pos = {(t["x"], t["y"]): t for t in tiles}
        load: dict[tuple[int, int], int] = {}
        energy_kinds = ("pod", "cocoon", "survivor")

        pool: list[dict] = []
        energy_count = 0
        metal_count = 0
        for u in self.units(obs, "worker"):
            if "stiff" in u.get("status", []):
                continue
            so = u.get("standing_order") or {}
            if so.get("type") == "gather":
                tgt = tuple(so.get("target") or ())
                t = by_pos.get(tgt)
                if t is not None:
                    load[tgt] = load.get(tgt, 0) + 1
                    if t["kind"] in energy_kinds:
                        energy_count += 1
                    else:
                        metal_count += 1
                    continue
                pool.append(u)  # its tile is gone: re-task
            elif so:
                continue  # building / repairing / moving on purpose
            elif (u.get("carrying") or {}).get("h"):
                continue  # holding a human for a cocoon that is not finished yet
            else:
                pool.append(u)

        def pick(u: dict, want_energy: bool) -> dict | None:
            best = None
            best_key = None
            for t in tiles:
                is_energy = t["kind"] in energy_kinds
                if is_energy != want_energy:
                    continue
                if load.get((t["x"], t["y"]), 0) >= t.get("cap", TILE_CAP[t["kind"]]):
                    continue
                bank = 0 if t["kind"] == "survivor" else self.bank_distance(obs, t["x"], t["y"])
                key = (0 if bank <= 2 else 1, bank, cheb(u["x"], u["y"], t["x"], t["y"]),
                       t["x"], t["y"])
                if best_key is None or key < best_key:
                    best, best_key = t, key
            return best

        for u in pool:
            want_energy = energy_count < energy_workers
            t = pick(u, want_energy) or pick(u, not want_energy)
            if t is None:
                # Nothing in sight: walk toward the middle where fresh veins are.
                size = obs["visible_map"]["size"]
                orders.append({"actor_id": u["id"], "type": "move",
                               "to": [size // 2, size // 2]})
                continue
            load[(t["x"], t["y"])] = load.get((t["x"], t["y"]), 0) + 1
            if t["kind"] in energy_kinds:
                energy_count += 1
            else:
                metal_count += 1
            orders.append({"actor_id": u["id"], "type": "gather", "target": [t["x"], t["y"]]})

    def expand(self, obs: dict, orders: list, max_depots: int = 4) -> bool:
        """AoE2 mining camp: drop a depot beside the richest resource cluster
        that no drop-off reaches yet (metal first, then pods)."""
        if not self.can(obs, "build", "depot"):
            return False
        if self.sites(obs, "depot") or len(self.buildings(obs, "depot")) >= max_depots:
            return False
        # Only when the tiles that already bank instantly cannot seat the crew.
        seats = sum(t.get("cap", TILE_CAP[t["kind"]]) for t in self.resource_tiles(obs)
                    if t["kind"] != "survivor" and t["left"] >= 40
                    and self.bank_distance(obs, t["x"], t["y"]) <= 2)
        if seats >= len(self.units(obs, "worker")):
            return False
        hx, hy = self.base_center(obs)
        candidates = []
        for t in self.resource_tiles(obs):
            if t["kind"] == "cocoon" or t["left"] < 60:
                continue
            if self.bank_distance(obs, t["x"], t["y"]) <= 2:
                continue
            d_home = cheb(hx, hy, t["x"], t["y"])
            if d_home > 24:
                continue
            candidates.append((0 if t["kind"] == "vein" else 1, d_home, t["x"], t["y"]))
        candidates.sort()
        taken = self.taken_tiles(obs)
        for _, _, tx, ty in candidates:
            best = None
            best_key = None
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if dx == 0 and dy == 0:
                        continue
                    ax, ay = tx + dx, ty + dy
                    if (ax, ay) in taken or (ax, ay) in self.failed_sites:
                        continue
                    key = (cheb(hx, hy, ax, ay), ax, ay)
                    if best_key is None or key < best_key:
                        best, best_key = (ax, ay), key
            if best is None:
                continue
            if self.build_with_worker(obs, orders, "depot", anchor=best):
                return True
        return False

    # ---------------------------------------------------------------- sites
    def taken_tiles(self, obs: dict, margin: int = 0) -> set[tuple[int, int]]:
        size = obs["visible_map"]["size"]
        taken: set[tuple[int, int]] = set()
        for b in obs["buildings"]:
            for fx, fy in footprint(b):
                for dy in range(-margin, margin + 1):
                    for dx in range(-margin, margin + 1):
                        taken.add((fx + dx, fy + dy))
        for e in obs["enemies_visible"]:
            if e.get("kind") == "building":
                for fx, fy in footprint(e):
                    taken.add((fx, fy))
        for t in obs["visible_map"]["notable_tiles"]:
            taken.add((t["x"], t["y"]))
        for u in obs["units"]:
            taken.add((u["x"], u["y"]))
        for e in obs["enemies_visible"]:
            taken.add((e["x"], e["y"]))
        for c in obs.get("camps") or []:
            taken.add((c["x"], c["y"]))
        for x in range(size):
            taken.add((x, 0))
            taken.add((x, size - 1))
            taken.add((0, x))
            taken.add((size - 1, x))
        return taken

    def find_site(self, obs: dict, w: int, h: int, near: tuple[int, int] | None = None,
                  hug: dict | None = None, min_gap: int = 1) -> tuple[int, int] | None:
        """A free anchor for a w x h building near `near` (default: home).
        `hug`: prefer anchors whose footprint touches that building's ring
        (cocoons next to the core bank instantly). min_gap keeps a walkway
        between buildings so units never get boxed in."""
        if len(self.failed_sites) > 16:  # a stale blacklist can wall off the base
            self.failed_sites.clear()
        nx, ny = near or self.base_center(obs)
        size = obs["visible_map"]["size"]
        taken = self.taken_tiles(obs, margin=0)
        gap_taken = self.taken_tiles(obs, margin=min_gap) if min_gap else taken
        hug_ring: set[tuple[int, int]] = set()
        if hug is not None:
            for fx, fy in footprint(hug):
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        hug_ring.add((fx + dx, fy + dy))
        best = None
        best_key = None
        for radius in range(1, 14):
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    if max(abs(dx), abs(dy)) != radius:
                        continue
                    ax, ay = nx + dx, ny + dy
                    if ax < 1 or ay < 1 or ax + w > size - 1 or ay + h > size - 1:
                        continue
                    if (ax, ay) in self.failed_sites:
                        continue
                    tiles = [(ax + i, ay + j) for j in range(h) for i in range(w)]
                    if any(t in taken for t in tiles):
                        continue
                    # Keep a one-tile walkway to other buildings unless hugging.
                    touches_hug = hug is not None and any(t in hug_ring for t in tiles)
                    if not touches_hug and any(t in gap_taken for t in tiles):
                        continue
                    key = (0 if touches_hug else 1, radius, ax, ay)
                    if best_key is None or key < best_key:
                        best, best_key = (ax, ay), key
            if best is not None and (hug is None or best_key[0] == 0 or radius >= 4):
                break
        return best

    def build_with_worker(self, obs: dict, orders: list, btype: str,
                          near: tuple[int, int] | None = None,
                          anchor: tuple[int, int] | None = None, hug: dict | None = None,
                          crew: int = 1) -> bool:
        """Drop a foundation and send the nearest free workers (AoE2: click, task
        villagers, forget). The engine walks them there."""
        if not self.can(obs, "build", btype):
            return False
        w, h = SIZE_OF[btype]
        site = anchor or self.find_site(obs, w, h, near=near, hug=hug)
        if site is None:
            return False
        workers = [u for u in self.units(obs, "worker")
                   if "stiff" not in u.get("status", [])
                   and (u.get("standing_order") or {}).get("type") != "build"]
        if not workers:
            return False
        workers.sort(key=lambda u: (cheb(u["x"], u["y"], site[0], site[1]), u["id"]))
        self.failed_sites.add(site)  # never retry the same anchor forever
        for u in workers[:max(1, crew)]:
            orders.append({"actor_id": u["id"], "type": "build", "building": btype,
                           "anchor": [site[0], site[1]]})
        return True

    def help_sites(self, obs: dict, orders: list, max_crew: int = 2) -> None:
        """Task idle workers onto stalled sites (a builder died or wandered)."""
        for s in self.sites(obs):
            uc = s["under_construction"]
            if uc["builders"] >= max_crew:
                continue
            idle = [u for u in self.idle_units(obs, "worker")]
            idle.sort(key=lambda u: (cheb(u["x"], u["y"], s["x"], s["y"]), u["id"]))
            for u in idle[:max_crew - uc["builders"]]:
                orders.append({"actor_id": u["id"], "type": "build", "target_id": s["id"]})

    # ------------------------------------------------------------ production
    def energy_share(self, obs: dict, pct: int = 45) -> int:
        """How many workers belong on energy: `pct` of the crew, at least the
        upkeep bill, shifted toward whichever bank is running dry (AoE2 players
        re-task villagers when one resource piles up)."""
        res = obs["resources"]
        workers = len(self.units(obs, "worker"))
        if res["energy"] > 2 * res["metal"] + 200:
            pct = max(25, pct - 20)
        elif res["metal"] > 2 * res["energy"] + 200:
            pct = min(70, pct + 20)
        return max(3, workers * pct // 100, res["upkeep_next"] // 6 + 2)

    def spendable_energy(self, obs: dict) -> int:
        """Energy above the next upkeep bill (never starve the army stiff)."""
        res = obs["resources"]
        return res["energy"] - res["upkeep_next"] - 2

    def train_workers(self, obs: dict, orders: list, target: int,
                      reserve_e: int = 0) -> bool:
        core = self.free_producer(obs, "core")
        if core is None or len(self.units(obs, "worker")) >= target:
            return False
        if self.spendable_energy(obs) - reserve_e < rules.UNITS["worker"]["cost_e"]:
            return False
        if not self.can(obs, "units", "worker"):
            return False
        orders.append({"actor_id": core["id"], "type": "produce", "unit": "worker"})
        return True

    def research_at(self, obs: dict, orders: list, btype: str, techs: list[str],
                    reserve: tuple[int, int] = (0, 0)) -> bool:
        b = self.free_producer(obs, btype)
        if b is None:
            return False
        res = obs["resources"]
        for tech in techs:
            entry = self.menu(obs, "techs", tech)
            if entry is None or not entry["available"]:
                continue
            if self.spendable_energy(obs) - reserve[0] < entry["cost_e"] \
                    or res["metal"] - reserve[1] < entry["cost_m"]:
                continue
            orders.append({"actor_id": b["id"], "type": "research", "tech": tech})
            return True
        return False

    def can_afford(self, obs: dict, unit: str, reserve: tuple[int, int] = (0, 0)) -> bool:
        entry = self.menu(obs, "units", unit)
        if entry is None or not entry["available"]:
            return False
        res = obs["resources"]
        return (self.spendable_energy(obs) - reserve[0] >= entry["cost_e"]
                and res["metal"] - reserve[1] >= entry["cost_m"])

    def pick_army_unit(self, obs: dict, wishlist: list[str],
                       reserve: tuple[int, int] = (0, 0)) -> str | None:
        """Least-represented affordable unit from the wishlist plus the lineage unique."""
        pool = list(wishlist)
        unique = self.lineage_unique(obs)
        if unique and rules.UNITS[unique]["prod_at"] == "assembler" and unique not in pool:
            pool.append(unique)
        pool = [u for u in pool if self.can_afford(obs, u, reserve)]
        if not pool:
            return None

        def count(t: str) -> int:  # living + still in production
            n = len(self.units(obs, t))
            for b in obs["buildings"]:
                if (b.get("producing") or {}).get("unit") == t:
                    n += 1
            return n

        return min(pool, key=lambda t: (count(t), pool.index(t)))

    def train_army(self, obs: dict, orders: list, wishlist: list[str],
                   reserve: tuple[int, int] = (0, 0)) -> None:
        for assembler in self.buildings(obs, "assembler"):
            if assembler.get("producing") or assembler.get("researching"):
                continue
            unit = self.pick_army_unit(obs, wishlist, reserve)
            if unit is not None:
                orders.append({"actor_id": assembler["id"], "type": "produce", "unit": unit})

    def try_fuse(self, obs: dict, orders: list) -> bool:
        """Fuse 5 orthogonally-connected strikers into a colossus; rally them otherwise."""
        if obs["research"]["firmware"] != "v3":
            return False
        strikers = [u for u in self.units(obs, "striker")
                    if "fusing" not in u.get("status", [])
                    and "stiff" not in u.get("status", [])]
        if len(strikers) < rules.COLOSSUS_FUSE_COUNT:
            return False
        pos = {(u["x"], u["y"]): u for u in strikers}
        for seed in sorted(strikers, key=lambda u: u["id"]):
            group, frontier = [seed], [seed]
            seen = {(seed["x"], seed["y"])}
            while frontier and len(group) < rules.COLOSSUS_FUSE_COUNT:
                cur = frontier.pop(0)
                for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
                    p = (cur["x"] + dx, cur["y"] + dy)
                    if p in pos and p not in seen:
                        seen.add(p)
                        group.append(pos[p])
                        frontier.append(pos[p])
            if len(group) == rules.COLOSSUS_FUSE_COUNT:
                ids = sorted(u["id"] for u in group)
                orders.append({"actor_id": ids[0], "type": "fuse", "unit_ids": ids})
                return True
        lead = min(strikers, key=lambda u: u["id"])
        orders.append({"actor_id": lead["id"], "type": "stop"})
        for u in strikers:
            if u["id"] != lead["id"]:
                orders.append({"actor_id": u["id"], "type": "move",
                               "to": [lead["x"], lead["y"]]})
        return False

    # ------------------------------------------------------------------ army
    def army(self, obs: dict, exclude: tuple[str, ...] = ()) -> list[dict]:
        return [u for u in self.units(obs)
                if u["type"] not in ("worker", "watcher") + exclude
                and "fusing" not in u.get("status", [])]

    def attack_move(self, obs: dict, orders: list, unit: dict) -> None:
        enemies = self.enemies(obs)
        target = self.nearest(unit["x"], unit["y"], enemies)
        if target is not None:
            orders.append({"actor_id": unit["id"], "type": "attack_move",
                           "to": [target["x"], target["y"]]})
        else:
            cx, cy = self.enemy_corner(obs)
            orders.append({"actor_id": unit["id"], "type": "attack_move", "to": [cx, cy]})

    def defend(self, obs: dict, orders: list, radius: int = 12) -> bool:
        """Anything hostile near home pulls the whole army onto it."""
        hx, hy = self.base_center(obs)
        threats = [e for e in self.enemies(obs, "unit")
                   if cheb(e["x"], e["y"], hx, hy) <= radius]
        if not threats:
            return False
        target = self.nearest(hx, hy, threats)
        for u in self.army(obs):
            so = u.get("standing_order") or {}
            if so.get("type") == "attack" and so.get("target_id") == target["id"]:
                continue
            orders.append({"actor_id": u["id"], "type": "attack", "target_id": target["id"]})
        return True

    def push(self, obs: dict, orders: list, min_army: int,
             exclude: tuple[str, ...] = ()) -> None:
        army = self.army(obs, exclude)
        if len(army) < min_army:
            return
        for u in army:
            so = u.get("standing_order") or {}
            if so.get("type") in ("attack", "attack_move"):
                continue
            self.attack_move(obs, orders, u)

    def raid_camp(self, obs: dict, orders: list, min_army: int = 4) -> bool:
        """Loot the nearest neutral camp with a small army (+80E/+80M)."""
        army = self.army(obs)
        camps = [c for c in (obs.get("camps") or []) if not c.get("hostile_to_you")]
        if len(army) < min_army or not camps:
            return False
        camp = self.nearest(army[0]["x"], army[0]["y"], camps)
        for u in army:
            so = u.get("standing_order") or {}
            if so.get("type") != "attack":
                orders.append({"actor_id": u["id"], "type": "attack", "target_id": camp["id"]})
        return True

    def scout(self, obs: dict, orders: list) -> None:
        """The starting striker tours the map until something hostile shows up
        (AoE2 scout cavalry): home -> quarter points -> enemy corner -> home."""
        strikers = self.units(obs, "striker")
        if len(strikers) != 1 or self.enemies(obs):
            return
        s = strikers[0]
        so = s.get("standing_order") or {}
        size = obs["visible_map"]["size"]
        hx, hy = self.base_center(obs)
        ex, ey = self.enemy_corner(obs)
        legs = [(size // 2, size // 2), (hx, ey), (ex, hy), (ex, ey), (hx, hy)]
        if so.get("type") == "move":
            return
        target = legs[self.scout_leg % len(legs)]
        self.scout_leg += 1
        orders.append({"actor_id": s["id"], "type": "move", "to": [target[0], target[1]]})

    # ---------------------------------------------------------------- interface
    def act(self, obs: dict) -> list[dict]:  # pragma: no cover - overridden
        return []


def make_bot(name: str, player_id: int, seed: int = 0) -> Bot:
    from cero_engine.bots import BOTS
    return BOTS[name](player_id, seed)
