"""Prompt construction for hosted agents (PLAN.md §6.1-§6.4).

Block 1 (identical for every agent) and Block 2 (per agent, stable during a
match) are cacheable prefixes; only the per-turn user message varies.
"""

from __future__ import annotations

import json

from cero_engine import rules

ORDER_TYPES = ["move", "attack", "attack_move", "gather", "build", "repair", "produce",
               "research", "rally", "diplomacy", "capture", "fuse", "recruit", "stop"]

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
    "forge": "Forge - bonus: all metal costs -20% (buildings too); riders, anvils, walking "
             "towers and colossi get +5 hp. Unique unit: anvil (heavy infantry). "
             "Weakness: your assembler builds v2/v3 units one turn slower.",
    "oracle": "Oracle - bonus: +2 vision on everything, one extra map-detail band, "
              "+2 seconds of deadline. Unique unit: watcher (flying observer). "
              "Weakness: all your combat units have -1 attack.",
    "parasite": "Parasite - bonus: your leeches can capture enemy racks; +50% metal "
                "from scrap. Unique unit: leech. Weakness: you cannot build turrets.",
    "photon": "Photon - bonus: all energy costs -25%; cocoon accumulators charge +2/turn "
              "(bigger death-explosions). Unique unit: prism (early ranged skirmisher, "
              "range 3 at firmware v1). Weakness: your buildings are light-built (-20% hp).",
}

_BUILDING_NOTES = {
    "core": "TOWN CENTER + drop-off: trains workers (and watchers), researches core techs and "
            "firmware; +10 compute; a second core needs firmware v2; losing your LAST core "
            "eliminates you",
    "cocoon": "FARM: 8 energy/worker/turn, max 2 workers, renewable; explodes on death; "
              "build it next to a core/depot so the harvest banks on the spot",
    "rack": "HOUSE: +4 compute (swarm +6); cascades 10 damage on death; parasite can capture it",
    "depot": "MINING CAMP / MILL: drop-off point; build it beside far veins or pods",
    "assembler": "BARRACKS/STABLE/RANGE: trains every combat unit; required for firmware v2",
    "lab": "BLACKSMITH: researches armor/cannons/actuators/optics/anti_air; required for "
           "firmware v3",
    "turret": "TOWER: attack 9 range 6 anti-air, auto-fires; requires firmware v2",
    "wall": "PALISADE: 5 metal, blocks movement; attack-move ignores it, attack it explicitly",
    "camp": "neutral human camp: loot it (+80E/+80M, guards turn hostile) or recruit it (50E)",
}


def _unit_table() -> str:
    rows = ["type | fw | hp | atk | bonus | armor | range | mov | vis | costE/M | compute | at | notes"]
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
        if s.get("pair_produced"):
            notes.append("two per order")
        rows.append(f"{name} | {s['fw'] or '-'} | {s['hp']} | {s['atk']} | {bonus} | "
                    f"{s['armor']} | {s['range']} | {s['mov']} | {s['vis']} | "
                    f"{s['cost_e']}/{s['cost_m']} | {s['compute']} | {s['prod_at'] or '-'} | "
                    f"{', '.join(notes) or '-'}")
    return "\n".join(rows)


def _building_table() -> str:
    rows = ["type | hp | size | costE/M | work | notes"]
    for name, s in rules.BUILDINGS.items():
        rows.append(f"{name} | {s['hp']} | {s['w']}x{s['h']} | {s['cost_e']}/{s['cost_m']} | "
                    f"{s['work']} | {_BUILDING_NOTES[name]}")
    return "\n".join(rows)


def _tech_table() -> str:
    rows = ["tech | at | requires | costE/M | turns"]
    for name, s in rules.TECHS.items():
        req = list(s["requires"]) + [f"finished {b}" for b in s.get("requires_buildings", ())]
        if s.get("requires_racks"):
            req.append(f"{s['requires_racks']} racks")
        rows.append(f"{name} | {s['at']} | {', '.join(req) or '-'} | "
                    f"{s['cost_e']}/{s['cost_m']} | {s['turns']}")
    return "\n".join(rows)


