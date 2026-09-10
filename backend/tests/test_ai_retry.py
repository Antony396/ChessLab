import chess

from app.custom_chess import ai, store


def test_ai_move_falls_back_to_next_best_when_first_choice_is_illegal(client, monkeypatch):
    # White Dragon on f3 threatens black's king on g1 via its knight-shape
    # mode - invisible to Stockfish, which only ever sees the FEN (a plain
    # Rook there). Simulate the engine "wanting" to play a move that ignores
    # that check (h7-h6) before falling back to the only real escape (g1-g2).
    board = chess.Board(fen="8/7p/8/8/8/5R2/8/K5k1 b - - 0 1")
    game = store.create_game(board, white_dragon_square=chess.F3, vs_ai=True)
    game.status = "in_progress"

    bad_move = chess.Move.from_uci("h7h6")  # ignores the Dragon's knight-shape check on g1
    good_move = chess.Move.from_uci("g1g2")  # actually escapes it

    calls = []

    def fake_compute_ai_move(board, excluded_moves=None):
        calls.append(set(excluded_moves or []))
        if not excluded_moves:
            return bad_move
        assert bad_move in excluded_moves
        return good_move

    monkeypatch.setattr(ai, "compute_ai_move", fake_compute_ai_move)

    resp = client.post(f"/api/game/{game.id}/ai-move")
    assert resp.status_code == 200
    body = resp.json()
    assert len(calls) == 2  # first choice rejected, fell back to the second
    assert chess.Board(body["fen"]).piece_at(chess.G2) == chess.Piece(chess.KING, chess.BLACK)
    assert body["action_log"][-1].startswith("g1-g2")
