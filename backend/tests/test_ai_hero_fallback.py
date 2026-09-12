import chess

from app.custom_chess import ai, store


def test_ai_falls_back_to_hero_special_move_when_no_standard_move_works(client, monkeypatch):
    # Black's only piece besides its King is a Hydra on e5. Simulates
    # Stockfish exhausting every standard move (the RuntimeError
    # ai.compute_ai_move raises once its own root_moves list is empty,
    # forced here regardless of the real position) - the fallback search in
    # custom_game_routes.py should find and play a legal hero-special move
    # for it instead of the endpoint crashing with a 500. Which exact
    # destination it picks isn't the point (several are equally valid here,
    # both plain-knight and ring-extra) - just that it finds *a* real one.
    board = chess.Board(fen="4k3/8/8/4n3/8/8/8/4K3 b - - 0 1")
    game = store.create_game(board, black_hydra_squares={chess.E5}, vs_ai=True)
    game.status = "in_progress"

    def fake_compute_ai_move(board, excluded_moves=None):
        raise RuntimeError("No legal moves remain for the engine to choose from")

    monkeypatch.setattr(ai, "compute_ai_move", fake_compute_ai_move)

    resp = client.post(f"/api/game/{game.id}/ai-move")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["black_hydra_squares"]) == 1
    new_square = chess.parse_square(body["black_hydra_squares"][0])
    assert new_square != chess.E5
    assert chess.Board(body["fen"]).piece_at(new_square) == chess.Piece(chess.KNIGHT, chess.BLACK)
    assert body["action_log"][-1].startswith("e5-")


def test_ai_falls_back_to_a_hero_special_move_unreachable_any_other_way(client, monkeypatch):
    # Unlike the test above, block every one of the Hydra's plain
    # knight-shape squares with a black pawn, so its only legal moves left
    # are ring-extra ones - squares board.legal_moves has no way to
    # generate at all (it only ever sees this square as a plain Knight) -
    # proving the fallback really does reach hero-only moves, not just ones
    # that happened to also be normal knight moves.
    board = chess.Board(fen="4k3/3p1p2/2p3p1/4n3/2p3p1/3p1p2/8/4K3 b - - 0 1")
    game = store.create_game(board, black_hydra_squares={chess.E5}, vs_ai=True)
    game.status = "in_progress"
    knight_shape_squares = {chess.parse_square(s) for s in ["d3", "f3", "c4", "g4", "c6", "g6", "d7", "f7"]}

    def fake_compute_ai_move(board, excluded_moves=None):
        raise RuntimeError("No legal moves remain for the engine to choose from")

    monkeypatch.setattr(ai, "compute_ai_move", fake_compute_ai_move)

    resp = client.post(f"/api/game/{game.id}/ai-move")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["black_hydra_squares"]) == 1
    new_square = chess.parse_square(body["black_hydra_squares"][0])
    assert new_square not in knight_shape_squares
    assert new_square != chess.E5
