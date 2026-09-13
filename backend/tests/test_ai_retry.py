import chess

from app.custom_chess import ai, store


def test_ai_move_excludes_hero_check_illegal_moves_from_the_first_call(client, monkeypatch):
    # White Dragon on f3 threatens black's king on g1 via its knight-shape
    # mode - invisible to Stockfish, which only ever sees the FEN (a plain
    # Rook there). custom_ai_move now pre-filters excluded_moves with every
    # standard move that's unsafe under our own check rules (see
    # _real_legal_standard_moves) BEFORE ever asking the engine, rather than
    # letting it guess blind and discovering illegal moves one rejected
    # attempt at a time - the actual "AI doesn't respond well to a
    # hero-piece check" fix. h7-h6 ignores the check and must already be
    # excluded on the very first call.
    board = chess.Board(fen="8/7p/8/8/8/5R2/8/K5k1 b - - 0 1")
    game = store.create_game(board, white_dragon_square=chess.F3, vs_ai=True)
    game.status = "in_progress"

    bad_move = chess.Move.from_uci("h7h6")  # ignores the Dragon's knight-shape check on g1
    good_move = chess.Move.from_uci("g1g2")  # actually escapes it

    calls = []

    def fake_compute_ai_move(board, excluded_moves=None):
        calls.append(set(excluded_moves or []))
        assert bad_move in (excluded_moves or set())  # pre-filtered before the engine is ever asked
        return good_move

    monkeypatch.setattr(ai, "compute_ai_move", fake_compute_ai_move)

    resp = client.post(f"/api/game/{game.id}/ai-move")
    assert resp.status_code == 200
    body = resp.json()
    assert len(calls) == 1  # no wasted retry - correct from the first call
    assert chess.Board(body["fen"]).piece_at(chess.G2) == chess.Piece(chess.KING, chess.BLACK)
    assert body["action_log"][-1].startswith("g1-g2")


def test_ai_move_still_retries_if_the_engine_somehow_proposes_an_excluded_move(client, monkeypatch):
    # Defensive fallback coverage: even though excluded_moves is now
    # pre-filtered up front, custom_ai_move's retry loop is still there in
    # case the engine (a fake one, here) proposes something already known
    # to be unsafe - it should exclude it and ask again rather than 500ing.
    board = chess.Board(fen="8/7p/8/8/8/5R2/8/K5k1 b - - 0 1")
    game = store.create_game(board, white_dragon_square=chess.F3, vs_ai=True)
    game.status = "in_progress"

    bad_move = chess.Move.from_uci("h7h6")
    good_move = chess.Move.from_uci("g1g2")
    calls = []

    def fake_compute_ai_move(board, excluded_moves=None):
        calls.append(set(excluded_moves or []))
        if len(calls) == 1:
            return bad_move  # simulates a bug/edge case slipping past the pre-filter
        return good_move

    monkeypatch.setattr(ai, "compute_ai_move", fake_compute_ai_move)

    resp = client.post(f"/api/game/{game.id}/ai-move")
    assert resp.status_code == 200
    body = resp.json()
    assert len(calls) == 2
    assert body["action_log"][-1].startswith("g1-g2")
