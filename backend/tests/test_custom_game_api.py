import chess

from app.custom_chess import store
from tests.conftest import STANDARD_BLACK_BACK_RANK, STANDARD_WHITE_BACK_RANK


def test_custom_setup_returns_playable_game(client):
    resp = client.post(
        "/api/game/custom-setup",
        json={
            "white_back_rank": STANDARD_WHITE_BACK_RANK,
            "black_back_rank": STANDARD_BLACK_BACK_RANK,
            "vs_ai": False,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["turn"] == "white"
    assert body["status"] == "in_progress"
    assert body["action_log"] == []


def test_custom_setup_rejects_invalid_back_rank(client):
    resp = client.post(
        "/api/game/custom-setup",
        json={"white_back_rank": {"a1": "K"}, "black_back_rank": {}},  # black has no king
    )
    assert resp.status_code == 400


def test_get_unknown_game_is_404(client):
    resp = client.get("/api/game/does-not-exist")
    assert resp.status_code == 404


def _setup_game(client, white_back_rank=None, black_back_rank=None, white_evolved_squares=None):
    resp = client.post(
        "/api/game/custom-setup",
        json={
            "white_back_rank": white_back_rank or STANDARD_WHITE_BACK_RANK,
            "black_back_rank": black_back_rank or STANDARD_BLACK_BACK_RANK,
            "white_evolved_squares": white_evolved_squares or [],
            "vs_ai": False,
        },
    )
    assert resp.status_code == 200
    return resp.json()


def test_standard_move_flow_alternates_turns_and_updates_fen(client):
    game = _setup_game(client)
    game_id = game["id"]
    # One entry already, for the starting position - see fen_history below.
    assert game["fen_history"] == [game["fen"]]

    resp = client.post(
        "/api/game/custom-move",
        json={"game_id": game_id, "from_square": "e2", "to_square": "e4"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["turn"] == "black"
    assert chess.Board(body["fen"]).piece_at(chess.E4) == chess.Piece(chess.PAWN, chess.WHITE)
    assert body["action_log"] == ["e2-e4"]

    fetched = client.get(f"/api/game/{game_id}").json()
    assert fetched["fen"] == body["fen"]


def test_fen_history_grows_by_one_per_move_and_starts_with_the_setup_position(client):
    # Regression coverage for the move-history back/forward navigation
    # feature - the frontend steps through this list directly rather than
    # re-deriving past positions itself.
    game = _setup_game(client)
    game_id = game["id"]
    starting_fen = game["fen"]

    after_e4 = client.post(
        "/api/game/custom-move", json={"game_id": game_id, "from_square": "e2", "to_square": "e4"}
    ).json()
    assert after_e4["fen_history"] == [starting_fen, after_e4["fen"]]

    after_e5 = client.post(
        "/api/game/custom-move", json={"game_id": game_id, "from_square": "e7", "to_square": "e5"}
    ).json()
    assert after_e5["fen_history"] == [starting_fen, after_e4["fen"], after_e5["fen"]]

    # An illegal move must never append to the history.
    rejected = client.post(
        "/api/game/custom-move", json={"game_id": game_id, "from_square": "a1", "to_square": "a5"}
    )
    assert rejected.status_code == 400
    unchanged = client.get(f"/api/game/{game_id}").json()
    assert unchanged["fen_history"] == after_e5["fen_history"]


def test_standard_move_rejects_illegal_move(client):
    game = _setup_game(client)
    resp = client.post(
        "/api/game/custom-move",
        json={"game_id": game["id"], "from_square": "e2", "to_square": "e5"},
    )
    assert resp.status_code == 400


# These three build the CustomGame directly (rather than via /custom-setup,
# which only ever places pieces on ranks 1/8/2/7) so the Archer/Wizard
# destinations used below - free of the fixed pawn rows - actually exist;
# same reasoning as _make_game in test_promotion_and_dragon_checkmate.py.


def test_archer_move_via_api_relocates_one_square(client):
    board = chess.Board(fen="4k3/8/8/8/8/8/8/1N2K3 w - - 0 1")
    game = store.create_game(board, white_archer_squares={chess.B1}, vs_ai=False)

    resp = client.post(
        "/api/game/custom-move",
        json={"game_id": game.id, "from_square": "b1", "to_square": "c1"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["white_archer_squares"] == ["c1"]


def test_archer_relocate_via_api_rejects_the_l_shaped_knight_move(client):
    board = chess.Board(fen="4k3/8/8/8/8/8/8/1N2K3 w - - 0 1")
    game = store.create_game(board, white_archer_squares={chess.B1}, vs_ai=False)

    resp = client.post(
        "/api/game/custom-move",
        json={"game_id": game.id, "from_square": "b1", "to_square": "d2"},
    )
    assert resp.status_code == 400


def test_archer_shoot_via_api_destroys_target_and_passes_turn(client):
    board = chess.Board(fen="4k3/8/8/8/8/3n4/1N6/4K3 w - - 0 1")
    game = store.create_game(board, white_archer_squares={chess.B2}, vs_ai=False)

    resp = client.post(
        "/api/game/custom-move",
        json={"game_id": game.id, "from_square": "b2", "to_square": "d3", "shoot": True},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["turn"] == "black"
    assert body["white_archer_squares"] == ["b2"]  # archer didn't move
    assert chess.Board(body["fen"]).piece_at(chess.D3) is None
    assert "shoots" in body["action_log"][0]


def test_wizard_move_via_api_can_use_king_step_shape(client):
    # c1-b1 isn't a diagonal, so this only succeeds if the API actually
    # falls through to king-step legality for the Wizard.
    board = chess.Board(fen="4k3/8/8/8/8/8/8/K1B5 w - - 0 1")
    game = store.create_game(board, white_wizard_squares={chess.C1}, vs_ai=False)

    resp = client.post(
        "/api/game/custom-move",
        json={"game_id": game.id, "from_square": "c1", "to_square": "b1"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "Wizard" in body["action_log"][0]
    assert body["white_wizard_squares"] == ["b1"]


def test_bishop_evolution_can_produce_two_wizards_via_setup_api(client):
    back_rank = {"e1": "K", "c1": "B", "f1": "B"}
    resp = client.post(
        "/api/game/custom-setup",
        json={"white_back_rank": back_rank, "white_evolved_squares": ["c1", "f1"], "vs_ai": False},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["white_wizard_squares"] == ["c1", "f1"]
    board = chess.Board(body["fen"])
    assert board.piece_at(chess.C1) == chess.Piece(chess.BISHOP, chess.WHITE)
    assert board.piece_at(chess.F1) == chess.Piece(chess.BISHOP, chess.WHITE)


def test_game_over_status_rejects_further_moves(client):
    # Fool's-mate-equivalent quick checkmate using the standard setup.
    game = _setup_game(client)
    game_id = game["id"]
    moves = [("f2", "f3"), ("e7", "e5"), ("g2", "g4"), ("d8", "h4")]
    body = None
    for frm, to in moves:
        resp = client.post("/api/game/custom-move", json={"game_id": game_id, "from_square": frm, "to_square": to})
        assert resp.status_code == 200
        body = resp.json()

    assert body["status"] == "checkmate"

    resp = client.post(
        "/api/game/custom-move",
        json={"game_id": game_id, "from_square": "a2", "to_square": "a3"},
    )
    assert resp.status_code == 400
