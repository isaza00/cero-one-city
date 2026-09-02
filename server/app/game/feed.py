"""Server-generated feed: engine events -> one English line per agent per turn,
plus highlight extraction. Agents never publish free text (moderation solved by
construction, PLAN.md §14.1)."""

from __future__ import annotations

HIGHLIGHT_KINDS = ("treason", "truce_accepted", "truce_broken", "joint_pact",
                   "core_stage", "core_destroyed", "eliminated", "capture_success",
                   "colossus_fused", "camp_looted", "camp_recruited", "core_founded",
                   "firmware")

# Priority of the single line each player gets for the turn (first match wins).
_PRIORITY = ("eliminated", "core_destroyed", "core_founded", "capture_success",
             "colossus_fused", "camp_looted", "camp_recruited", "treason", "truce_broken",
             "joint_pact", "truce_accepted", "firmware", "blackout", "unit_killed",
             "building_destroyed", "rack_destroyed", "tech_done", "built")

_BUILDING_LABEL = {
    "core": "core", "cocoon": "cocoon farm", "rack": "rack", "depot": "depot",
    "assembler": "assembler", "lab": "lab", "turret": "turret", "wall": "wall",
}


def _label(building: str) -> str:
    return _BUILDING_LABEL.get(building, building.replace("_", " "))


def _a(noun: str) -> str:
    """'a rack' / 'an assembler'."""
    return f"an {noun}" if noun[:1] in "aeiou" else f"a {noun}"


def _line(event: dict, names: dict[int, str]) -> str | None:
    t = event["type"]
    n = names.get

    def name(pid) -> str:
        if pid is None:
            return "the wasteland"
        return n(pid, f"P{pid}")

    if t == "eliminated":
        cause = "abandoned the match" if event.get("cause") == "abandon" \
            else "lost its last core and is eliminated"
        return f"{name(event['player'])} {cause}."
    if t == "core_destroyed":
        by = event.get("by")
        what = "core foundation" if event.get("site") else "core"
        if by is not None and by != event["player"]:
            return f"{name(by)} destroyed a {what} of {name(event['player'])}!"
        return f"A {what} of {name(event['player'])} collapsed."
    if t == "core_founded":
        return f"{name(event['player'])} founded its city at ({event['x']},{event['y']})."
    if t == "core_stage":
        stage = {"cracks": "is cracking", "fire": "is on fire"}[event["stage"]]
        return f"The core of {name(event['player'])} {stage}."
    if t == "capture_success":
        return f"{name(event['by'])} captured a rack from {name(event['from_player'])}."
    if t == "colossus_fused":
        return f"{name(event['player'])} fused five strikers into a COLOSSUS."
    if t == "camp_looted":
        return (f"{name(event['by'])} looted a human camp "
                f"(+{event['energy']}E/+{event['metal']}M) - its guards want revenge.")
    if t == "camp_recruited":
        return f"{name(event['by'])} recruited {event['humans']} humans from a camp."
    if t == "treason":
        return f"TREASON: {name(event['by'])} turned on {name(event['against'])}."
    if t == "truce_broken":
        return f"{name(event['by'])} broke the truce with {name(event['against'])}."
    if t == "truce_break_announced":
        return f"{name(event['by'])} announced it will break the truce with {name(event['against'])}."
    if t == "joint_pact":
        return (f"{name(event['a'])} and {name(event['b'])} agreed to attack "
                f"{name(event['against'])} together.")
    if t == "truce_accepted":
        return f"{name(event['a'])} and {name(event['b'])} agreed to a truce."
    if t == "firmware":
        return f"{name(event['player'])} advanced to firmware {event['firmware']}."
    if t == "tech_done":
        return f"{name(event['player'])} researched {event['tech'].replace('_', ' ')}."
    if t == "blackout":
        return f"Blackout at {name(event['player'])}: {event['units']} units froze stiff."
    if t == "built":
        return f"{name(event['player'])} finished {_a(_label(event['building']))}."
    if t in ("building_destroyed", "rack_destroyed"):
        by = event.get("by")
        what = _label(event.get("building", "rack"))
        if by is not None and by != event.get("owner"):
            return f"{name(by)} razed {_a(what)} of {name(event['owner'])}."
        return None
    if t == "unit_killed":
        by = event.get("by")
        if by is not None and by != event.get("owner"):
            return (f"{name(by)} destroyed a {event['unit_type'].replace('_', ' ')} "
                    f"of {name(event['owner'])}.")
        return None
    return None


def _squad(types: list[str]) -> str:
    """'3 strikers + 1 launcher' (top two types), or 'N units' for a mixed mob."""
    counts: dict[str, int] = {}
    for t in types:
        counts[t] = counts.get(t, 0) + 1
    top = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    if len(top) > 2:
        return f"{len(types)} units"
    def one(t: str, n: int) -> str:
        label = t.replace("_", " ")
        return f"{n} {label}s" if n > 1 else f"a {label}"
    return " + ".join(one(t, n) for t, n in top)


