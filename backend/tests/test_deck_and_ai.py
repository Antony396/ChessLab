# Within the 31-point AI-arena budget (K=0, Q=9, N=3, N=3 => 15), used
# wherever a test just needs *some* legal deck, not the full standard army.
BUDGET_WHITE_BACK_RANK = {"e1": "K", "d1": "Q", "b1": "N", "g1": "N"}


def test_setup_rejects_deck_over_points_budget(client):
    # Q(9) + R(5) + R(5) + R(5) + R(5) + R(5) = 34 > 31
    over_budget = {
        "a1": "R", "b1": "R", "c1": "R", "e1": "K", "d1": "Q", "f1": "R", "g1": "R",
    }
    resp = client.post("/api/game/custom-setup", json={"white_back_rank": over_budget})
    assert resp.status_code == 400
    assert "points" in resp.json()["detail"].lower()


def test_setup_accepts_deck_within_points_budget(client):
    # Q(9) + N(3) + N(3) + K(0) = 15 <= 31
    within_budget = {"e1": "K", "d1": "Q", "b1": "N", "g1": "N"}
    resp = client.post("/api/game/custom-setup", json={"white_back_rank": within_budget})
    assert resp.status_code == 200


def test_setup_auto_fills_black_back_rank_when_omitted(client):
    resp = client.post("/api/game/custom-setup", json={"white_back_rank": BUDGET_WHITE_BACK_RANK})
    assert resp.status_code == 200
    body = resp.json()
    assert body["vs_ai"] is True
    # black's rank 8 should be the standard formation - spot check via FEN
    assert body["fen"].split(" ")[0].startswith("rnbqkbnr")


def test_evolution_slot_requires_a_knight_or_bishop_there(client):
    back_rank = {"a1": "R", "b1": "N", "e1": "K"}
    resp = client.post(
        "/api/game/custom-setup",
        json={"white_back_rank": back_rank, "white_evolved_squares": ["a1"]},  # a1 is a Rook
    )
    assert resp.status_code == 400
    assert "knight" in resp.json()["detail"].lower()
    assert "bishop" in resp.json()["detail"].lower()


