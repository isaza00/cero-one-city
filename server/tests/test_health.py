from cero_engine import ENGINE_VERSION


def test_engine_importable_from_server() -> None:
    assert ENGINE_VERSION


def test_settings_defaults() -> None:
    from app.settings import Settings

    s = Settings(_env_file=None)
    assert s.practice_model == "claude-haiku-4-5"
    assert s.env == "dev"
