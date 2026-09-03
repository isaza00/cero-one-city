"""All persistence tables (PLAN.md §4). Emails and agent names are normalized to
lowercase in application code instead of citext."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def created_at_col() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(16), default="user")  # user | admin
    practice_remaining: Mapped[int] = mapped_column(Integer, default=3)
    banned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    refresh_token_hash: Mapped[str] = mapped_column(String(64), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()


class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[uuid.UUID] = uuid_pk()
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(40), unique=True)
    lineage: Mapped[str] = mapped_column(String(16))  # swarm|forge|oracle|parasite
    kind: Mapped[str] = mapped_column(String(8))      # hosted | remote
    charter: Mapped[str | None] = mapped_column(Text)  # hosted only, <= 4000 chars
    charter_version: Mapped[int] = mapped_column(Integer, default=1)
    can_edit_charter: Mapped[bool] = mapped_column(Boolean, default=True)
    last_charter_edit_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    xp: Mapped[int] = mapped_column(Integer, default=0)
    level: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_queue: Mapped[bool] = mapped_column(Boolean, default=False)
    formats: Mapped[list[str]] = mapped_column(ARRAY(String(8)), default=lambda: ["1v1"])
    season_shouts_used: Mapped[int] = mapped_column(Integer, default=0)
    is_house: Mapped[bool] = mapped_column(Boolean, default=False)
    house_tier: Mapped[str | None] = mapped_column(String(12))  # rookie|veteran|elite
    title: Mapped[str | None] = mapped_column(String(40))
    avatar_variant: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created_at_col()
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApiKey(Base):
    __tablename__ = "api_keys"
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    provider: Mapped[str] = mapped_column(String(16))  # anthropic|openai|google|openrouter
    key_ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    nonce: Mapped[bytes] = mapped_column(LargeBinary)
    key_last4: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = created_at_col()
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AgentModelConfig(Base):
    __tablename__ = "agent_model_configs"
    id: Mapped[uuid.UUID] = uuid_pk()
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"), unique=True)
    provider: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(120))
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("api_keys.id"))
    temperature_x100: Mapped[int | None] = mapped_column(Integer)  # sent only if supported
    max_tokens_override: Mapped[int | None] = mapped_column(Integer)
    per_match_cap_usd_cents: Mapped[int] = mapped_column(Integer, default=100)
    per_day_cap_usd_cents: Mapped[int] = mapped_column(Integer, default=500)
    last_test_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)
    est_cost_per_match_usd_cents: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 server_default=func.now(),
                                                 onupdate=func.now())


class RemoteToken(Base):
    __tablename__ = "remote_tokens"
    id: Mapped[uuid.UUID] = uuid_pk()
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"))
    token_hash: Mapped[str] = mapped_column(String(64), index=True)  # sha256
    created_at: Mapped[datetime] = created_at_col()
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Season(Base):
    __tablename__ = "seasons"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    number: Mapped[int] = mapped_column(Integer, unique=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(12), default="active")  # upcoming|active|closed
    ruleset_version: Mapped[str] = mapped_column(String(16))
    engine_version: Mapped[str] = mapped_column(String(16))
    notes: Mapped[dict | None] = mapped_column(JSONB)  # final table snapshot on close


class Match(Base):
    __tablename__ = "matches"
    id: Mapped[uuid.UUID] = uuid_pk()
    season_id: Mapped[int | None] = mapped_column(ForeignKey("seasons.id"))
    format: Mapped[str] = mapped_column(String(10))  # 1v1|ffa3|ffa4|practice|custom
    status: Mapped[str] = mapped_column(String(10), default="forming", index=True)
    is_ranked: Mapped[bool] = mapped_column(Boolean, default=True)
    map_seed: Mapped[int] = mapped_column(BigInteger)
    map_size: Mapped[int] = mapped_column(Integer)
    max_turns: Mapped[int] = mapped_column(Integer, default=40)
    current_turn: Mapped[int] = mapped_column(Integer, default=0)
    engine_version: Mapped[str] = mapped_column(String(16))
    ruleset_version: Mapped[str] = mapped_column(String(16))
    invite_code: Mapped[str | None] = mapped_column(String(12), unique=True)
    invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resume_pending: Mapped[bool] = mapped_column(Boolean, default=False)
    summary: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = created_at_col()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class MatchPlayer(Base):
    __tablename__ = "match_players"
    __table_args__ = (UniqueConstraint("match_id", "player_index"),
                      UniqueConstraint("match_id", "agent_id"),
                      UniqueConstraint("match_id", "owner_id"))
    id: Mapped[uuid.UUID] = uuid_pk()
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"), index=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"), index=True)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    player_index: Mapped[int] = mapped_column(Integer)
    lineage: Mapped[str] = mapped_column(String(16))
    level_snapshot: Mapped[int] = mapped_column(Integer, default=1)
    deadline_ms: Mapped[int] = mapped_column(Integer, default=5000)
    status: Mapped[str] = mapped_column(String(12), default="alive")
    placement: Mapped[int | None] = mapped_column(Integer)
    score: Mapped[int | None] = mapped_column(Integer)
    elo_before: Mapped[int | None] = mapped_column(Integer)
    elo_after: Mapped[int | None] = mapped_column(Integer)
    xp_awarded: Mapped[int] = mapped_column(Integer, default=0)
    missed_streak: Mapped[int] = mapped_column(Integer, default=0)
    missed_total: Mapped[int] = mapped_column(Integer, default=0)
    eliminated_at_turn: Mapped[int | None] = mapped_column(Integer)
    shouts_used: Mapped[int] = mapped_column(Integer, default=0)


class Turn(Base):
    __tablename__ = "turns"
    __table_args__ = (UniqueConstraint("match_id", "turn_number"),
                      Index("ix_turns_match_turn", "match_id", "turn_number"))
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"))
    turn_number: Mapped[int] = mapped_column(Integer)
    state: Mapped[dict | None] = mapped_column(JSONB)  # NULL after retention pruning
    state_hash: Mapped[str] = mapped_column(String(64))
    chain_hash: Mapped[str] = mapped_column(String(64))
    orders: Mapped[dict | None] = mapped_column(JSONB)       # raw orders per player
    order_errors: Mapped[dict | None] = mapped_column(JSONB)  # rejected orders per player
    events: Mapped[list | None] = mapped_column(JSONB)
    feed: Mapped[list | None] = mapped_column(JSONB)          # rendered feed lines
    resolved_in_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created_at_col()


class MatchMemory(Base):
    __tablename__ = "match_memories"
    __table_args__ = (UniqueConstraint("match_id", "agent_id"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"))
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"))
    notes: Mapped[list] = mapped_column(JSONB, default=list)  # <= 20 strings <= 280 chars
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 server_default=func.now(),
                                                 onupdate=func.now())


class MemoryBookEntry(Base):
    __tablename__ = "memory_book_entries"
    __table_args__ = (UniqueConstraint("agent_id", "slot"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"), index=True)
    slot: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(String(500))
    source_match_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("matches.id"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 server_default=func.now(),
                                                 onupdate=func.now())


class RemoteLocker(Base):
    __tablename__ = "remote_lockers"
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"), primary_key=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)  # <= 65536 bytes
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 server_default=func.now(),
                                                 onupdate=func.now())


class Shout(Base):
    __tablename__ = "shouts"
    id: Mapped[uuid.UUID] = uuid_pk()
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"), index=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    text: Mapped[str] = mapped_column(String(200))
    created_turn: Mapped[int] = mapped_column(Integer)
    delivered_turn: Mapped[int | None] = mapped_column(Integer)
    # The agent's answer from the field (the `reply` field of its orders).
    reply_text: Mapped[str | None] = mapped_column(String(400))
    reply_turn: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = created_at_col()


class Rating(Base):
    __tablename__ = "ratings"
    __table_args__ = (UniqueConstraint("season_id", "agent_id", "format"),
                      Index("ix_ratings_board", "season_id", "format", "elo"))
    id: Mapped[uuid.UUID] = uuid_pk()
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"))
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"))
    format: Mapped[str] = mapped_column(String(8))  # 1v1 | ffa
    elo: Mapped[int] = mapped_column(Integer, default=1000)
    matches_played: Mapped[int] = mapped_column(Integer, default=0)
    wins: Mapped[int] = mapped_column(Integer, default=0)


class RatingHistory(Base):
    __tablename__ = "rating_history"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    season_id: Mapped[int] = mapped_column(ForeignKey("seasons.id"))
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"), index=True)
    format: Mapped[str] = mapped_column(String(8))
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"))
    elo_before: Mapped[int] = mapped_column(Integer)
    elo_after: Mapped[int] = mapped_column(Integer)
    delta: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = created_at_col()


class QueueEntry(Base):
    __tablename__ = "matchmaking_queue"
    id: Mapped[uuid.UUID] = uuid_pk()
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"), unique=True)
    format: Mapped[str] = mapped_column(String(8), index=True)
    elo_snapshot: Mapped[int] = mapped_column(Integer, default=1000)
    enqueued_at: Mapped[datetime] = created_at_col()
    state: Mapped[str] = mapped_column(String(10), default="waiting")


class MatchReport(Base):
    __tablename__ = "match_reports"
    __table_args__ = (UniqueConstraint("match_id", "agent_id"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"))
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"), index=True)
    report_text: Mapped[str] = mapped_column(String(1500))
    created_at: Mapped[datetime] = created_at_col()


class LlmCall(Base):
    __tablename__ = "llm_calls"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    match_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("matches.id"), index=True)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id"), index=True)
    turn_number: Mapped[int | None] = mapped_column(Integer)
    provider: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(120))
    purpose: Mapped[str] = mapped_column(String(12))  # turn|reflection|test|house|practice
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(12), default="ok")  # ok|error|timeout|malformed
    error_code: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 server_default=func.now(), index=True)


class MatchPlayerCost(Base):
    __tablename__ = "match_player_costs"
    match_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("matches.id"), primary_key=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id"), primary_key=True)
    calls: Mapped[int] = mapped_column(Integer, default=0)
    tokens_in: Mapped[int] = mapped_column(BigInteger, default=0)
    tokens_out: Mapped[int] = mapped_column(BigInteger, default=0)
    cost_usd_micros: Mapped[int] = mapped_column(BigInteger, default=0)


class ModelPrice(Base):
    __tablename__ = "model_prices"
    __table_args__ = (UniqueConstraint("provider", "model"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    provider: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(120))
    input_usd_per_mtok_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    cached_input_usd_per_mtok_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    output_usd_per_mtok_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 server_default=func.now(),
                                                 onupdate=func.now())


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user", "user_id", "read_at"),)
    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str] = mapped_column(String(24))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_col()


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True),
                                                 server_default=func.now(),
                                                 onupdate=func.now())


class HouseBudget(Base):
    __tablename__ = "house_budget"
    day: Mapped[str] = mapped_column(Date, primary_key=True)
    spent_usd_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    practice_spent_usd_micros: Mapped[int] = mapped_column(BigInteger, default=0)


class AdminAudit(Base):
    __tablename__ = "admin_audit"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    admin_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = created_at_col()