def test_evolution_slot_turns_knight_into_a_tracked_dragon(client):
    back_rank = {"a1": "R", "b1": "N", "e1": "K"}
    resp = client.post(
        "/api/game/custom-setup",
        json={"white_back_rank": back_rank, "white_evolved_squares": ["b1"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["white_dragon_square"] == "b1"
    # the FEN must show a Rook (R) on b1, not a Knight, since python-chess
    # needs a real piece type it understands for rook-line legality/checks
    import chess

    board = chess.Board(body["fen"])
    assert board.piece_at(chess.B1) == chess.Piece(chess.ROOK, chess.WHITE)


def test_evolution_slot_turns_bishop_into_a_tracked_wizard(client):
    back_rank = {"a1": "R", "c1": "B", "e1": "K"}
    resp = client.post(
        "/api/game/custom-setup",
        json={"white_back_rank": back_rank, "white_evolved_squares": ["c1"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["white_wizard_squares"] == ["c1"]
    # the FEN keeps a Bishop (B) on c1 - unlike the Dragon, no piece-type
    # swap is needed since a Wizard's native storage type IS a Bishop.
    import chess

    board = chess.Board(body["fen"])
    assert board.piece_at(chess.C1) == chess.Piece(chess.BISHOP, chess.WHITE)


def test_setup_tracks_archer_squares_from_the_back_rank(client):
    back_rank = {"a1": "R", "b1": "A", "g1": "A", "e1": "K"}
    resp = client.post("/api/game/custom-setup", json={"white_back_rank": back_rank})
    assert resp.status_code == 200
    body = resp.json()
    assert body["white_archer_squares"] == ["b1", "g1"]
    # the FEN must show a Knight (N) on each Archer square, since python-chess
    # needs a real piece type it understands
    import chess

    board = chess.Board(body["fen"])
    assert board.piece_at(chess.B1) == chess.Piece(chess.KNIGHT, chess.WHITE)
    assert board.piece_at(chess.G1) == chess.Piece(chess.KNIGHT, chess.WHITE)


def test_setup_allows_an_extra_pawn_on_the_back_rank(client):
    # A drafted Pawn on an otherwise-free back-rank square: unreachable
    # through normal play (9 white pawns, one on the back rank), which
    # custom_setup must tolerate rather than rejecting as an illegal position.
    back_rank = {"e1": "K", "b1": "P"}
    resp = client.post("/api/game/custom-setup", json={"white_back_rank": back_rank, "vs_ai": False})
    assert resp.status_code == 200
    body = resp.json()
    import chess

    board = chess.Board(body["fen"])
    assert board.piece_at(chess.B1) == chess.Piece(chess.PAWN, chess.WHITE)
    assert board.piece_at(chess.B2) == chess.Piece(chess.PAWN, chess.WHITE)  # the normal one, still there too
    # Blocked in front by its own rank-2 pawn - genuinely immobile for now.
    assert not any(m.from_square == chess.B1 for m in board.legal_moves)


def test_ai_move_endpoint_replies_after_the_human_moves(client):
    resp = client.post("/api/game/custom-setup", json={"white_back_rank": BUDGET_WHITE_BACK_RANK})
    game_id = resp.json()["id"]

    resp = client.post(
        "/api/game/custom-move",
        json={"game_id": game_id, "from_square": "e2", "to_square": "e4"},
    )
    assert resp.status_code == 200
    body = resp.json()
    # The human's move alone must NOT trigger the AI - that's the whole
    # point of splitting the endpoints (so the player's move renders before
    # the client asks for the AI's reply, instead of waiting on Stockfish).
    assert body["turn"] == "black"
    assert body["action_log"] == ["e2-e4"]

    resp = client.post(f"/api/game/{game_id}/ai-move")
    assert resp.status_code == 200
    body = resp.json()
    assert body["turn"] == "white"
    assert len(body["action_log"]) == 2
    assert body["action_log"][1].endswith("(AI)")


def test_ai_move_endpoint_rejects_when_not_ais_turn(client):
    resp = client.post("/api/game/custom-setup", json={"white_back_rank": BUDGET_WHITE_BACK_RANK})
    game_id = resp.json()["id"]
    resp = client.post(f"/api/game/{game_id}/ai-move")
    assert resp.status_code == 400
    assert "turn" in resp.json()["detail"].lower()


def test_ai_move_endpoint_rejects_for_non_ai_games(client):
    resp = client.post(
        "/api/game/custom-setup",
        json={"white_back_rank": BUDGET_WHITE_BACK_RANK, "vs_ai": False},
    )
    game_id = resp.json()["id"]
    client.post("/api/game/custom-move", json={"game_id": game_id, "from_square": "e2", "to_square": "e4"})
    resp = client.post(f"/api/game/{game_id}/ai-move")
    assert resp.status_code == 400
    assert "no ai opponent" in resp.json()["detail"].lower()


def test_ai_move_endpoint_still_works_after_a_knight_shaped_dragon_move(client):
    # Regression: the AI reconstructs its position by replaying the move
    # stack, and a knight-shaped Dragon hop isn't a legal move for whatever
    # Stockfish thinks occupies that square (a plain Rook) - replaying it
    # used to desync the engine and produce garbage. vs_ai=True here is the
    # point of the test.
    back_rank = {"a1": "K", "b1": "N"}
    resp = client.post(
        "/api/game/custom-setup",
        json={"white_back_rank": back_rank, "white_evolved_squares": ["b1"]},
    )
    assert resp.status_code == 200
    game_id = resp.json()["id"]

    resp = client.post(
        "/api/game/custom-move",
        json={"game_id": game_id, "from_square": "b1", "to_square": "c3"},  # knight-shaped, not rook-shaped
    )
    assert resp.status_code == 200
    assert resp.json()["turn"] == "black"

    resp = client.post(f"/api/game/{game_id}/ai-move")
    assert resp.status_code == 200
    body = resp.json()
    assert body["turn"] == "white"
    assert len(body["action_log"]) == 2
    assert body["action_log"][1].endswith("(AI)")


def test_dragon_move_via_api_can_use_knight_shape(client):
    # b1-c3 isn't a rook-line move at all, so this only succeeds if the API
    # actually falls through to knight-shaped legality for the Dragon -
    # proves the whole request/response path wires Dragon movement through
    # correctly, not just the direct rules-level unit test.
    back_rank = {"a1": "K", "b1": "N"}
    resp = client.post(
        "/api/game/custom-setup",
        json={
            "white_back_rank": back_rank,
            "white_evolved_squares": ["b1"],
            "vs_ai": False,  # keep this deterministic - no AI reply to account for
        },
    )
    assert resp.status_code == 200
    game_id = resp.json()["id"]

    resp = client.post(
        "/api/game/custom-move",
        json={"game_id": game_id, "from_square": "b1", "to_square": "c3"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "Dragon" in body["action_log"][0]
    assert body["white_dragon_square"] == "c3"
