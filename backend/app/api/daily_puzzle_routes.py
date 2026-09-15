"""Daily Puzzle: one hand-authored, hero-piece-featuring puzzle per day
(unlike puzzle_rush's static Lichess-derived pool of plain-chess puzzles),
solved by everyone against the same position, with a streak that unlocks a
cosmetic skin at STREAK_UNLOCK_SKIN_DAYS days in a row (see db.py). This is
a foundational first version: posting a puzzle is a plain authenticated
endpoint (no dedicated admin role exists yet), and a solved position is
shown by simply rebuilding the puzzle's start rather than replaying/storing
the exact final board - both reasonable enough for now, worth revisiting if
this feature grows.
"""

from __future__ import annotations

import chess
from fastapi import APIRouter, Depends, HTTPException

from app import db
from app.api.custom_game_routes import _apply_move, _build_game_from_two_decks, _to_state
from app.custom_chess import rules
from app.daily_puzzle import store as puzzle_store
from app.daily_puzzle.models import (
    DailyPuzzleCreateRequest,
    DailyPuzzleCreateResponse,
    DailyPuzzleMoveRequest,
    DailyPuzzleMoveResponse,
    DailyPuzzleStreakResponse,
    DailyPuzzleTodayResponse,
)
from app.social.auth import get_current_user_id

router = APIRouter()


def _build_puzzle_game(definition: dict):
    return _build_game_from_two_decks(
        definition["white_back_rank"],
        definition.get("white_evolved_squares", []),
        definition["black_back_rank"],
        definition.get("black_evolved_squares", []),
    )


@router.post("/daily-puzzle", response_model=DailyPuzzleCreateResponse)
def create_daily_puzzle(payload: DailyPuzzleCreateRequest, user_id: str = Depends(get_current_user_id)):
    puzzle_date = payload.puzzle_date or db.today_string()
    if not payload.solution:
        raise HTTPException(400, "A puzzle needs at least one solution move")

    # Just a validity check (the position builds and the first solution
    # move is legal from it) - not a full solve-through of every step,
    # which would need to replay each opponent reply too. Good enough to
    # catch a malformed post without needing a real solver here.
    game = _build_puzzle_game(payload.model_dump())
    first = payload.solution[0]
    try:
        from_sq = chess.parse_square(first.from_square.strip().lower())
        to_sq = chess.parse_square(first.to_square.strip().lower())
    except ValueError:
        raise HTTPException(400, "Invalid square notation in the first solution move")
    try:
        _apply_move(game, game.board.turn, from_sq, to_sq, first.shoot, first.from_square, first.to_square)
    except rules.IllegalMoveError as exc:
        raise HTTPException(400, f"The first solution move isn't legal from that position: {exc}")

    db.create_daily_puzzle(puzzle_date, payload.model_dump(), created_by=user_id)
    return DailyPuzzleCreateResponse(puzzle_date=puzzle_date)


@router.get("/daily-puzzle/streak", response_model=DailyPuzzleStreakResponse)
def get_my_streak(user_id: str = Depends(get_current_user_id)):
    streak = db.get_streak(user_id)
    return DailyPuzzleStreakResponse(
        current_streak=streak["current_streak"],
        longest_streak=streak["longest_streak"],
        unlocked_streak_skin=streak["current_streak"] >= db.STREAK_UNLOCK_SKIN_DAYS,
    )


@router.get("/daily-puzzle/today", response_model=DailyPuzzleTodayResponse)
def get_todays_puzzle(user_id: str = Depends(get_current_user_id)):
    puzzle_date = db.today_string()
    definition = db.get_daily_puzzle(puzzle_date)
    if definition is None:
        raise HTTPException(404, "No puzzle has been posted for today yet")

    streak = db.get_streak(user_id)
    already_solved = streak["last_solved_date"] == puzzle_date

    game = _build_puzzle_game(definition)
    if not already_solved:
        puzzle_store.start_attempt(user_id, puzzle_date, game, [m for m in definition["solution"]])
    else:
        puzzle_store.clear_attempt(user_id)

    return DailyPuzzleTodayResponse(
        puzzle_date=puzzle_date,
        game=_to_state(game),
        my_side="white" if game.board.turn == chess.WHITE else "black",
        already_solved_today=already_solved,
        current_streak=streak["current_streak"],
        longest_streak=streak["longest_streak"],
        unlocked_streak_skin=streak["current_streak"] >= db.STREAK_UNLOCK_SKIN_DAYS,
    )