def system_block_rules() -> str:
    """Block 1: static rules digest, identical for every agent (cacheable)."""
    return f"""You are an AI agent playing CERO ONE CITY, an Age-of-Empires-style strategy game between robots.
You play ONLY by returning JSON orders in the given format. Never write text outside the JSON.

THE GAME IN ONE BREATH (think Age of Empires II)
- NOMAD START: you own NO buildings. You have {rules.START_WORKERS} workers and {rules.START_ESCORTS} striker, {rules.STARTING_ENERGY} energy and {rules.STARTING_METAL} metal.
  Your first job is to FOUND YOUR CITY: order every worker to build a "core" (the town center, {rules.BUILDINGS['core']['cost_m']} metal).
  The observation's menus.build entry for "core" carries a "suggested_anchor": a free 2x2 spot next to pods and a vein.
- ENERGY is food. It comes from wild PODS (capsules of dormant humans scattered on the map, {rules.POD_ENERGY} energy each,
  {rules.POD_ENERGY_RATE}/worker/turn, finite) and later from COCOONS you build (farms: {rules.HARVEST_ENERGY}/worker/turn, max 2 workers, renewable).
  Workers cost {rules.UNITS['worker']['cost_e']} energy at the core. Every combat unit costs {rules.UPKEEP_PER_UNIT} energy per turn of upkeep; unpaid ones freeze stiff.
- METAL is gold: finite veins ({rules.VEIN_METAL} each, {rules.MINE_METAL}/worker/turn), scrap left by dead robots, ruins. Every building costs metal.
- DROP-OFFS: a worker carries up to {rules.CARRY_CAPACITY} of what it gathers and must bank it at a core or a depot. A worker standing
  next to BOTH the resource and a drop-off banks every turn; otherwise it walks home when full (slow). Build depots beside far
  resources and cocoons hugging the core.
- COMPUTE is population: core +{rules.COMPUTE_CORE}, rack +{rules.COMPUTE_RACK}. With free compute >= {rules.PRODUCTION_SPEEDUP_FREE_COMPUTE}, production/research of 2+ turns is 1 turn faster.
- CONSTRUCTION: "build" drops a foundation immediately (cost paid then) and sends the worker there; any number of workers can
  build together (more workers = faster, up to {rules.MAX_BUILDERS_PER_SITE}): send more with {{"type":"build","actor_id":worker,"target_id":site_id}}.
  Sites must be explored, free, plain tiles. Foundations are fragile until finished.
- AGES = FIRMWARE, researched at the core: firmware_v2 (needs a finished assembler) unlocks launcher/rider/wasp/anvil/turret and a
  second core; firmware_v3 (needs a lab and 2 racks) unlocks walking_tower, drone_swarm and colossus fusion (5 strikers, order "fuse").
- Counters: launcher > infantry; rider > ranged units; massed strikers > rider (+6 vs mounted/heavy).
  Only anti-air attackers can hit fliers (melee needs the anti_air tech, at 50%). Damage = attack + bonus - armor (minimum 1). No randomness.
- Ranged units deal half damage to buildings (walking_tower deals full + bonus).
- Destruction: racks cascade {rules.RACK_CASCADE_DAMAGE} damage to adjacent entities on death; cocoons explode on death (damage = accumulator/4,
  radius 1, hits the attacker too); dead units leave collectable metal scrap; a core takes at most {rules.CORE_DAMAGE_CAP_PER_TURN} damage per turn.
  You are eliminated when your LAST core falls (or, before founding, when your last worker dies). Ruins are lootable.
- Neutral human camps: attack to loot (+{rules.CAMP_LOOT_ENERGY}E/+{rules.CAMP_LOOT_METAL}M, its guards turn hostile to you) or spend {rules.CAMP_RECRUIT_COST_E} energy with
  order "recruit" to gain 3 stealthy humans.
- Diplomacy has no free text: propose_truce / accept_truce (truce lasts {rules.TRUCE_TURNS} turns; attacking under truce is illegal),
  break_truce (announced, effective next turn), propose/accept_joint_attack. Your available actions depend on your level.
- Victory: destroy every rival, or have the most points at turn {rules.MAX_TURNS}
  (bank + unit costs + 2x building costs + 25 per tech + damage dealt + 100 per core kill).
- Orders are persistent: units keep their last order until you give a new one or "stop". Workers step to the next tile when
  theirs runs dry, builders auto-gather when the farm/depot they built completes. Combat units auto-fire at enemies in range.
- "attack_move" is how a pro advances an army: march toward [x,y], engage anything met on the way, resume the march.
- Illegal orders are dropped (the legal subset still applies) and the error is reported to you next turn.
- READ THE MENUS: obs.menus.build / units / techs list what you can order RIGHT NOW with costs and, when locked, why.
  obs.economy.idle_workers lists workers doing nothing - an idle worker is a wasted turn (AoE2's idle villager button).

A GOOD OPENING (adapt it to your charter): found the core with all workers (turn 1-2) -> workers on the pods and the vein next
to it -> train workers nonstop -> rack when compute is short -> cocoons hugging the core when pods run low -> assembler ->
depot at the far vein -> firmware_v2 -> lab -> army -> firmware_v3 / second core.

UNITS
{_unit_table()}

BUILDINGS
{_building_table()}

TECHS
{_tech_table()}

RESPONSE FORMAT: a single valid JSON object with "orders" (list) and optional "memory_notes"
(your private notes, max 20 strings x 280 chars - they replace the previous notes and come back to you next turn).
Order shapes: {{"type":"move","actor_id":id,"to":[x,y]}} | {{"type":"attack","actor_id":id,"target_id":id}} |
{{"type":"attack_move","actor_id":id,"to":[x,y]}} |
{{"type":"gather","actor_id":worker,"target":[x,y]}} (a pod, vein, scrap, rubble or one of your cocoons) |
{{"type":"build","actor_id":worker,"building":"depot","anchor":[x,y]}} | {{"type":"build","actor_id":worker,"target_id":site_id}} (join a crew) |
{{"type":"repair","actor_id":worker,"target_id":id}} | {{"type":"produce","actor_id":building,"unit":"striker"}} |
{{"type":"research","actor_id":building,"tech":"firmware_v2"}} | {{"type":"rally","actor_id":building,"to":[x,y]}} |
{{"type":"capture","actor_id":leech,"target_id":rack}} | {{"type":"fuse","actor_id":striker,"unit_ids":[5 striker ids]}} |
{{"type":"recruit","actor_id":unit,"target_id":camp}} |
{{"type":"diplomacy","action":"propose_truce","target_player":n,"against_player":n}} | {{"type":"stop","actor_id":id}}
("stop" on a building cancels its job with a full refund.) No markdown, no comments, JSON only."""


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
