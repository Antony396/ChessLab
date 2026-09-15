"""Ambient bot accounts, wandering the Commons so it doesn't look empty the
moment the game launches. Deliberately simple: no chat, no real behavior -
just a handful of fixed identities that take a random step (or stand still)
on their own independent timer, forever, using the exact same presence
machinery a real connection does (see store.py's add_bot_connection) so
nothing about rendering a room's occupants needs to know these aren't real
players. Not surfaced anywhere outside presence - a bot has no real account
row, can't be friended, can't be challenged, can't show up in search.
"""

from __future__ import annotations

import asyncio
import random

from app.social import store
from app.social.store import COMMONS_DORM_ID

# A conservative rectangle well inside the Commons' painted oval (see
# frontend's useHubState.js - HUB_COLS=15/HUB_ROWS=8 grid, ellipse-shaped
# playable area, COMMONS_EXIT_TILE at (7,1)) - safely clear of the walls,
# the exit door, and any future furniture near the room's edges, without
# needing to duplicate that ellipse math here just for an ambient wander.
_MIN_X, _MAX_X = 3, 11
_MIN_Y, _MAX_Y = 3, 6

_DIRECTIONS = [(0, -1, "up"), (0, 1, "down"), (-1, 0, "left"), (1, 0, "right")]

# Username + skin per bot - skin keys must match KING_SKINS in
# frontend/src/customGame/skinStore.js; an unrecognized key just falls back
# to the classic skin there, so this is never a hard dependency.
BOTS = [
    {"user_id": "bot-knightwalker", "username": "Knightwalker", "skin": "darkKnight", "start": (5, 4)},
    {"user_id": "bot-rookieone", "username": "RookieOne", "skin": "classic", "start": (9, 4)},
    {"user_id": "bot-pawnstar", "username": "PawnStar", "skin": "royal", "start": (7, 5)},
]


async def _broadcast_bot_move(conn: store.PresenceConnection) -> None:
    for peer in store.connections_in_dorm(COMMONS_DORM_ID, exclude_connection_id=conn.id):
        if peer.websocket is None:
            continue  # another bot - nothing to send to
        try:
            await peer.websocket.send_json(
                {"type": "peer_move", "user_id": conn.user_id, "x": conn.x, "y": conn.y, "facing": conn.facing, "skin": conn.skin}
            )
        except Exception:
            pass


async def _wander_forever(conn: store.PresenceConnection) -> None:
    while True:
        # Staggered per-bot timing (not a fixed interval) so several bots
        # never all hop in visible lockstep - each one is just its own
        # independent loop with a randomized pause.
        await asyncio.sleep(random.uniform(1.8, 4.0))
        # About 1 in 3 ticks, just stand still - constant motion reads as
        # jittery/robotic, occasional pauses read as more natural.
        if random.random() < 0.33:
            continue
        dx, dy, facing = random.choice(_DIRECTIONS)
        next_x = max(_MIN_X, min(_MAX_X, conn.x + dx))
        next_y = max(_MIN_Y, min(_MAX_Y, conn.y + dy))
        if (next_x, next_y) == (conn.x, conn.y):
            continue  # would've walked into the rectangle's own edge
        conn.x, conn.y, conn.facing = next_x, next_y, facing
        await _broadcast_bot_move(conn)


def start_wandering() -> None:
    """Called once at app startup (see main.py) - registers every bot as a
    permanent Commons occupant and kicks off its own independent wander
    loop as a background task for the life of the process."""
    for bot in BOTS:
        start_x, start_y = bot["start"]
        conn = store.add_bot_connection(
            user_id=bot["user_id"],
            username=bot["username"],
            skin=bot["skin"],
            x=start_x,
            y=start_y,
            viewing_dorm_of=COMMONS_DORM_ID,
        )
        asyncio.create_task(_wander_forever(conn))
