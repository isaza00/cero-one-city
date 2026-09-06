"""Control modes: how much the owner steers the agent during ONE match. Picked
per seat when a match is started or joined (practice, queue, custom invite,
remote queue_join), never changed mid-match.

manual     - the owner plays THROUGH the agent: it only carries out chat
             instructions and never acts on its own initiative.
copilot    - the agent plays by itself and the owner may steer it from the chat
             (the original behaviour).
autonomous - the agent plays alone; the chat is closed for the whole match.
"""

from __future__ import annotations

from fastapi import HTTPException

MODES = ("manual", "copilot", "autonomous")
DEFAULT_MODE = "copilot"


def require_mode(value: str | None) -> str:
    """Validate a mode coming from a request body (None -> the default)."""
    if value is None:
        return DEFAULT_MODE
    if value not in MODES:
        raise HTTPException(422, detail={"code": "bad_mode",
                                         "message": "mode: manual | copilot | autonomous"})
    return value


def chat_open(mode: str) -> bool:
    """Whether the owner may send messages to the agent in this mode."""
    return mode != "autonomous"


def match_shout_limit(mode: str, default_limit: int, max_turns: int) -> int:
    """Manual mode's chat IS the controller: one message per turn, every turn."""
    return max_turns if mode == "manual" else default_limit


def counts_as_intervention(mode: str) -> bool:
    """Copilot messages are interventions on an agent that plays by itself and
    count toward the season budget; in manual mode the human plays by design."""
    return mode == "copilot"
