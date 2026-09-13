"""Puzzle Rush: standard chess tactics puzzles against a fixed clock.
Unrelated to Evo Chess's hero pieces - see puzzle_rush/store.py's docstring
for why. A run is a plain in-memory session; the server is the sole judge
of "correct" (the client never sees the solution moves ahead of time).
"""

from __future__ import annotations

import chess
from fastapi import APIRouter, Depends, HTTPException

from app.puzzle_rush import store
from app.puzzle_rush.models import StartRushRequest, StartRushResponse, SubmitMoveRequest, SubmitMoveResponse
from app.social.auth import get_current_user_id

router = APIRouter()

_ALLOWED_DURATIONS = {180, 300}


@router.post("/start", response_model=StartRushResponse)
def start_rush(payload: StartRushRequest, user_id: str = Depends(get_current_user_id)):
    duration = payload.duration_seconds if payload.duration_seconds in _ALLOWED_DURATIONS else 180
    session = store.create_session(user_id, duration)
    return StartRushResponse(
        session_id=session.id,
        fen=session.board.fen(),
        score=session.score,
        time_remaining=store.time_remaining(session),
    )


def _parse_squares(from_square: str, to_square: str) -> tuple[chess.Square, chess.Square]:
    try:
        from_sq = chess.parse_square(from_square.strip().lower())
        to_sq = chess.parse_square(to_square.strip().lower())
    except ValueError:
        raise HTTPException(400, "Invalid square notation")
    return from_sq, to_sq


@router.post("/move", response_model=SubmitMoveResponse)
def submit_move(payload: SubmitMoveRequest, user_id: str = Depends(get_current_user_id)):
    session = store.get_session(payload.session_id)
    if session is None or session.user_id != user_id:
        raise HTTPException(404, "Rush session not found")

    remaining = store.time_remaining(session)
    if remaining <= 0 or session.finished:
        session.finished = True
        return SubmitMoveResponse(
            correct=False,
            puzzle_solved=False,
            game_over=True,
            score=session.score,
            time_remaining=0,
            fen=session.board.fen(),
            next_puzzle=False,
        )

    from_sq, to_sq = _parse_squares(payload.from_square, payload.to_square)
    # Compared by from/to squares only, never the promotion piece: the
    # frontend always sends promotion="q" as a plain drag-and-drop default
    # (even for a move that isn't a promotion at all), and a puzzle's own
    # solution can call for underpromoting to something else entirely (a
    # Knight, say) - reconstructing a chess.Move from the client's guessed
    # promotion and comparing full UCI strings meant a mismatched or
    # spuriously-attached promotion letter could make an otherwise-correct
    # move register as wrong. This was the "no moves lead to a success"
    # bug - queen-appended UCI ("e2e4q") never matched a plain solution
    # move ("e2e4"). The move actually applied below always comes from the
    # puzzle's own trusted solution string, so the client's promotion
    # choice is irrelevant to correctness either way.
    move_uci = f"{chess.square_name(from_sq)}{chess.square_name(to_sq)}"
    if not session.remaining_moves or move_uci != session.remaining_moves[0][:4]:
        # Wrong - the fixed-timer rule is "mistakes cost time, not a
        # life", so the position doesn't change and they can just try
        # again.
        return SubmitMoveResponse(
            correct=False,
            puzzle_solved=False,
            game_over=False,
            score=session.score,
            time_remaining=remaining,
            fen=session.board.fen(),
            next_puzzle=False,
        )

    # Correct - play it, then auto-play the opponent's forced reply (if
    # the puzzle has one left) before handing back control.
    session.board.push_uci(session.remaining_moves.pop(0))
    if session.remaining_moves:
        session.board.push_uci(session.remaining_moves.pop(0))

    if session.remaining_moves:
        return SubmitMoveResponse(
            correct=True,
            puzzle_solved=False,
            game_over=False,
            score=session.score,
            time_remaining=store.time_remaining(session),
            fen=session.board.fen(),
            next_puzzle=False,
        )

    session.score += 1
    puzzle = store.advance_to_next_puzzle(session)
    return SubmitMoveResponse(
        correct=True,
        puzzle_solved=True,
        game_over=False,
        score=session.score,
        time_remaining=store.time_remaining(session),
        fen=puzzle.start_fen,
        next_puzzle=True,
    )
