"""The Hero Puzzle Map: POST /nodes to author a puzzle for a slot, GET
/state for the whole route's authored/solved/locked status, POST /start to
begin a node, POST /move to submit a solver move. A sibling of
puzzle_map_routes.py (same _apply_move/_compute_status/_to_state/
_build_puzzle_game reuse, same sequential unlocking and permanent
per-node solved set), except nodes are hand-authored here rather than
pre-generated from the Lichess pool, so a slot can be unlocked-by-sequence
yet still have nothing in it - see `authored` on each node summary.
"""

from __future__ import annotations

import chess
from fastapi import APIRouter, Depends, HTTPException

from app import db
from app.api.custom_game_routes import _apply_move, _compute_status, _to_state
from app.api.daily_puzzle_routes import _build_puzzle_game
from app.custom_chess import rules
from app.hero_puzzle_map import store as map_store
from app.hero_puzzle_map.models import (
    HeroMapCreateNodeRequest,
    HeroMapCreateNodeResponse,
    HeroMapMoveRequest,
    HeroMapMoveResponse,
    HeroMapNodeSummary,
    HeroMapStartRequest,
    HeroMapStartResponse,
    HeroMapStateResponse,
)
from app.social.auth import get_current_user_id

router = APIRouter()


def _promotion_piece_type(letter):
    """See puzzle_map_routes.py's own copy of this - same reasoning."""
    return chess.PIECE_SYMBOLS.index(letter) if letter else None


def _node_summary(solved: set[int], authored: set[int], index: int) -> HeroMapNodeSummary:
    unlocked = index == 1 or (index - 1) in solved
    return HeroMapNodeSummary(
        index=index,
        authored=index in authored,
        solved=index in solved,
        unlocked=unlocked,
        is_finale=index == map_store.MAP_LENGTH,
    )


@router.post("/hero-puzzle-map/nodes", response_model=HeroMapCreateNodeResponse)
def create_hero_map_node(payload: HeroMapCreateNodeRequest, user_id: str = Depends(get_current_user_id)):
    if not (1 <= payload.index <= map_store.MAP_LENGTH):
        raise HTTPException(400, f"index must be between 1 and {map_store.MAP_LENGTH}")
    if not payload.solution:
        raise HTTPException(400, "A puzzle needs at least one solution move")

    definition = {"custom_position": payload.custom_position.model_dump(), "solution": [m.model_dump() for m in payload.solution]}
    # Same validity check as daily_puzzle_routes.create_daily_puzzle: the
    # position builds and the first solution move is legal from it.
    game = _build_puzzle_game(definition)
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

    db.create_hero_map_node(payload.index, definition, created_by=user_id)
    return HeroMapCreateNodeResponse(index=payload.index)


@router.get("/hero-puzzle-map/state", response_model=HeroMapStateResponse)
def get_map_state(user_id: str = Depends(get_current_user_id)):
    solved = set(db.get_hero_map_progress(user_id))
    authored = db.get_authored_hero_map_indices()
    nodes = [_node_summary(solved, authored, i) for i in range(1, map_store.MAP_LENGTH + 1)]
    return HeroMapStateResponse(
        nodes=nodes,
        solved_count=len(solved),
        unlocked_hydra_skin=map_store.MAP_LENGTH in solved,
    )


@router.post("/hero-puzzle-map/start", response_model=HeroMapStartResponse)
def start_map_puzzle(payload: HeroMapStartRequest, user_id: str = Depends(get_current_user_id)):
    solved = set(db.get_hero_map_progress(user_id))
    authored = db.get_authored_hero_map_indices()
    if not _node_summary(solved, authored, payload.index).unlocked:
        raise HTTPException(400, "That puzzle isn't unlocked yet")
    definition = map_store.node_at(payload.index)
    if definition is None:
        raise HTTPException(404, "No puzzle has been authored for this node yet")

    game = _build_puzzle_game(definition)
    map_store.start_attempt(user_id, payload.index, game, definition["solution"])
    return HeroMapStartResponse(
        index=payload.index,
        game=_to_state(game),
        my_side="white" if game.board.turn == chess.WHITE else "black",
    )


@router.post("/hero-puzzle-map/move", response_model=HeroMapMoveResponse)
def submit_map_move(payload: HeroMapMoveRequest, user_id: str = Depends(get_current_user_id)):
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
        solved = set(db.get_hero_map_progress(user_id))
        return HeroMapMoveResponse(
            correct=False,
            puzzle_solved=False,
            game=_to_state(attempt.game),
            solved_count=len(solved),
            unlocked_hydra_skin=map_store.MAP_LENGTH in solved,
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
    solved = set(db.get_hero_map_progress(user_id))
    if puzzle_solved:
        solved = set(db.record_hero_map_solve(user_id, attempt.index))
        map_store.clear_attempt(user_id)

    return HeroMapMoveResponse(
        correct=True,
        puzzle_solved=puzzle_solved,
        game=_to_state(attempt.game),
        solved_count=len(solved),
        unlocked_hydra_skin=map_store.MAP_LENGTH in solved,
    )