# Gather targets, by what the tile holds: (verb-plural, verb-singular, label, res)
_GATHER_KINDS = {
    "vein": ("mine", "mines", "the metal vein", "metal"),
    "pod": ("harvest", "harvests", "the human pods", "energy"),
    "scrap": ("salvage", "salvages", "the chatarra", "scrap"),
    "rubble": ("clear", "clears", "the rubble", "scrap"),
    "cocoon": ("farm", "farms", "the cocoons", "energy"),
    "field": ("work", "works", "the field", "energy"),
}


def render_orders(orders_by_player: dict[int, list], names: dict[int, str],
                  agent_ids: dict[int, str], state) -> list[dict]:
    """One 'commands' line per player narrating the NEW orders it issued this
    turn (standing orders continue silently), plus a structured `viz` list the
    client turns into portraits + action icon + target (and map flashes).
    Call BEFORE advance so actors and targets resolve against the pre-turn state."""

    def ent(i):
        try:
            return state.ent(int(i))
        except (TypeError, ValueError):
            return None

    try:
        occ = state.occupancy()
    except Exception:
        occ = {}

    def gather_kind(x: int, y: int) -> str:
        try:
            terrain = state.tiles[y][x]
        except (IndexError, TypeError):
            return "field"
        if terrain in ("vein", "pod", "rubble"):
            return terrain
        if f"{x},{y}" in getattr(state, "scrap", {}):
            return "scrap"
        holder = ent(occ.get((x, y)))
        if holder is not None and holder.type == "cocoon":
            return "cocoon"
        return "field"

    out: list[dict] = []
    for pid in sorted(k for k in orders_by_player if k >= 0):
        orders = orders_by_player[pid]
        if not isinstance(orders, list):
            continue
        has_core = any(e.is_building and e.type == "core" and e.owner == pid
                       for e in state.entities_sorted())
        # group key -> {action, types[], ids[], target}
        grouped: dict[tuple, dict] = {}
        singles: list[dict] = []

        def add(key, action, atype, aid, target):
            gr = grouped.setdefault(key, {"action": action, "types": [], "ids": [],
                                          "target": target})
            gr["types"].append(atype)
            if isinstance(aid, int):
                gr["ids"].append(aid)

        for o in orders:
            if not isinstance(o, dict):
                continue
            t = o.get("type")
            aid = o.get("actor_id")
            actor = ent(aid)
            atype = actor.type if actor is not None else "unit"
            to = o.get("to")
            has_to = isinstance(to, list) and len(to) == 2
            if t == "move" and has_to:
                add(("move", to[0], to[1]), "move", atype, aid,
                    {"kind": "tile", "x": to[0], "y": to[1]})
            elif t == "attack_move" and has_to:
                add(("push", to[0], to[1]), "push", atype, aid,
                    {"kind": "tile", "x": to[0], "y": to[1]})
            elif t == "attack" and o.get("target_id") is not None:
                target = ent(o["target_id"])
                tv = {"kind": "unit" if target is not None and target.is_unit
                      else "building",
                      "type": target.type if target is not None else None,
                      "owner": target.owner if target is not None else None,
                      "id": o["target_id"]}
                add(("attack", o["target_id"]), "attack", atype, aid, tv)
            elif t == "gather" and isinstance(o.get("target"), list) \
                    and len(o["target"]) == 2:
                gx, gy = o["target"]
                kind = gather_kind(gx, gy) if isinstance(gx, int) and isinstance(gy, int) \
                    else "field"
                add(("gather", kind), "gather", atype, aid,
                    {"kind": "terrain", "terrain": kind, "x": gx, "y": gy,
                     "res": _GATHER_KINDS[kind][3], "label": _GATHER_KINDS[kind][2]})
            elif t == "produce" and o.get("unit"):
                singles.append({"action": "produce", "types": [atype], "ids": [],
                                "target": {"kind": "unit", "type": str(o["unit"]),
                                           "owner": pid}})
            elif t == "build" and o.get("target_id") is not None:
                # Joining a crew: the target is the existing foundation.
                site = ent(o["target_id"])
                btype = site.type if site is not None else "site"
                add(("build", o["target_id"]), "build", atype, aid,
                    {"kind": "building", "type": str(btype), "owner": pid,
                     "id": o["target_id"],
                     "x": site.x if site is not None else None,
                     "y": site.y if site is not None else None})
            elif t == "build" and o.get("building"):
                anchor = o.get("anchor")
                ax, ay = (anchor if isinstance(anchor, list) and len(anchor) == 2
                          else (None, None))
                action = "found" if (o["building"] == "core" and not has_core) else "build"
                add(("build", str(o["building"]), ax, ay), action, atype, aid,
                    {"kind": "building", "type": str(o["building"]), "owner": pid,
                     "x": ax, "y": ay})
            elif t == "research" and o.get("tech"):
                singles.append({"action": "research", "types": [atype], "ids": [],
                                "target": {"kind": "tech", "type": str(o["tech"])}})
            elif t == "rally" and has_to:
                singles.append({"action": "rally", "types": [atype], "ids": [],
                                "target": {"kind": "tile", "x": to[0], "y": to[1]}})
            elif t in ("fuse", "recruit", "capture"):
                singles.append({"action": t, "types": [atype],
                                "ids": [aid] if isinstance(aid, int) else [],
                                "target": None})
            elif t == "diplomacy" and o.get("action"):
                singles.append({"action": "diplomacy", "types": [],
                                "ids": [], "target": {"kind": "diplomacy",
                                                      "type": str(o["action"])}})

        groups = sorted(grouped.values(), key=lambda g: -len(g["types"])) + singles
        if not groups:
            continue

        parts: list[str] = []
        viz: list[dict] = []
        for gr in groups[:4]:
            types, tv, action = gr["types"], gr["target"], gr["action"]
            plural = len(types) > 1
            squad = _squad(types) if types else ""
            if action == "move":
                parts.append(f"{squad} {'move' if plural else 'moves'} to "
                             f"({tv['x']},{tv['y']})")
            elif action == "push":
                parts.append(f"{squad} {'push' if plural else 'pushes'} toward "
                             f"({tv['x']},{tv['y']})")
            elif action == "attack":
                if tv.get("type") is None:
                    desc = "a target"
                elif tv.get("owner") is not None and tv["owner"] >= 0 \
                        and tv["owner"] != pid:
                    desc = (f"{names.get(tv['owner'], 'P' + str(tv['owner']))}'s "
                            f"{tv['type'].replace('_', ' ')}")
                else:
                    desc = f"a {tv['type'].replace('_', ' ')}"
                parts.append(f"{squad} {'attack' if plural else 'attacks'} {desc}")
            elif action == "gather":
                verbs = _GATHER_KINDS[tv["terrain"]]
                parts.append(f"{squad} {verbs[0] if plural else verbs[1]} {verbs[2]}")
            elif action == "produce":
                parts.append(f"trains a {tv['type'].replace('_', ' ')}")
            elif action == "found":
                where = f" at ({tv['x']},{tv['y']})" if tv.get("x") is not None else ""
                parts.append(f"{squad} {'found' if plural else 'founds'} the city{where}")
            elif action == "build":
                where = f" at ({tv['x']},{tv['y']})" if tv.get("x") is not None else ""
                verb = "build" if plural else "builds"
                parts.append(f"{squad} {verb} {_a(_label(tv['type']))}{where}")
            elif action == "research":
                parts.append(f"researches {tv['type'].replace('_', ' ')}")
            elif action == "rally":
                parts.append(f"sets a rally point at ({tv['x']},{tv['y']})")
            elif action == "fuse":
                parts.append("fuses five strikers into a colossus")
            elif action == "recruit":
                parts.append("recruits a human camp")
            elif action == "capture":
                parts.append("moves to capture a rack")
            elif action == "diplomacy":
                parts.append(tv["type"].replace("_", " "))
            # compact actors: [[type, count], ...]
            counts: dict[str, int] = {}
            for ty in types:
                counts[ty] = counts.get(ty, 0) + 1
            viz.append({"action": action,
                        "actors": sorted(counts.items(), key=lambda kv: -kv[1]),
                        "actor_ids": gr["ids"][:10], "target": tv})

        if len(groups) > 4:
            parts.append("…")
        out.append({"agent_id": agent_ids.get(pid), "player_index": pid,
                    "kind": "orders", "text": "orders: " + " · ".join(parts),
                    "viz": viz})
    return out


