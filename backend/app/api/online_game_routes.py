"""Real-time online multiplayer: two separate browsers, each drafting their
own deck, each holding a secret token that proves which color they're
allowed to move.

A chess position needs both sides to exist before a board can even be
built, so a CustomGame doesn't come into being the moment the creator drafts
white's deck - it's a PendingRoom (just white's draft + a token) until a
second player submits black's deck too, at which point the real game is
built and both browsers move on to it.

Deliberately kept separate from custom_game_routes.py's existing endpoints
(vs_ai and the old same-browser local sandbox) rather than overloading them,
so none of that already-tested behaviour has to change to support this.

State still lives in the same in-memory store.py dicts - see its docstring.
Rooms, games, and the WebSocket subscriptions below don't survive a server
restart; acceptable for now, same tradeoff the rest of this feature already
accepts.
"""

from __future__ import annotations

import asyncio
import uuid

import chess
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from app import db
from app.api.custom_game_routes import (
    _apply_move,
    _build_game_from_two_decks,
    _compute_status,
    _to_state,
    _validate_deck_points,
)
from app.custom_chess import rules, store
from app.social import store as social_store
from app.custom_chess.models import (
    CustomGameState,
    CustomSetupRequest,
    OnlineJoinResponse,
    OnlineMoveRequest,
    OnlineRoomCreateResponse,
    OnlineRoomJoinRequest,
)
from app.custom_chess.ws_manager import manager

router = APIRouter()

# Render's proxy (and most others) silently drops a WebSocket that's been
# idle too long - no close frame, nothing for WebSocketDisconnect to catch,
# it just stops relaying traffic. A real move re-establishes activity on its
# own, but a slow-thinking player can easily leave the socket idle longer
# than that timeout, orphaning it mid-game: the server-side connection looks
# fine (broadcast() only notices it's dead on the NEXT send attempt, which
# might not come for a while), while the client sits there never getting
# the confirming broadcast for whatever move it just made - showing only
# its own optimistic guess, indefinitely, until something else prompts a
# reconnect. Sending a small keepalive frame on a timeout, rather than
# blocking on receive_text() forever, keeps the connection active through
# any idle-timeout window and lets the frontend's own watchdog (see
# OnlineGamePlay.jsx) notice a truly dead link far sooner than waiting on
# the browser's own (often much longer, sometimes indefinite) dead-TCP
# detection.
_PING_INTERVAL_SECONDS = 20


