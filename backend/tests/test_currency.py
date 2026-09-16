"""Currency only ever changes for a real online game between two known
accounts, awarded to the winner alone - mirrors test_elo.py's own end-to-end
shape (register two accounts, deliver a real checkmate through
/api/game/online/move) since both rewards are applied at the exact same
call site (see online_game_routes.py's online_move)."""

import uuid

import chess

from app import db
from app.custom_chess import store


def _register(client, username):
    unique = f"{username}{uuid.uuid4().hex[:6]}"
    resp = client.post("/api/social/register", json={"username": unique, "password": "testpass123"})
    assert resp.status_code == 200
    body = resp.json()
    return body["token"], body["user"]["id"]


def test_checkmate_pays_only_the_winner(client):
    white_token, white_id = _register(client, "curMateW")
    black_token, black_id = _register(client, "curMateB")
    assert db.get_currency(white_id) == 0
    assert db.get_currency(black_id) == 0

    board = chess.Board(None)
    board.set_piece_at(chess.A6, chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(chess.B1, chess.Piece(chess.QUEEN, chess.WHITE))
    board.set_piece_at(chess.A8, chess.Piece(chess.KING, chess.BLACK))
    board.turn = chess.WHITE
    game = store.create_game(board)
    game.white_token = "white-cur-token"
    game.black_token = "black-cur-token"
    game.white_user_id = white_id
    game.black_user_id = black_id

    resp = client.post(
        "/api/game/online/move",
        json={"game_id": game.id, "player_token": "white-cur-token", "from_square": "b1", "to_square": "b7"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "checkmate"

    assert db.get_currency(white_id) == db.CURRENCY_PER_WIN
    assert db.get_currency(black_id) == 0


def test_vs_ai_game_never_touches_currency(client):
    token, user_id = _register(client, "curVsAi")
    resp = client.post(
        "/api/game/custom-setup",
        json={"white_back_rank": {"e1": "K", "a1": "R"}, "vs_ai": True},
    )
    assert resp.status_code == 200
    assert db.get_currency(user_id) == 0