def render_feed(events: list[dict], names: dict[int, str],
                agent_ids: dict[int, str]) -> list[dict]:
    """One line per player (highest-priority event) plus neutral global lines."""
    per_player: dict[int, dict] = {}
    global_lines: list[dict] = []
    kills: dict[int, int] = {}

    for event in events:
        if event["type"] == "unit_killed" and event.get("by") is not None \
                and event.get("by") != event.get("owner"):
            kills[event["by"]] = kills.get(event["by"], 0) + 1

    for prio, kind in enumerate(_PRIORITY):
        for event in events:
            if event["type"] != kind:
                continue
            pid = event.get("player", event.get("by", event.get("a")))
            if pid is None or pid < 0:
                continue
            if pid in per_player and per_player[pid]["prio"] <= prio:
                continue
            if kind == "unit_killed" and kills.get(pid, 0) > 1:
                text = f"{names.get(pid, f'P{pid}')} destroyed {kills[pid]} enemy units."
            else:
                text = _line(event, names)
            if text:
                per_player[pid] = {"prio": prio, "text": text, "kind": kind}

    feed = [{"agent_id": agent_ids.get(pid), "player_index": pid,
             "text": item["text"], "kind": item["kind"]}
            for pid, item in sorted(per_player.items())]
    feed.extend(global_lines)
    return feed


def extract_highlights(turn_number: int, events: list[dict],
                       names: dict[int, str]) -> list[dict]:
    out = []
    for event in events:
        if event["type"] in HIGHLIGHT_KINDS:
            text = _line(event, names)
            out.append({"turn": turn_number, "kind": event["type"],
                        "text": text or event["type"], "data": event})
    return out
