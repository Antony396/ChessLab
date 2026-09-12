"""In-memory session tokens and live presence - deliberately not persisted
(same tradeoff custom_chess/store.py already makes): a server restart logs
everyone out and clears who's standing where, which is fine for this app.
Accounts and friendships themselves are the persistent part (see db.py).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional

from fastapi import WebSocket

# --- Sessions: opaque token -> user_id -------------------------------------

_SESSIONS: dict[str, str] = {}


def create_session(user_id: str) -> str:
    token = uuid.uuid4().hex
    _SESSIONS[token] = user_id
    return token


def get_user_id_for_token(token: str) -> Optional[str]:
    return _SESSIONS.get(token)


def destroy_session(token: str) -> None:
    _SESSIONS.pop(token, None)


# --- Presence: who's connected, and whose dorm they're currently standing in


@dataclass
class PresenceConnection:
    id: str
    user_id: str
    username: str
    websocket: WebSocket
    # Whose dorm this connection is currently rendered in - starts as their
    # own, changes when they "visit" a friend's.
    viewing_dorm_of: str
    x: float = 0
    y: float = 0
    facing: str = "down"
    skin: str = "classic"


_CONNECTIONS: dict[str, PresenceConnection] = {}


def add_connection(user_id: str, username: str, websocket: WebSocket) -> PresenceConnection:
    conn = PresenceConnection(
        id=uuid.uuid4().hex, user_id=user_id, username=username, websocket=websocket, viewing_dorm_of=user_id
    )
    _CONNECTIONS[conn.id] = conn
    return conn


def remove_connection(connection_id: str) -> Optional[PresenceConnection]:
    return _CONNECTIONS.pop(connection_id, None)


def connections_in_dorm(owner_id: str, exclude_connection_id: Optional[str] = None) -> list[PresenceConnection]:
    return [
        c for c in _CONNECTIONS.values() if c.viewing_dorm_of == owner_id and c.id != exclude_connection_id
    ]


def is_user_online(user_id: str) -> bool:
    return any(c.user_id == user_id for c in _CONNECTIONS.values())


def connections_for_user(user_id: str) -> list[PresenceConnection]:
    return [c for c in _CONNECTIONS.values() if c.user_id == user_id]


def online_friend_ids(friend_ids: list[str]) -> set[str]:
    online = {c.user_id for c in _CONNECTIONS.values()}
    return online & set(friend_ids)
