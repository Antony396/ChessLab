"""The Hero Puzzle Map: a second 50-slot progression route, structurally a
sibling of app/puzzle_map's own store.py (same MapAttempt/_ATTEMPTS shape,
same 1-indexed node_at lookup), but its nodes are hand-authored one at a
time via POST /hero-puzzle-map/nodes rather than generated up front from the
Lichess pool - see db.py's hero_puzzle_map_nodes table for the persisted
definitions. node_at returning None for an index nobody's authored yet is
expected, not an error - the route only ever exposes indices db.py reports
as authored (see hero_puzzle_map_routes.py's get_map_state).

Each node's definition is shaped exactly like DailyPuzzleCreateRequest's
custom_position + solution, same reuse of daily_puzzle_routes.py's
_build_puzzle_game as the original map relies on.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app import db
from app.custom_chess import store as game_store

MAP_LENGTH = 50


def node_at(index: int) -> dict | None:
    """1-indexed, matching how the map is shown/addressed everywhere else.
    None if nothing's been authored for this index yet."""
    if 1 <= index <= MAP_LENGTH:
        return db.get_hero_map_node(index)
    return None


@dataclass
class MapAttempt:
    index: int
    game: game_store.CustomGame
    # Mirrors puzzle_map/store.py's own MapAttempt.remaining exactly - the
    # solver's not-yet-played steps, alternating with the opponent's forced
    # replies.
    remaining: list[dict] = field(default_factory=list)


# One in-progress attempt per user, in-memory only - same tradeoff as
# puzzle_map/store.py's own _ATTEMPTS (the permanent part, which node
# indices are actually solved, lives in db.py instead).
_ATTEMPTS: dict[str, MapAttempt] = {}


def start_attempt(user_id: str, index: int, game: game_store.CustomGame, solution: list[dict]) -> MapAttempt:
    attempt = MapAttempt(index=index, game=game, remaining=list(solution))
    _ATTEMPTS[user_id] = attempt
    return attempt


def get_attempt(user_id: str) -> MapAttempt | None:
    return _ATTEMPTS.get(user_id)


def clear_attempt(user_id: str) -> None:
    _ATTEMPTS.pop(user_id, None)
