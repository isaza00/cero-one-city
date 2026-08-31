"""FastAPI auth dependencies."""

from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import decode_access_token
from app.db import get_db
from app.db.models import User


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, detail={"code": "unauthorized", "message": "missing token"})
    payload = decode_access_token(auth[7:])
    if payload is None:
        raise HTTPException(401, detail={"code": "unauthorized", "message": "invalid token"})
    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None or user.banned_at is not None:
        raise HTTPException(401, detail={"code": "unauthorized", "message": "unknown user"})
    return user


async def get_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, detail={"code": "forbidden", "message": "admin only"})
    return user


async def get_owned_agent(agent_id: uuid.UUID, user: User, db: AsyncSession):
    from app.db.models import Agent
    agent = (await db.execute(select(Agent).where(Agent.id == agent_id))).scalar_one_or_none()
    if agent is None or agent.deleted_at is not None:
        raise HTTPException(404, detail={"code": "not_found", "message": "agent not found"})
    if agent.owner_id != user.id and user.role != "admin":
        raise HTTPException(403, detail={"code": "forbidden", "message": "not your agent"})
    return agent
