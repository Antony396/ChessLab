"""XP only ever changes for a real online game between two known accounts,
same scope as currency/elo - mirrors test_currency.py's own end-to-end shape
(register two accounts, deliver a real checkmate through
/api/game/online/move). Unlike currency, BOTH sides earn something (the
loser just earns less) - see db.py's award_xp_for_result."""

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


def test_level_for_xp_matches_the_triangular_curve():
    assert db.xp_for_level(1) == 0
    assert db.xp_for_level(2) == 100
    assert db.xp_for_level(3) == 300
    assert db.xp_for_level(4) == 600
    assert db.level_for_xp(0) == 1
    assert db.level_for_xp(99) == 1
    assert db.level_for_xp(100) == 2
    assert db.level_for_xp(299) == 2
    assert db.level_for_xp(300) == 3


def test_checkmate_pays_the_winner_more_than_the_loser(client):
    _, white_id = _register(client, "xpMateW")
    _, black_id = _register(client, "xpMateB")
    assert db.get_xp(white_id) == 0
    assert db.get_xp(black_id) == 0

    board = chess.Board(None)
    board.set_piece_at(chess.A6, chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(chess.B1, chess.Piece(chess.QUEEN, chess.WHITE))
    board.set_piece_at(chess.A8, chess.Piece(chess.KING, chess.BLACK))
    board.turn = chess.WHITE
    game = store.create_game(board)
    game.white_token = "white-xp-token"
    game.black_token = "black-xp-token"
    game.white_user_id = white_id
    game.black_user_id = black_id

    resp = client.post(
        "/api/game/online/move",
        json={"game_id": game.id, "player_token": "white-xp-token", "from_square": "b1", "to_square": "b7"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "checkmate"

    assert db.get_xp(white_id) == db.XP_PER_WIN
    assert db.get_xp(black_id) == db.XP_PER_LOSS


def test_me_endpoint_reports_level_alongside_xp(client):
    token, user_id = _register(client, "xpMeLevel")
    db.add_xp(user_id, 300)  # exactly level 3's threshold
    resp = client.get("/api/social/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["xp"] == 300
    assert body["level"] == 3
