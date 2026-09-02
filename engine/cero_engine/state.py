"""Game state model with canonical (de)serialization.

The serialized form uses only ints, strings, bools, lists and dicts with string
keys, so `hashing.py` can produce a stable canonical JSON. Entity ids are ints
in code and string keys in the serialized `entities` mapping.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from cero_engine.rules import BUILDINGS, UNITS


def tk(x: int, y: int) -> str:
    """Tile key used by dict-backed tile maps (veins, pods, scrap, last_seen)."""
    return f"{x},{y}"


def untk(key: str) -> tuple[int, int]:
    x, y = key.split(",")
    return int(x), int(y)


@dataclass
class Entity:
    id: int
    owner: int              # player index; -1 = neutral (camps and their guards)
    kind: str               # "unit" | "building"
    type: str
    x: int
    y: int
    hp: int
    stiff: bool = False     # unpaid upkeep this turn: cannot act
    heading: str | None = None            # last move direction: N/E/S/W
    revealed_until: int = 0               # stealth units: visible through this turn
    standing_order: dict | None = None    # persistent order (move/attack/gather/build/...)
    production: dict | None = None        # {"unit": str, "turns_left": int}
    research: dict | None = None          # {"tech": str, "turns_left": int}
    build_progress: int = 0               # >0: construction work points still needed
    build_total: int = 0                  # total work points of the site (progress bar)
    builder_id: int | None = None         # legacy single-builder binding (unused, kept for replays)
    cargo_e: int = 0                      # workers: energy carried toward a drop-off
    cargo_m: int = 0                      # workers: metal carried toward a drop-off
    rally: list[int] | None = None        # producers: [x, y] new units walk to
    accumulator: int = 0                  # cocoons only
    capture: dict | None = None           # {"by": player, "counter": int}
    was_captured: bool = False            # racks taken by a parasite (scores +50 if held)
    fusing: dict | None = None            # {"unit_ids": [...], "turns_left": int}
    camp_hostile_to: list[int] = field(default_factory=list)
    camp_home: list[int] | None = None    # guards: [x, y] anchor of their camp

    # ------------------------------------------------------------------ helpers
    @property
    def is_unit(self) -> bool:
        return self.kind == "unit"

    @property
    def is_building(self) -> bool:
        return self.kind == "building"

    @property
    def is_air(self) -> bool:
        return self.is_unit and bool(UNITS[self.type].get("air"))

    @property
    def is_site(self) -> bool:
        """A building still under construction (inactive, low hp)."""
        return self.is_building and self.build_progress > 0

    @property
    def is_dropoff(self) -> bool:
        return (self.is_building and not self.build_progress
                and bool(BUILDINGS[self.type].get("dropoff")))

    @property
    def cargo(self) -> int:
        return self.cargo_e + self.cargo_m

    def footprint(self) -> list[tuple[int, int]]:
        if self.is_unit:
            return [(self.x, self.y)]
        spec = BUILDINGS[self.type]
        return [(self.x + dx, self.y + dy) for dy in range(spec["h"]) for dx in range(spec["w"])]

    def to_dict(self) -> dict:
        d: dict = {
            "id": self.id, "owner": self.owner, "kind": self.kind, "type": self.type,
            "x": self.x, "y": self.y, "hp": self.hp,
        }
        if self.stiff:
            d["stiff"] = True
        if self.heading:
            d["heading"] = self.heading
        if self.revealed_until:
            d["revealed_until"] = self.revealed_until
        if self.standing_order is not None:
            d["standing_order"] = self.standing_order
        if self.production is not None:
            d["production"] = self.production
        if self.research is not None:
            d["research"] = self.research
        if self.build_progress:
            d["build_progress"] = self.build_progress
        if self.build_total:
            d["build_total"] = self.build_total
        if self.builder_id is not None:
            d["builder_id"] = self.builder_id
        if self.cargo_e:
            d["cargo_e"] = self.cargo_e
        if self.cargo_m:
            d["cargo_m"] = self.cargo_m
        if self.rally is not None:
            d["rally"] = self.rally
        if self.accumulator:
            d["accumulator"] = self.accumulator
        if self.capture is not None:
            d["capture"] = self.capture
        if self.was_captured:
            d["was_captured"] = True
        if self.fusing is not None:
            d["fusing"] = self.fusing
        if self.camp_hostile_to:
            d["camp_hostile_to"] = self.camp_hostile_to
        if self.camp_home is not None:
            d["camp_home"] = self.camp_home
        return d

    @staticmethod
    def from_dict(d: dict) -> "Entity":
        return Entity(
            id=d["id"], owner=d["owner"], kind=d["kind"], type=d["type"],
            x=d["x"], y=d["y"], hp=d["hp"],
            stiff=d.get("stiff", False),
            heading=d.get("heading"),
            revealed_until=d.get("revealed_until", 0),
            standing_order=d.get("standing_order"),
            production=d.get("production"),
            research=d.get("research"),
            build_progress=d.get("build_progress", 0),
            build_total=d.get("build_total", 0),
            builder_id=d.get("builder_id"),
            cargo_e=d.get("cargo_e", 0),
            cargo_m=d.get("cargo_m", 0),
            rally=list(d["rally"]) if d.get("rally") is not None else None,
            accumulator=d.get("accumulator", 0),
            capture=d.get("capture"),
            was_captured=d.get("was_captured", False),
            fusing=d.get("fusing"),
            camp_hostile_to=list(d.get("camp_hostile_to", [])),
            camp_home=d.get("camp_home"),
        )


@dataclass
class Player:
    id: int
    lineage: str
    energy: int
    metal: int
    techs: list[str] = field(default_factory=list)
    firmware: str = "v1"
    alive: bool = True
    founded: bool = False                 # True once the first core stands (nomad start)
    eliminated_turn: int | None = None
    eliminated_cause: str | None = None   # "core" | "abandon"
    damage_dealt: int = 0
    core_kills: int = 0
    explored: list[int] = field(default_factory=list)   # sorted packed tiles (y*size+x)
    last_seen: dict[str, dict] = field(default_factory=dict)  # tile -> {"type","owner"}

    def to_dict(self) -> dict:
        return {
            "id": self.id, "lineage": self.lineage, "energy": self.energy,
            "metal": self.metal, "techs": self.techs, "firmware": self.firmware,
            "alive": self.alive, "founded": self.founded,
            "eliminated_turn": self.eliminated_turn,
            "eliminated_cause": self.eliminated_cause,
            "damage_dealt": self.damage_dealt, "core_kills": self.core_kills,
            "explored": self.explored, "last_seen": self.last_seen,
        }

    @staticmethod
    def from_dict(d: dict) -> "Player":
        return Player(
            id=d["id"], lineage=d["lineage"], energy=d["energy"], metal=d["metal"],
            techs=list(d["techs"]), firmware=d["firmware"], alive=d["alive"],
            founded=d.get("founded", False),
            eliminated_turn=d.get("eliminated_turn"),
            eliminated_cause=d.get("eliminated_cause"),
            damage_dealt=d.get("damage_dealt", 0), core_kills=d.get("core_kills", 0),
            explored=list(d.get("explored", [])), last_seen=dict(d.get("last_seen", {})),
        )


@dataclass
class State:
    turn: int
    format: str               # "1v1" | "ffa3" | "ffa4"
    size: int
    max_turns: int
    next_entity_id: int
    tiles: list[list[str]]    # tiles[y][x] in {"plain","blocked","vein","pod","rubble"}
    veins: dict[str, int]     # tile key -> metal remaining
    scrap: dict[str, dict]    # tile key -> {"e": int, "m": int}
    players: list[Player]
    pods: dict[str, int] = field(default_factory=dict)   # tile key -> energy remaining
    entities: dict[str, Entity] = field(default_factory=dict)   # str(id) -> Entity
    diplomacy: dict = field(default_factory=lambda: {
        "truces": [], "proposals": [], "joint": [], "breaks": []})
    events_last_turn: list = field(default_factory=list)
    hash_prev: str = ""
    finished: bool = False
    winner: int | None = None

    # ------------------------------------------------------------------ access
    def ent(self, eid: int) -> Entity | None:
        return self.entities.get(str(eid))

    def add_entity(self, e: Entity) -> Entity:
        self.entities[str(e.id)] = e
        return e

    def remove_entity(self, eid: int) -> None:
        self.entities.pop(str(eid), None)

    def new_id(self) -> int:
        nid = self.next_entity_id
        self.next_entity_id += 1
        return nid

    def entities_sorted(self) -> list[Entity]:
        return [self.entities[k] for k in sorted(self.entities, key=int)]

    def units_of(self, player: int) -> list[Entity]:
        return [e for e in self.entities_sorted() if e.is_unit and e.owner == player]

    def buildings_of(self, player: int) -> list[Entity]:
        return [e for e in self.entities_sorted() if e.is_building and e.owner == player]

    def dropoffs_of(self, player: int) -> list[Entity]:
        """Finished drop-off buildings (cores and depots) of a player."""
        return [e for e in self.buildings_of(player) if e.is_dropoff]

    def in_bounds(self, x: int, y: int) -> bool:
        return 0 <= x < self.size and 0 <= y < self.size

    def occupancy(self) -> dict[tuple[int, int], int]:
        """tile -> entity id for every occupied tile (units + building footprints)."""
        occ: dict[tuple[int, int], int] = {}
        for e in self.entities_sorted():
            for t in e.footprint():
                occ[t] = e.id
        return occ

    def alive_players(self) -> list[Player]:
        return [p for p in self.players if p.alive]

    # -------------------------------------------------------------- serialize
    def to_dict(self) -> dict:
        return {
            "turn": self.turn, "format": self.format, "size": self.size,
            "max_turns": self.max_turns, "next_entity_id": self.next_entity_id,
            "tiles": self.tiles, "veins": self.veins, "pods": self.pods, "scrap": self.scrap,
            "players": [p.to_dict() for p in self.players],
            "entities": {k: e.to_dict() for k, e in sorted(self.entities.items(), key=lambda kv: int(kv[0]))},
            "diplomacy": self.diplomacy,
            "events_last_turn": self.events_last_turn,
            "hash_prev": self.hash_prev,
            "finished": self.finished, "winner": self.winner,
        }

    @staticmethod
    def from_dict(d: dict) -> "State":
        s = State(
            turn=d["turn"], format=d["format"], size=d["size"], max_turns=d["max_turns"],
            next_entity_id=d["next_entity_id"],
            tiles=[list(row) for row in d["tiles"]],
            veins=dict(d["veins"]), pods=dict(d.get("pods", {})),
            scrap={k: dict(v) for k, v in d["scrap"].items()},
            players=[Player.from_dict(p) for p in d["players"]],
            entities={k: Entity.from_dict(e) for k, e in d["entities"].items()},
            diplomacy={k: [dict(i) for i in v] for k, v in d["diplomacy"].items()},
            events_last_turn=list(d["events_last_turn"]),
            hash_prev=d["hash_prev"],
            finished=d["finished"], winner=d.get("winner"),
        )
        return s
