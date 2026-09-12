"""Shared auth dependency for REST routes - reads a bearer token from the
Authorization header and resolves it to a user id via the in-memory session
store (see store.py)."""

from __future__ import annotations

from fastapi import Header, HTTPException

from app.social import store


def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid Authorization header")
    token = authorization[len("Bearer ") :].strip()
    user_id = store.get_user_id_for_token(token)
    if user_id is None:
        raise HTTPException(401, "Invalid or expired session")
    return user_id
