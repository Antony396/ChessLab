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

# A sentinel "dorm" id (never a real account id, which are always hex
# uuids) representing the shared Commons area - a single room every
# connected user can walk into together, unlike every other dorm here
# which belongs to exactly one account. Lives here (rather than in
# social_routes.py, where it was originally added) so both the presence
# route and bots.py's wandering task can import the one real definition
# instead of each keeping their own copy in sync by hand.
COMMONS_DORM_ID = "__commons__"

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
    # Whose dorm this connection is currently rendered in - starts as their
    # own, changes when they "visit" a friend's.
    viewing_dorm_of: str
    # None for a bot connection (see add_bot_connection) - it has nowhere
    # real to receive a broadcast, so every send site already has to check
    # for that (see social/bots.py) before it can appear in anyone's
    # occupant list at all otherwise.
    websocket: Optional[WebSocket] = None
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


def add_bot_connection(user_id: str, username: str, skin: str, x: float, y: float, viewing_dorm_of: str) -> PresenceConnection:
    """A permanent, websocket-less presence entry - see social/bots.py.
    Reuses this exact same store (and so the exact same dorm_snapshot/
    peer_move machinery a real connection goes through) rather than a
    separate bot-only list, so nothing about rendering a room's occupants
    needs to know or care that some of them aren't real connections."""
    conn = PresenceConnection(
        id=f"bot-conn-{user_id}", user_id=user_id, username=username, viewing_dorm_of=viewing_dorm_of, x=x, y=y, skin=skin
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
