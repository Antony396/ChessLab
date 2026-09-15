"""Live daily-puzzle attempts - one CustomGame per user's in-progress
attempt at today's puzzle, in-memory only (same tradeoff puzzle_rush's own
RushSession makes). The puzzle DEFINITION itself (what today's position and
solution actually are) and each user's streak are the persistent parts -
see db.py's daily_puzzles/daily_puzzle_streaks tables.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.custom_chess import store as game_store


@dataclass
class DailyAttempt:
    puzzle_date: str
    game: game_store.CustomGame
    # The solver's not-yet-played solution steps, alternating with the
    # opponent's forced replies - mirrors puzzle_rush's own
    # RushSession.remaining_moves.
    remaining: list[dict] = field(default_factory=list)


# One in-progress attempt per user - starting today's puzzle again (see
# daily_puzzle_routes.py's GET /today) always resets it, so there's never
# more than one live at a time.
_ATTEMPTS: dict[str, DailyAttempt] = {}


def start_attempt(user_id: str, puzzle_date: str, game: game_store.CustomGame, solution: list[dict]) -> DailyAttempt:
    attempt = DailyAttempt(puzzle_date=puzzle_date, game=game, remaining=list(solution))
    _ATTEMPTS[user_id] = attempt
    return attempt


def get_attempt(user_id: str) -> DailyAttempt | None:
    return _ATTEMPTS.get(user_id)


def clear_attempt(user_id: str) -> None:
    _ATTEMPTS.pop(user_id, None)