async def _hold_open(websocket: WebSocket) -> None:
    """Keep a subscriber socket open, replying to nothing (this channel is
    server -> client only) but pinging on an idle timeout instead of
    blocking on receive_text() forever - see _PING_INTERVAL_SECONDS above."""
    while True:
        try:
            await asyncio.wait_for(websocket.receive_text(), timeout=_PING_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            await websocket.send_json({"type": "ping"})


@router.post("/online/create", response_model=OnlineRoomCreateResponse)
def online_create(payload: CustomSetupRequest):
    """The creator drafts white's deck; the room waits for a second player
    to draft black's before any actual game exists."""
    _validate_deck_points(payload.white_back_rank, payload.white_evolved_squares)
    white_token = uuid.uuid4().hex
    room = store.create_room(payload.white_back_rank, payload.white_evolved_squares, white_token)
    if payload.auth_token:
        room.white_user_id = social_store.get_user_id_for_token(payload.auth_token)
    return OnlineRoomCreateResponse(room_id=room.id, white_token=white_token)


@router.websocket("/online/room/{room_id}/ws")
async def online_room_ws(websocket: WebSocket, room_id: str):
    """The creator connects here while waiting. Once black's deck arrives
    and the real game is built, online_room_join broadcasts it here so the
    creator's client can switch over to /online/{game_id}/ws for actual play."""
    room = store.get_room(room_id)
    if room is None:
        await websocket.close(code=4404)
        return

    await manager.connect(room_id, websocket)
    try:
        if room.game_id is not None:
            # Already started - a reconnect (e.g. a refresh) still needs the
            # game info, since it won't arrive again via a fresh broadcast.
            game = store.get_game(room.game_id)
            if game is not None:
                await websocket.send_json(_to_state(game).model_dump())
        await _hold_open(websocket)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(room_id, websocket)


@router.post("/online/room/{room_id}/join", response_model=OnlineJoinResponse)
async def online_room_join(room_id: str, payload: OnlineRoomJoinRequest):
    room = store.get_room(room_id)
    if room is None:
        raise HTTPException(404, "Room not found")
    if room.game_id is not None:
        raise HTTPException(400, "This room already has two players")

    _validate_deck_points(payload.black_back_rank, payload.black_evolved_squares)
    game = _build_game_from_two_decks(
        room.white_back_rank, room.white_evolved_squares, payload.black_back_rank, payload.black_evolved_squares
    )
    game.white_token = room.white_token
    game.black_token = uuid.uuid4().hex
    game.white_user_id = room.white_user_id
    if payload.auth_token:
        game.black_user_id = social_store.get_user_id_for_token(payload.auth_token)
    room.game_id = game.id

    state = _to_state(game)
    # So the creator's waiting-room screen (subscribed since /online/create)
    # can switch straight to the live board the moment someone joins.
    await manager.broadcast(room_id, state.model_dump())
    return OnlineJoinResponse(**state.model_dump(), black_token=game.black_token)


@router.post("/online/move", response_model=CustomGameState)
async def online_move(payload: OnlineMoveRequest):
    game = store.get_game(payload.game_id)
    if game is None:
        raise HTTPException(404, "Game not found")
    if game.white_token is None:
        raise HTTPException(400, "This game isn't an online multiplayer game")
    if game.status != "in_progress":
        raise HTTPException(400, f"Game is already over ({game.status})")

    board = game.board
    try:
        from_square = chess.parse_square(payload.from_square.strip().lower())
        to_square = chess.parse_square(payload.to_square.strip().lower())
    except ValueError:
        raise HTTPException(400, "Invalid square notation")

    piece = board.piece_at(from_square)
    if piece is None or piece.color != board.turn:
        raise HTTPException(400, "No piece of the side to move on that square")

    mover_color = board.turn
    expected_token = game.white_token if mover_color == chess.WHITE else game.black_token
    if payload.player_token != expected_token:
        raise HTTPException(403, "That's not your move to make")

    try:
        log_entry = _apply_move(
            game, mover_color, from_square, to_square, payload.shoot, payload.from_square, payload.to_square
        )
    except rules.IllegalMoveError as exc:
        raise HTTPException(400, str(exc))

    game.action_log.append(log_entry)
    game.status = _compute_status(game)

    # ELO only ever applies to a real game between two known accounts (see
    # CustomGame.white_user_id/black_user_id) - a vs_ai/local-sandbox game,
    # or an online game where either side never linked an account, leaves
    # both None and this is a no-op. Deliberately NOT read back into the
    # broadcast state below - see db.py's own note on why _to_state stays
    # elo-free on this hot a path (every move, every reconnect).
    if game.status != "in_progress" and game.white_user_id and game.black_user_id:
        result = "draw"
        if game.status == "checkmate":
            result = "white" if mover_color == chess.WHITE else "black"
        db.apply_elo_result(game.white_user_id, game.black_user_id, result)

    state = _to_state(game)
    await manager.broadcast(payload.game_id, state.model_dump())
    return state


@router.websocket("/online/{game_id}/ws")
async def online_game_ws(websocket: WebSocket, game_id: str):
    game = store.get_game(game_id)
    if game is None or game.white_token is None:
        await websocket.close(code=4404)
        return

    await manager.connect(game_id, websocket)
    try:
        # Push the current state right away, so a client that connects after
        # a move already happened isn't stuck waiting for the next one.
        await websocket.send_json(_to_state(game).model_dump())
        await _hold_open(websocket)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(game_id, websocket)
