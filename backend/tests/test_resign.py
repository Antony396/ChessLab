"""Resigning an online game: either side can give up at any time, the
opponent is credited exactly like a checkmate win (ELO + currency, see
online_game_routes.py's _apply_game_end_rewards), and the resulting state
records who actually gave up (resigned_by) since - unlike checkmate - that
can't be inferred from whose turn it is."""

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


def _linked_game():
    board = chess.Board(None)
    board.set_piece_at(chess.E1, chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(chess.E8, chess.Piece(chess.KING, chess.BLACK))
    board.turn = chess.WHITE
    game = store.create_game(board)
    game.white_token = "white-resign-token"
    game.black_token = "black-resign-token"
    return game


def test_black_resigning_credits_white_the_win(client):
    white_token, white_id = _register(client, "resignW")
    black_token, black_id = _register(client, "resignB")
    game = _linked_game()
    game.white_user_id = white_id
    game.black_user_id = black_id

    resp = client.post("/api/game/online/resign", json={"game_id": game.id, "player_token": "black-resign-token"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "resigned"
    assert body["resigned_by"] == "black"

    assert db.get_elo(white_id) == 1016  # standard K=32, 0.5 expected, won: 1000 + 32*0.5
    assert db.get_elo(black_id) == 984
    assert db.get_currency(white_id) == db.CURRENCY_PER_WIN
    assert db.get_currency(black_id) == 0


def test_resigning_an_already_over_game_is_rejected(client):
    game = _linked_game()
    game.status = "checkmate"

    resp = client.post("/api/game/online/resign", json={"game_id": game.id, "player_token": "white-resign-token"})
    assert resp.status_code == 400


def test_resign_with_an_invalid_token_is_rejected(client):
    game = _linked_game()
    resp = client.post("/api/game/online/resign", json={"game_id": game.id, "player_token": "not-a-real-token"})
    assert resp.status_code == 403


def test_resign_with_unknown_game_id_is_rejected(client):
    resp = client.post("/api/game/online/resign", json={"game_id": "no-such-game", "player_token": "whatever"})
    assert resp.status_code == 404


def test_resigning_an_unlinked_game_still_resigns_but_touches_no_elo(client):
    # Neither side authenticated (white_user_id/black_user_id both None) -
    # same "never rated" rule apply_elo_result already follows elsewhere.
    game = _linked_game()
    resp = client.post("/api/game/online/resign", json={"game_id": game.id, "player_token": "white-resign-token"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "resigned"
    assert resp.json()["resigned_by"] == "white"
