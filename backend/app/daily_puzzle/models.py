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


class DailyPuzzleCustomPosition(BaseModel):
    """An arbitrary starting position - unlike white_back_rank/
    black_back_rank below (which can only build a fresh-draft-style setup:
    custom back ranks plus full pawn rows on 2/7, nothing else on the
    board - see fen.py's build_fen), this accepts any FEN plus which
    squares hold which hero piece, so a puzzle can look like a real
    mid-game tactic instead of only "the first move or two after an
    unusual draft"."""

    fen: str
    white_dragon_squares: list[str] = []
    black_dragon_squares: list[str] = []
    white_pope_square: Optional[str] = None
    black_pope_square: Optional[str] = None
    white_archer_square: Optional[str] = None
    black_archer_square: Optional[str] = None
    white_hydra_squares: list[str] = []
    black_hydra_squares: list[str] = []
    white_cyclops_squares: list[str] = []
    black_cyclops_squares: list[str] = []
    white_mirror_squares: list[str] = []
    black_mirror_squares: list[str] = []


class DailyPuzzleCreateRequest(BaseModel):
    """How a puzzle gets "posted". Two ways to specify the starting
    position - exactly one should be given:
    - white_back_rank/black_back_rank (+ evolved squares), shaped exactly
      like _build_game_from_two_decks's own inputs (see
      custom_game_routes.py) - a fresh-draft-style setup, same as every
      other custom position in this app.
    - custom_position, an arbitrary FEN + hero squares - for a puzzle
      that needs to look like a real mid-game position rather than only
      the very start of one.
    """

    puzzle_date: str  # "YYYY-MM-DD" - defaults to today if omitted
    white_back_rank: Optional[dict[str, str]] = None
    white_evolved_squares: list[str] = []
    black_back_rank: Optional[dict[str, str]] = None
    black_evolved_squares: list[str] = []
    custom_position: Optional[DailyPuzzleCustomPosition] = None
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
