from cero_engine import ENGINE_VERSION
from cero_engine.cli import main
from cero_engine.rules import MAX_TURNS, RULESET_VERSION


def test_versions() -> None:
    assert ENGINE_VERSION
    assert RULESET_VERSION
    assert MAX_TURNS == 80


def test_cli_version_exits_zero() -> None:
    assert main(["--version"]) == 0
