"""The 50-puzzle progression map: nodes 1-49 pull from the shared Lichess
tactics pool (see puzzle_rush/store.py), spread evenly across its full
difficulty range so the route ramps up gradually rather than opening on the
easiest 49 puzzles in the set; node 50 is a hand-authored Hydra mate,
verified the same rigorous way as the Daily Puzzle's own hero puzzles (see
this session's scratchpad verify_puzzle.py - "HYDRA PUZZLE draft 5", the
final clean version: King a8/Hydra a4/inert Knight c6 vs King c8/pawn
a7/Knight b7, unique mate a4-a6). Solving node 50 is what unlocks the Hydra
King skin (see frontend's skinStore.js's requiresMapProgress).

Each node's definition is shaped exactly like DailyPuzzleCreateRequest's
custom_position + solution (daily_puzzle/models.py), so building its
starting position reuses daily_puzzle_routes.py's _build_puzzle_game
directly - a plain node is just a custom_position with every hero-square
list left empty, so no separate plain-vs-hero branching is needed anywhere
in this feature.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.custom_chess import store as game_store
from app.puzzle_rush import store as pool

MAP_LENGTH = 50


def _plain_node(rush_puzzle) -> dict:
    return {
        "custom_position": {"fen": rush_puzzle.start_fen},
        "solution": [
            {"from_square": uci[0:2], "to_square": uci[2:4], "shoot": False} for uci in rush_puzzle.solution_moves
        ],
    }


def _hydra_finale_node() -> dict:
    return {
        "custom_position": {
            "fen": "k1K5/pn6/2N5/8/N7/8/8/8 w - - 0 1",
            "white_hydra_squares": ["a4"],
        },
        "solution": [{"from_square": "a4", "to_square": "a6", "shoot": False}],
    }


def _build_nodes() -> list[dict]:
    nodes = []
    pool_count = pool.puzzle_count()
    plain_count = MAP_LENGTH - 1
    for i in range(plain_count):  # nodes 1..49
        pool_index = round(i / (plain_count - 1) * (pool_count - 1))
        nodes.append(_plain_node(pool.puzzle_at(pool_index)))
    nodes.append(_hydra_finale_node())  # node 50
    return nodes


NODES: list[dict] = _build_nodes()


def node_at(index: int) -> dict | None:
    """1-indexed, matching how the map is shown/addressed everywhere else."""
    if 1 <= index <= len(NODES):
        return NODES[index - 1]
    return None


@dataclass
class MapAttempt:
    index: int
    game: game_store.CustomGame
    # Mirrors daily_puzzle/store.py's DailyAttempt.remaining exactly - the
    # solver's not-yet-played steps, alternating with the opponent's forced
    # replies.
    remaining: list[dict] = field(default_factory=list)


# One in-progress attempt per user, in-memory only - same tradeoff as
# daily_puzzle/store.py's own _ATTEMPTS (the permanent part, which node
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