@router.post("/daily-puzzle/move", response_model=DailyPuzzleMoveResponse)
def submit_daily_puzzle_move(payload: DailyPuzzleMoveRequest, user_id: str = Depends(get_current_user_id)):
    attempt = puzzle_store.get_attempt(user_id)
    if attempt is None:
        raise HTTPException(400, "No puzzle attempt in progress - fetch /daily-puzzle/today first")
    if not attempt.remaining:
        raise HTTPException(400, "This puzzle is already solved")

    expected = attempt.remaining[0]
    is_expected_move = (
        payload.from_square.strip().lower() == expected["from_square"].strip().lower()
        and payload.to_square.strip().lower() == expected["to_square"].strip().lower()
        and payload.shoot == expected.get("shoot", False)
    )
    streak = db.get_streak(user_id)
    if not is_expected_move:
        # A wrong guess never touches the board - same "try again" feel as
        # puzzle_rush's own SubmitMoveResponse.correct=False.
        return DailyPuzzleMoveResponse(
            correct=False,
            puzzle_solved=False,
            game=_to_state(attempt.game),
            current_streak=streak["current_streak"],
            longest_streak=streak["longest_streak"],
            unlocked_streak_skin=streak["current_streak"] >= db.STREAK_UNLOCK_SKIN_DAYS,
        )

    try:
        from_sq = chess.parse_square(payload.from_square.strip().lower())
        to_sq = chess.parse_square(payload.to_square.strip().lower())
    except ValueError:
        raise HTTPException(400, "Invalid square notation")

    board = attempt.game.board
    mover_color = board.turn
    try:
        log_entry = _apply_move(attempt.game, mover_color, from_sq, to_sq, payload.shoot, payload.from_square, payload.to_square)
    except rules.IllegalMoveError as exc:
        # Only reachable if the posted puzzle's solution is itself
        # internally inconsistent (the create endpoint only checks the
        # very first move) - a real bug in the puzzle, not the solver's
        # fault, so this is a 400 rather than quietly pretending it worked.
        raise HTTPException(400, f"This puzzle's solution has a problem: {exc}")
    attempt.game.action_log.append(log_entry)
    attempt.remaining.pop(0)

    # The opponent's forced reply auto-plays immediately, same as every
    # other puzzle solver convention (including puzzle_rush's own) - the
    # solver is never asked to move for the other side. Exactly one reply,
    # never a run of them - solver and opponent moves always alternate.
    if attempt.remaining and board.turn != mover_color:
        reply = attempt.remaining[0]
        try:
            reply_from = chess.parse_square(reply["from_square"].strip().lower())
            reply_to = chess.parse_square(reply["to_square"].strip().lower())
            reply_log = _apply_move(
                attempt.game, board.turn, reply_from, reply_to, reply.get("shoot", False), reply["from_square"], reply["to_square"]
            )
        except (ValueError, rules.IllegalMoveError) as exc:
            raise HTTPException(400, f"This puzzle's solution has a problem: {exc}")
        attempt.game.action_log.append(reply_log)
        attempt.remaining.pop(0)

    puzzle_solved = not attempt.remaining
    if puzzle_solved:
        streak = db.record_daily_solve(user_id, attempt.puzzle_date)
        puzzle_store.clear_attempt(user_id)

    return DailyPuzzleMoveResponse(
        correct=True,
        puzzle_solved=puzzle_solved,
        game=_to_state(attempt.game),
        current_streak=streak["current_streak"],
        longest_streak=streak["longest_streak"],
        unlocked_streak_skin=streak["current_streak"] >= db.STREAK_UNLOCK_SKIN_DAYS,
    )
