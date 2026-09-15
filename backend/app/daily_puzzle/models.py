from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from app.custom_chess.models import CustomGameState


class DailyPuzzleMoveSpec(BaseModel):
    """One step of a puzzle's solution - alternating solver/opponent moves,
    same order as puzzle_rush's own Puzzle.solution_moves, just structured
    (from/to/shoot) instead of bare UCI since a hero-piece move isn't
    always expressible as one."""

    from_square: str
    to_square: str
    shoot: bool = False


class DailyPuzzleCreateRequest(BaseModel):
    """How a puzzle gets "posted" - shaped exactly like
    _build_game_from_two_decks's own inputs (see custom_game_routes.py)
    plus the solution, so authoring a puzzle is just drafting both sides'
    armies the same way any other custom position already is."""

    puzzle_date: str  # "YYYY-MM-DD" - defaults to today if omitted
    white_back_rank: dict[str, str]
    white_evolved_squares: list[str] = []
    black_back_rank: dict[str, str]
    black_evolved_squares: list[str] = []
    # The solver's moves to find, alternating with the opponent's forced
    # replies (solver, opponent, solver, ...) - mirrors puzzle_rush's own
    # Puzzle.solution_moves ordering exactly.
    solution: list[DailyPuzzleMoveSpec]


class DailyPuzzleCreateResponse(BaseModel):
    puzzle_date: str


class DailyPuzzleStreakResponse(BaseModel):
    """Just the streak, no puzzle attached - unlike /daily-puzzle/today,
    this works even on a day nothing's been posted yet, so anything that
    only cares about streak status (the skin-unlock check in particular)
    doesn't have to handle a 404 that has nothing to do with it."""

    current_streak: int
    longest_streak: int
    unlocked_streak_skin: bool


class DailyPuzzleTodayResponse(BaseModel):
    puzzle_date: str
    game: CustomGameState
    my_side: str  # "white" | "black" - whichever side has the solver's next move
    already_solved_today: bool
    current_streak: int
    longest_streak: int
    unlocked_streak_skin: bool


class DailyPuzzleMoveRequest(BaseModel):
    from_square: str
    to_square: str
    shoot: bool = False


class DailyPuzzleMoveResponse(BaseModel):
    correct: bool
    puzzle_solved: bool
    game: CustomGameState
    current_streak: int
    longest_streak: int
    unlocked_streak_skin: bool
