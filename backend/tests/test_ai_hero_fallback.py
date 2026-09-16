import chess

from app.custom_chess import store


def test_ai_uses_a_hero_special_move_when_it_is_clearly_best(client):
    # Any game with a hero piece on the board skips Stockfish entirely and
    # uses hero_ai.choose_move instead (see custom_game_routes.py's
    # custom_ai_move), since Stockfish can never propose - or even know
    # about - a Dragon/Hydra/etc.'s extra movement mode. Here Black's only
    # real gain available is the Hydra capturing an undefended Rook on d7
    # via its plain knight-shape mode; the King has moves too, but none of
    # them capture anything, so the search should prefer the capture.
    # The lone extra pawn on h7 is otherwise irrelevant - without it,
    # capturing the Rook leaves bare King+Hydra vs King, which
    # board.is_insufficient_material() treats as an automatic draw (same
    # rule that makes King+Knight vs King a draw in standard chess) - a
    # real quirk of _compute_status trusting that check regardless of a
    # Hydra's actual extra power, not a bug in the search itself. The pawn
    # keeps the position "sufficient" so the test isolates what it's
    # actually checking: does the search prefer the capture at all.
    board = chess.Board(fen="k7/3R3p/8/4n3/8/8/8/7K b - - 0 1")
    game = store.create_game(board, black_hydra_squares={chess.E5}, vs_ai=True)
    game.status = "in_progress"

    resp = client.post(f"/api/game/{game.id}/ai-move")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["black_hydra_squares"]) == 1
    new_square = chess.parse_square(body["black_hydra_squares"][0])
    assert new_square == chess.D7
    assert chess.Board(body["fen"]).piece_at(chess.D7) == chess.Piece(chess.KNIGHT, chess.BLACK)


def test_ai_reaches_a_ring_extra_move_unreachable_any_other_way(client):
    # The undefended Rook sits on c3 - a ring-extra square (Chebyshev
    # distance 2, straight) that's neither a normal Knight destination nor
    # reachable by the King from e8. board.legal_moves has no way to
    # generate this square at all for a piece stored as a plain Knight -
    # proves hero_ai's enumerator really does reach hero-only moves, not
    # just ones that happened to also be normal knight moves.
    # Same h7-pawn reasoning as the test above - keeps King+Hydra vs King
    # from being auto-drawn by insufficient material after the capture.
    board = chess.Board(fen="4k2p/8/8/4n3/8/2R5/8/7K b - - 0 1")
    game = store.create_game(board, black_hydra_squares={chess.E5}, vs_ai=True)
    game.status = "in_progress"
    knight_shape_squares = {chess.parse_square(s) for s in ["d3", "f3", "c4", "g4", "c6", "g6", "d7", "f7"]}
    assert chess.C3 not in knight_shape_squares  # sanity check on the test's own premise

    resp = client.post(f"/api/game/{game.id}/ai-move")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["black_hydra_squares"]) == 1
    new_square = chess.parse_square(body["black_hydra_squares"][0])
    assert new_square == chess.C3
    assert chess.Board(body["fen"]).piece_at(chess.C3) == chess.Piece(chess.KNIGHT, chess.BLACK)
