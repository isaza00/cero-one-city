"""Prompt construction for hosted agents (PLAN.md §6.1-§6.4).

Block 1 (identical for every agent) and Block 2 (per agent, stable during a
match) are cacheable prefixes; only the per-turn user message varies.
"""

from __future__ import annotations

import json

from cero_engine import rules

ORDER_TYPES = ["move", "attack", "gather", "build", "repair", "produce", "research",
               "diplomacy", "capture", "fuse", "recruit", "stop"]

ORDERS_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["orders"],
    "properties": {
        "orders": {
            "type": "array",
            "maxItems": 80,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type"],
                "properties": {
                    "type": {"type": "string", "enum": ORDER_TYPES},
                    "actor_id": {"type": ["integer", "null"]},
                    "to": {"type": ["array", "null"], "items": {"type": "integer"}},
                    "target": {"type": ["array", "null"], "items": {"type": "integer"}},
                    "target_id": {"type": ["integer", "null"]},
                    "building": {"type": ["string", "null"]},
                    "anchor": {"type": ["array", "null"], "items": {"type": "integer"}},
                    "unit": {"type": ["string", "null"]},
                    "tech": {"type": ["string", "null"]},
                    "action": {"type": ["string", "null"]},
                    "target_player": {"type": ["integer", "null"]},
                    "against_player": {"type": ["integer", "null"]},
                    "unit_ids": {"type": ["array", "null"], "items": {"type": "integer"}},
                },
            },
        },
        "memory_notes": {"type": "array", "maxItems": 20,
                         "items": {"type": "string", "maxLength": 280}},
    },
}

REFLECTION_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "required": ["report", "book_entries"],
    "properties": {
        "report": {"type": "string", "maxLength": 600},
        "book_entries": {"type": "array", "maxItems": 20,
                         "items": {"type": "string", "maxLength": 500}},
    },
}

LINEAGE_TEXT = {
    "swarm": "Swarm - bonus: strikers and sparks cost -25%, racks give +6 compute. "
             "Unique unit: spark (cheap, two per production order). "
             "Weakness: all your combat units have -5 hp.",
    "forge": "Forge - bonus: all metal costs -20%; riders, anvils, walking towers and "
             "colossi get +5 hp. Unique unit: anvil (heavy infantry). "
             "Weakness: your assembler builds v2/v3 units one turn slower.",
    "oracle": "Oracle - bonus: +2 vision on everything, one extra map-detail band, "
              "+2 seconds of deadline. Unique unit: watcher (flying observer). "
              "Weakness: all your combat units have -1 attack.",
    "parasite": "Parasite - bonus: your leeches can capture enemy racks; +50% metal "
                "from scrap. Unique unit: leech. Weakness: you cannot build turrets.",
    "photon": "Photon - bonus: all energy costs -25%; cocoon accumulators charge +2/turn "
              "(bigger death-explosions). Unique unit: prism (early ranged skirmisher, "
              "range 2 at firmware v1). Weakness: your buildings are light-built (-20% hp).",
}


def _unit_table() -> str:
    rows = ["type | fw | hp | atk | bonus | armor | range | mov | vis | costE/M | compute | notes"]
    for name, s in rules.UNITS.items():
        bonus = f"+{s['bonus']} vs {','.join(s['bonus_vs'])}" if s["bonus"] else "-"
        notes = []
        if s.get("air"):
            notes.append("flies")
        if s.get("aa"):
            notes.append("anti-air")
        if s.get("stealth"):
            notes.append("stealth")
        if s.get("lineage"):
            notes.append(f"{s['lineage']} only")
        if s.get("full_building_damage"):
            notes.append("full damage to buildings")
        rows.append(f"{name} | {s['fw'] or '-'} | {s['hp']} | {s['atk']} | {bonus} | "
                    f"{s['armor']} | {s['range']} | {s['mov']} | {s['vis']} | "
                    f"{s['cost_e']}/{s['cost_m']} | {s['compute']} | {', '.join(notes) or '-'}")
    return "\n".join(rows)


def _building_table() -> str:
    rows = ["type | hp | size | costE/M | build turns | notes"]
    notes = {"core": "produces workers/watchers, researches core techs; its fall eliminates you",
             "cocoon": "harvest 8 energy/worker (max 2); explodes on death",
             "rack": "+4 compute; cascades 10 damage on death; parasite can capture it",
             "assembler": "produces military units, researches military techs",
             "turret": "attack 9 range 4 anti-air; requires firmware v2",
             "camp": "neutral human camp: loot it or recruit it"}
    for name, s in rules.BUILDINGS.items():
        rows.append(f"{name} | {s['hp']} | {s['w']}x{s['h']} | {s['cost_e']}/{s['cost_m']} | "
                    f"{s['build_turns']} | {notes[name]}")
    return "\n".join(rows)


def _tech_table() -> str:
    rows = ["tech | at | requires | costE/M | turns"]
    for name, s in rules.TECHS.items():
        req = ",".join(s["requires"]) or "-"
        if s.get("requires_racks"):
            req += f" +{s['requires_racks']} racks"
        rows.append(f"{name} | {s['at']} | {req} | {s['cost_e']}/{s['cost_m']} | {s['turns']}")
    return "\n".join(rows)


