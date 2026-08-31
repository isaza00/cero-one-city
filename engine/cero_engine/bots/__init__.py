"""Deterministic scripted bots for tests, golden replays and the balance harness."""

from cero_engine.bots.base import Bot, make_bot
from cero_engine.bots.boom import BoomBot
from cero_engine.bots.random_bot import RandomBot
from cero_engine.bots.rush import RushBot
from cero_engine.bots.turtle import TurtleBot

BOTS = {"random": RandomBot, "rush": RushBot, "boom": BoomBot, "turtle": TurtleBot}

__all__ = ["Bot", "BOTS", "make_bot", "RandomBot", "RushBot", "BoomBot", "TurtleBot"]
