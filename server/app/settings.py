from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://cero:cero@localhost:5432/cero"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "dev-secret"
    master_key: str = "ZGV2LW1hc3Rlci1rZXktMzItYnl0ZXMtYmFzZTY0PT0="  # dev only
    env: str = "dev"

    access_token_minutes: int = 15
    refresh_token_days: int = 30

    # Practice matches (paid by the game) and house agents.
    practice_provider: str = "anthropic"
    practice_model: str = "claude-haiku-4-5"
    practice_api_key: str = ""
    practice_daily_budget_usd: int = 10
    house_provider: str = "anthropic"
    house_model_cheap: str = "claude-haiku-4-5"
    house_model_strong: str = "claude-sonnet-5"
    house_api_key: str = ""
    house_daily_budget_usd: int = 5

    # Match pacing: minimum wall-clock seconds per turn (0 for tests/dev).
    min_turn_seconds: int = 0
    # Default per-agent spend caps (cents), overridable per agent config.
    default_match_cap_cents: int = 100
    default_day_cap_cents: int = 500

    admin_email: str = "admin@cero-one.city"  # .local is rejected by email validation
    admin_password: str = "admin-dev-password"

    sentry_dsn: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
