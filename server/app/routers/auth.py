"""Auth endpoints: register, login, rotating refresh, logout, /me."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.auth.security import (
    hash_password,
    hash_token,
    make_access_token,
    new_refresh_token,
    verify_password,
)
from app.db import get_db
from app.db.models import AuthSession, Notification, User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=2, max_length=80)


class LoginBody(BaseModel):
    email: EmailStr
    password: str


class RefreshBody(BaseModel):
    refresh_token: str


def _user_out(user: User) -> dict:
    return {"id": str(user.id), "email": user.email, "display_name": user.display_name,
            "role": user.role, "practice_remaining": user.practice_remaining}


async def _issue_tokens(db: AsyncSession, user: User) -> dict:
    raw, digest, expires = new_refresh_token()
    db.add(AuthSession(user_id=user.id, refresh_token_hash=digest, expires_at=expires))
    await db.commit()
    return {"user": _user_out(user), "access_token": make_access_token(user.id, user.role),
            "refresh_token": raw}


@router.post("/register")
async def register(body: RegisterBody, db: AsyncSession = Depends(get_db)) -> dict:
    email = body.email.lower()
    exists = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if exists is not None:
        raise HTTPException(409, detail={"code": "email_taken",
                                         "message": "that email is already registered"})
    user = User(email=email, password_hash=hash_password(body.password),
                display_name=body.display_name)
    db.add(user)
    await db.flush()
    db.add(Notification(user_id=user.id, type="welcome",
                        payload={"message": "Welcome to Cero One City. You have 3 free "
                                            "practice matches."}))
    return await _issue_tokens(db, user)


@router.post("/login")
async def login(body: LoginBody, db: AsyncSession = Depends(get_db)) -> dict:
    email = body.email.lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, detail={"code": "bad_credentials",
                                         "message": "wrong email or password"})
    if user.banned_at is not None:
        raise HTTPException(403, detail={"code": "banned", "message": "account banned"})
    user.last_login_at = datetime.now(timezone.utc)
    return await _issue_tokens(db, user)


@router.post("/refresh")
async def refresh(body: RefreshBody, db: AsyncSession = Depends(get_db)) -> dict:
    digest = hash_token(body.refresh_token)
    session = (await db.execute(select(AuthSession).where(
        AuthSession.refresh_token_hash == digest,
        AuthSession.revoked_at.is_(None)))).scalar_one_or_none()
    if session is None or session.expires_at < datetime.now(timezone.utc):
        raise HTTPException(401, detail={"code": "bad_refresh",
                                         "message": "invalid refresh token"})
    session.revoked_at = datetime.now(timezone.utc)  # rotation
    user = await db.get(User, session.user_id)
    if user is None or user.banned_at is not None:
        raise HTTPException(401, detail={"code": "unauthorized", "message": "unknown user"})
    return await _issue_tokens(db, user)


@router.post("/logout", status_code=204)
async def logout(body: RefreshBody, db: AsyncSession = Depends(get_db)) -> None:
    digest = hash_token(body.refresh_token)
    session = (await db.execute(select(AuthSession).where(
        AuthSession.refresh_token_hash == digest))).scalar_one_or_none()
    if session is not None:
        session.revoked_at = datetime.now(timezone.utc)
        await db.commit()


@router.get("/me")
async def me(user: User = Depends(get_current_user),
             db: AsyncSession = Depends(get_db)) -> dict:
    unread = (await db.execute(select(func.count(Notification.id)).where(
        Notification.user_id == user.id, Notification.read_at.is_(None)))).scalar_one()
    return {**_user_out(user), "unread_notifications": int(unread)}


class MeBody(BaseModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=80)
    old_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=128)


@router.patch("/me")
async def patch_me(body: MeBody, user: User = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)) -> dict:
    if body.display_name:
        user.display_name = body.display_name
    if body.new_password:
        if not body.old_password or not verify_password(body.old_password,
                                                        user.password_hash):
            raise HTTPException(403, detail={"code": "bad_credentials",
                                             "message": "wrong current password"})
        user.password_hash = hash_password(body.new_password)
    await db.commit()
    return _user_out(user)


@router.get("/sessions")
async def list_sessions(user: User = Depends(get_current_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(AuthSession).where(
        AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None))
        .order_by(AuthSession.created_at.desc()))).scalars().all()
    return {"sessions": [{"id": str(s.id), "created_at": s.created_at.isoformat(),
                          "expires_at": s.expires_at.isoformat()} for s in rows]}


@router.post("/sessions/{session_id}/revoke", status_code=204)
async def revoke_session(session_id: str, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)) -> None:
    import uuid as _uuid
    session = await db.get(AuthSession, _uuid.UUID(session_id))
    if session is not None and session.user_id == user.id:
        session.revoked_at = datetime.now(timezone.utc)
        await db.commit()
