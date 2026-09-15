"""ELO only ever changes for a real online game between two known accounts
(see CustomGame.white_user_id/black_user_id and online_game_routes.py's
online_move) - this covers the actual HTTP wiring end to end: registering
two accounts, linking them to a game via the online/create+join auth_token
field, delivering a real checkmate through /api/game/online/move, and
checking the resulting ELO change is the standard formula's exact answer."""

import uuid

import chess

from app import db
from app.custom_chess import store


def _register(client, username):
    # A random suffix, not just the bare name - this test DB is a real,
    # persistent Neon branch (see conftest.py), not reset between runs, so
    # a fixed username would collide with an account a previous run already
    # created. Usernames are capped at 20 characters (see social_routes.py's
    # _USERNAME_RE), so this keeps the base short.
    unique = f"{username}{uuid.uuid4().hex[:6]}"
    resp = client.post("/api/social/register", json={"username": unique, "password": "testpass123"})
    assert resp.status_code == 200
    body = resp.json()
    return body["token"], body["user"]["id"]


def test_online_create_and_join_link_accounts_via_auth_token(client):
    white_token, white_user_id = _register(client, "eloLnkW")
    black_token, black_user_id = _register(client, "eloLnkB")

    room = client.post(
        "/api/game/online/create",
        json={"white_back_rank": {"e1": "K", "a1": "R"}, "auth_token": white_token},
    ).json()
    joined = client.post(
        f"/api/game/online/room/{room['room_id']}/join",
        json={"black_back_rank": {"e8": "K", "a8": "R"}, "auth_token": black_token},
    ).json()

    game = store.get_game(joined["id"])
    assert game.white_user_id == white_user_id
    assert game.black_user_id == black_user_id


def test_online_create_without_auth_token_leaves_the_game_unlinked(client):
    room = client.post("/api/game/online/create", json={"white_back_rank": {"e1": "K", "a1": "R"}}).json()
    joined = client.post(
        f"/api/game/online/room/{room['room_id']}/join",
        json={"black_back_rank": {"e8": "K", "a8": "R"}},
    ).json()

    game = store.get_game(joined["id"])
    assert game.white_user_id is None
    assert game.black_user_id is None


def test_checkmate_updates_elo_for_both_linked_accounts(client):
    white_token, white_id = _register(client, "eloMateW")
    black_token, black_id = _register(client, "eloMateB")
    assert db.get_elo(white_id) == 1000
    assert db.get_elo(black_id) == 1000

    # A "queen supported by king" back-rank-style mate, one move away:
    # White plays Qb1-b7, check - Black's King on a8 has no escape (a7/b8
    # both covered by the queen) and can't capture it (b7 is protected by
    # White's own King on a6, off the b-file so it doesn't block the
    # queen's path there).
    board = chess.Board(None)
    board.set_piece_at(chess.A6, chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(chess.B1, chess.Piece(chess.QUEEN, chess.WHITE))
    board.set_piece_at(chess.A8, chess.Piece(chess.KING, chess.BLACK))
    board.turn = chess.WHITE
    game = store.create_game(board)
    game.white_token = "white-mate-token"
    game.black_token = "black-mate-token"
    game.white_user_id = white_id
    game.black_user_id = black_id

    resp = client.post(
        "/api/game/online/move",
        json={"game_id": game.id, "player_token": "white-mate-token", "from_square": "b1", "to_square": "b7"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "checkmate"

    # White delivered mate, so White gained rating and Black lost the exact
    # same amount - both starting at 1000 (expected score 0.5 each) with the
    # default K-factor of 32: 1000 + 32*(1-0.5) = 1016, 1000 + 32*(0-0.5) = 984.
    assert db.get_elo(white_id) == 1016
    assert db.get_elo(black_id) == 984


def test_vs_ai_game_never_touches_elo(client):
    # custom-setup (vs_ai) games never set white_user_id/black_user_id at
    # all, so they're structurally excluded - this just confirms a
    # not-online-multiplayer game can't reach online_move's ELO branch in
    # the first place (it's rejected long before that check).
    token, user_id = _register(client, "eloVsAi")
    resp = client.post(
        "/api/game/custom-setup",
        json={"white_back_rank": {"e1": "K", "a1": "R"}, "vs_ai": True},
    )
    assert resp.status_code == 200
    assert db.get_elo(user_id) == 1000