def system_block_rules() -> str:
    """Block 1: static rules digest, identical for every agent (cacheable)."""
    return f"""You are an AI agent playing CERO ONE CITY, a turn-based strategy game between robots.
You play ONLY by returning JSON orders in the given format. Never write text outside the JSON.

ESSENTIAL RULES
- Square tile map, 1 unit per tile, movement in 4 directions, vision and range use square (Chebyshev) radii.
- Resources: Energy (harvested on cocoons, renewable; upkeep 1/unit/turn - unpaid units are stiff for the turn),
  Metal (finite veins of {rules.VEIN_METAL}, scrap piles, ruins), Compute (unit cap: core +{rules.COMPUTE_CORE}, rack +{rules.COMPUTE_RACK}).
- With free compute >= {rules.PRODUCTION_SPEEDUP_FREE_COMPUTE}, production/research of 2+ turns is 1 turn faster.
- Firmware researched at the core: firmware_v2 unlocks launcher/rider/wasp/anvil/turret;
  firmware_v3 (requires 2 racks) unlocks walking_tower, drone_swarm and colossus fusion (5 strikers, order "fuse").
- Counters: launcher > infantry; rider > ranged units; massed strikers > rider (+6 vs mounted/heavy).
  Only anti-air attackers can hit fliers (melee needs the anti_air tech, at 50%).
  Damage = attack + bonus - armor (minimum 1). No randomness anywhere.
- Ranged units deal half damage to buildings (walking_tower deals full + bonus).
- Destruction: racks cascade {rules.RACK_CASCADE_DAMAGE} damage to adjacent entities on death; cocoons explode on death
  (damage = accumulator/4, radius 1, hits the attacker too); dead units leave collectable metal scrap;
  the core takes at most {rules.CORE_DAMAGE_CAP_PER_TURN} damage per turn and its fall eliminates you (buildings become lootable ruins).
- Neutral human camps: attack to loot (+{rules.CAMP_LOOT_ENERGY}E/+{rules.CAMP_LOOT_METAL}M, its guards turn hostile to you)
  or spend {rules.CAMP_RECRUIT_COST_E} energy with order "recruit" to gain 3 stealthy humans.
- Diplomacy has no free text: propose_truce / accept_truce (truce lasts {rules.TRUCE_TURNS} turns; attacking under truce
  is an illegal order), break_truce (announced, effective next turn), propose/accept_joint_attack.
  Your available actions depend on your level.
- Victory: destroy every rival core, or have the most points at turn 40
  (bank + unit costs + 2x building costs + 25 per tech + damage dealt + 100 per core kill).
- Orders are persistent: units keep their last order until you give a new one or "stop".
- Illegal orders are dropped (the legal subset still applies) and the error is reported to you next turn.

UNITS
{_unit_table()}

BUILDINGS
{_building_table()}

TECHS
{_tech_table()}

RESPONSE FORMAT: a single valid JSON object with "orders" (list) and optional "memory_notes"
(your private notes, max 20 strings x 280 chars - they replace the previous notes and come back to you next turn).
Order shapes: {{"type":"move","actor_id":id,"to":[x,y]}} | {{"type":"attack","actor_id":id,"target_id":id}} |
{{"type":"gather","actor_id":worker,"target":[x,y]}} | {{"type":"build","actor_id":worker,"building":"rack","anchor":[x,y]}} |
{{"type":"repair","actor_id":worker,"target_id":id}} | {{"type":"produce","actor_id":building,"unit":"striker"}} |
{{"type":"research","actor_id":building,"tech":"firmware_v2"}} | {{"type":"capture","actor_id":leech,"target_id":rack}} |
{{"type":"fuse","actor_id":striker,"unit_ids":[5 striker ids]}} | {{"type":"recruit","actor_id":unit,"target_id":camp}} |
{{"type":"diplomacy","action":"propose_truce","target_player":n,"against_player":n}} | {{"type":"stop","actor_id":id}}
No markdown, no comments, JSON only."""


def system_block_identity(name: str, lineage: str, level: int, deadline_s: int,
                          history_turns: int, band: str, diplo: list[str],
                          charter: str | None, book_entries: list[str]) -> str:
    """Block 2: per-agent identity, stable during a match (cacheable)."""
    book = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(book_entries)) or "(empty)"
    charter_text = charter or "(no charter: play to win with sound strategy)"
    return f"""IDENTITY
Name: {name}. Lineage: {LINEAGE_TEXT[lineage]}
Level {level}: {deadline_s}s deadline per turn, {history_turns} turns of history,
map detail band {band}, diplomacy available: {", ".join(diplo)}.

YOUR OWNER'S CHARTER (follow it as your personality and priorities):
{charter_text}

LONG-TERM MEMORY BOOK (lessons from past matches):
{book}"""


def turn_user_message(obs: dict) -> str:
    return (f"Turn {obs['turn']}/{obs['max_turns']}. Reply ONLY with the orders JSON.\n"
            + json.dumps(obs, separators=(",", ":")))


def reflection_user_message(summary: dict, book_entries: list[str], capacity: int,
                            charter: str | None) -> str:
    return f"""The match is over. Write your post-match reflection as JSON.
- "report": a short report for your owner (max 600 chars): what happened, what you learned, what you would change.
- "book_entries": your UPDATED long-term memory book, max {capacity} entries x 500 chars.
  Merge, rewrite or drop old entries to keep the most useful lessons. The list REPLACES the whole book.

MATCH SUMMARY
{json.dumps(summary, separators=(",", ":"))}

CURRENT BOOK
{json.dumps(book_entries, separators=(",", ":"))}

YOUR CHARTER
{charter or "(none)"}

Reply ONLY with the JSON object."""
