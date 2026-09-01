"""Server-generated feed: engine events -> one English line per agent per turn,
plus highlight extraction. Agents never publish free text (moderation solved by
construction, PLAN.md §14.1)."""

from __future__ import annotations

HIGHLIGHT_KINDS = ("treason", "truce_accepted", "truce_broken", "joint_pact",
                   "core_stage", "core_destroyed", "eliminated", "capture_success",
                   "colossus_fused", "camp_looted", "camp_recruited")

# Priority of the single line each player gets for the turn (first match wins).
_PRIORITY = ("eliminated", "core_destroyed", "capture_success", "colossus_fused",
             "camp_looted", "camp_recruited", "treason", "truce_broken", "joint_pact",
             "truce_accepted", "firmware", "blackout", "unit_killed", "tech_done",
             "built")


def _line(event: dict, names: dict[int, str]) -> str | None:
    t = event["type"]
    n = names.get

    def name(pid) -> str:
        if pid is None:
            return "the wasteland"
        return n(pid, f"P{pid}")

    if t == "eliminated":
        cause = "abandoned the match" if event.get("cause") == "abandon" \
            else "lost its core and is eliminated"
        return f"{name(event['player'])} {cause}."
    if t == "core_destroyed":
        by = event.get("by")
        if by is not None and by != event["player"]:
            return f"{name(by)} destroyed the core of {name(event['player'])}!"
        return f"The core of {name(event['player'])} collapsed."
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
        return f"{name(event['player'])} upgraded to firmware {event['firmware']}."
    if t == "tech_done":
        return f"{name(event['player'])} researched {event['tech'].replace('_', ' ')}."
    if t == "blackout":
        return f"Blackout at {name(event['player'])}: {event['units']} units froze stiff."
    if t == "built":
        return f"{name(event['player'])} finished a {event['building'].replace('_', ' ')}."
    if t == "unit_killed":
        by = event.get("by")
        if by is not None and by != event.get("owner"):
            return (f"{name(by)} destroyed a {event['unit_type'].replace('_', ' ')} "
                    f"of {name(event['owner'])}.")
        return None
    return None


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
