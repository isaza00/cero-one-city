"""Agent level: XP thresholds and the 'bigger mind' effects (PLAN.md §7.2).

Levels never grant better units; they grant seconds, history, map detail,
diplomacy actions, memory book capacity and output budget (hosted only).
"""

from __future__ import annotations

XP_PER_MATCH = 10
XP_WIN_BONUS = 15

# level -> (xp_required, deadline_s, history_turns, band, book_capacity, max_tokens)
LEVELS: dict[int, tuple[int, int, int, str, int, int]] = {
    1: (0, 5, 2, "A", 5, 1000),
    2: (50, 6, 3, "A", 6, 1300),
    3: (120, 7, 3, "A", 7, 1600),
    4: (210, 8, 4, "B", 8, 1900),
    5: (320, 9, 5, "B", 10, 2200),
    6: (450, 10, 6, "B", 12, 2500),
    7: (600, 11, 7, "C", 14, 2800),
    8: (770, 12, 8, "C", 16, 3100),
    9: (960, 14, 9, "C", 18, 3500),
    10: (1170, 15, 10, "C", 20, 4000),
}

TITLES = {3: "Scrap Veteran", 5: "Tactician", 7: "Strategist", 10: "Singularity"}


def level_for_xp(xp: int) -> int:
    level = 1
    for lvl, (req, *_rest) in LEVELS.items():
        if xp >= req:
            level = lvl
    return level


def title_for_level(level: int) -> str | None:
    best = None
    for lvl, title in TITLES.items():
        if level >= lvl:
            best = title
    return best


def deadline_seconds(level: int, lineage: str) -> int:
    base = LEVELS[min(level, 10)][1]
    if lineage == "oracle":
        base = min(base + 2, 15)
    return base


def history_turns(level: int) -> int:
    return LEVELS[min(level, 10)][2]


def detail_band(level: int) -> str:
    return LEVELS[min(level, 10)][3]


def book_capacity(level: int) -> int:
    return LEVELS[min(level, 10)][4]


def max_tokens(level: int) -> int:
    return LEVELS[min(level, 10)][5]


def diplo_actions(level: int) -> list[str]:
    actions = ["propose_truce", "accept_truce", "accept_joint_attack"]
    if level >= 3:
        actions.append("break_truce")
    if level >= 4:
        actions.append("propose_joint_attack")
    return actions
