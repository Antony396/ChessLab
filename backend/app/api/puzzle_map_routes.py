"""The 50-puzzle progression map: GET /state for the whole route's
solved/locked status, POST /start to begin a node, POST /move to submit a
solver move. Mirrors daily_puzzle_routes.py closely (same
_apply_move/_compute_status/_to_state/_build_puzzle_game reuse) - the real
differences are that progress is a permanent per-node solved set (db.py's
map_puzzle_progress) rather than a single rolling streak, and unlocking is
sequential (node i only playable once node i-1 is solved) rather than daily.
"""

from __future__ import annotations

import chess
from fastapi import APIRouter, Depends, HTTPException

from app import db
from app.api.custom_game_routes import _apply_move, _compute_status, _to_state
from app.api.daily_puzzle_routes import _build_puzzle_game
from app.custom_chess import rules
from app.puzzle_map import store as map_store
from app.puzzle_map.models import (
    MapMoveRequest,
    MapMoveResponse,
    MapNodeSummary,
    MapStartRequest,
    MapStartResponse,
    MapStateResponse,
)
from app.social.auth import get_current_user_id

router = APIRouter()


def _promotion_piece_type(letter):
    """None if `letter` is falsy (not a promotion), else the chess.PieceType
    it names - e.g. "n" -> chess.KNIGHT. Without passing this through
    explicitly, _apply_move's own default (auto-queen any pawn push landing
    on the back rank) silently overrides a puzzle's real intended
    underpromotion, which can make its very next solution step illegal (a
    Queen's extra reach can cover a square the puzzle's own weaker piece
    never would) - see puzzle_map/store.py's _plain_node for where this
    comes from."""
    return chess.PIECE_SYMBOLS.index(letter) if letter else None


def _node_summary(solved: set[int], index: int) -> MapNodeSummary:
    unlocked = index == 1 or (index - 1) in solved
    return MapNodeSummary(index=index, solved=index in solved, unlocked=unlocked, is_finale=index == map_store.MAP_LENGTH)


@router.get("/puzzle-map/state", response_model=MapStateResponse)
def get_map_state(user_id: str = Depends(get_current_user_id)):
    solved = set(db.get_map_progress(user_id))
    nodes = [_node_summary(solved, i) for i in range(1, map_store.MAP_LENGTH + 1)]
    return MapStateResponse(
        nodes=nodes,
        solved_count=len(solved),
        unlocked_regal_skin=map_store.MAP_LENGTH in solved,
    )


@router.post("/puzzle-map/start", response_model=MapStartResponse)
def start_map_puzzle(payload: MapStartRequest, user_id: str = Depends(get_current_user_id)):
    solved = set(db.get_map_progress(user_id))
    if not _node_summary(solved, payload.index).unlocked:
        raise HTTPException(400, "That puzzle isn't unlocked yet")
    definition = map_store.node_at(payload.index)
    if definition is None:
        raise HTTPException(404, "No such puzzle")

    game = _build_puzzle_game(definition)
    map_store.start_attempt(user_id, payload.index, game, definition["solution"])
    return MapStartResponse(
        index=payload.index,
        game=_to_state(game),
        my_side="white" if game.board.turn == chess.WHITE else "black",
    )


@router.post("/puzzle-map/move", response_model=MapMoveResponse)
def submit_map_move(payload: MapMoveRequest, user_id: str = Depends(get_current_user_id)):
    attempt = map_store.get_attempt(user_id)
    if attempt is None:
        raise HTTPException(400, "No puzzle attempt in progress - start a node first")
    if not attempt.remaining:
        raise HTTPException(400, "This puzzle is already solved")

    expected = attempt.remaining[0]
    is_expected_move = (
        payload.from_square.strip().lower() == expected["from_square"].strip().lower()
        and payload.to_square.strip().lower() == expected["to_square"].strip().lower()
        and payload.shoot == expected.get("shoot", False)
    )
    if not is_expected_move:
        solved = set(db.get_map_progress(user_id))
        return MapMoveResponse(
            correct=False,
            puzzle_solved=False,
            game=_to_state(attempt.game),
            solved_count=len(solved),
            unlocked_regal_skin=map_store.MAP_LENGTH in solved,
        )

    try:
        from_sq = chess.parse_square(payload.from_square.strip().lower())
        to_sq = chess.parse_square(payload.to_square.strip().lower())
    except ValueError:
        raise HTTPException(400, "Invalid square notation")

    board = attempt.game.board
    mover_color = board.turn
    try:
        log_entry = _apply_move(
            attempt.game,
            mover_color,
            from_sq,
            to_sq,
            payload.shoot,
            payload.from_square,
            payload.to_square,
            promotion=_promotion_piece_type(expected.get("promotion")),
        )
    except rules.IllegalMoveError as exc:
        raise HTTPException(400, f"This puzzle's solution has a problem: {exc}")
    attempt.game.action_log.append(log_entry)
    attempt.remaining.pop(0)

    # The opponent's forced reply auto-plays immediately, same convention as
    # daily_puzzle_routes.py's submit_daily_puzzle_move.
    if attempt.remaining and board.turn != mover_color:
        reply = attempt.remaining[0]
        try:
            reply_from = chess.parse_square(reply["from_square"].strip().lower())
            reply_to = chess.parse_square(reply["to_square"].strip().lower())
            reply_log = _apply_move(
                attempt.game,
                board.turn,
                reply_from,
                reply_to,
                reply.get("shoot", False),
                reply["from_square"],
                reply["to_square"],
                promotion=_promotion_piece_type(reply.get("promotion")),
            )
        except (ValueError, rules.IllegalMoveError) as exc:
            raise HTTPException(400, f"This puzzle's solution has a problem: {exc}")
        attempt.game.action_log.append(reply_log)
        attempt.remaining.pop(0)

    attempt.game.status = _compute_status(attempt.game)

    puzzle_solved = not attempt.remaining
    solved = set(db.get_map_progress(user_id))
    if puzzle_solved:
        solved = set(db.record_map_solve(user_id, attempt.index))
        map_store.clear_attempt(user_id)

    return MapMoveResponse(
        correct=True,
        puzzle_solved=puzzle_solved,
        game=_to_state(attempt.game),
        solved_count=len(solved),
        unlocked_regal_skin=map_store.MAP_LENGTH in solved,
    )
