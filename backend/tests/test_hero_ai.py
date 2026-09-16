"""hero_ai.py's own building blocks: move enumeration, evaluation, and the
search's move choice - independent of the /ai-move endpoint wiring (see
test_ai_hero_fallback.py for that integration)."""

import chess

from app.custom_chess import hero_ai, store


def test_color_has_hero_pieces_checks_only_that_color():
    board = chess.Board(fen="4k3/8/8/8/8/8/8/4K3 w - - 0 1")
    game = store.create_game(board, white_dragon_squares={chess.A1})
    assert hero_ai.color_has_hero_pieces(game, chess.WHITE) is True
    assert hero_ai.color_has_hero_pieces(game, chess.BLACK) is False


def test_enumerate_legal_moves_includes_a_dragons_rook_line_and_knight_hop():
    # Dragon on d4 (stored as a Rook): d4-d1 is a plain rook-line move
    # board.legal_moves already sees; d4-f5 is a knight-shape hop it
    # cannot - hero_ai's enumerator has to surface both from one square.
    board = chess.Board(fen="4k3/8/8/8/3R4/8/8/4K3 w - - 0 1")
    game = store.create_game(board, white_dragon_squares={chess.D4})
    moves = hero_ai.enumerate_legal_moves(game, chess.WHITE)
    assert (chess.D4, chess.D1, False) in moves
    assert (chess.D4, chess.F5, False) in moves


def test_evaluate_favors_the_side_with_more_material():
    board = chess.Board(fen="4k3/8/8/8/8/8/8/R3K3 w - - 0 1")  # White up a whole Rook
    game = store.create_game(board)
    assert hero_ai.evaluate(game, chess.WHITE) > 0
    assert hero_ai.evaluate(game, chess.BLACK) < 0
    assert hero_ai.evaluate(game, chess.WHITE) == -hero_ai.evaluate(game, chess.BLACK)


def test_evaluate_scores_checkmate_as_decisive():
    # Fool's-mate-shaped position: White (to move) is checkmated.
    board = chess.Board(fen="rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")
    game = store.create_game(board)
    game.status = "checkmate"
    assert hero_ai.evaluate(game, chess.BLACK) > 0
    assert hero_ai.evaluate(game, chess.WHITE) < 0


def test_choose_move_picks_the_only_real_material_gain_available():
    # A Pope moves exactly one square in any direction, like a King - not
    # along the diagonal its Bishop storage type would suggest (see
    # rules.py's execute_pope_move). White's Pope on d4 can step onto an
    # undefended Knight at d5 (orthogonally adjacent, so only reachable via
    # that king-step, never a real Bishop move) - its only real gain; the
    # King has nothing to capture either. The h7 pawn is irrelevant to the
    # move itself - without it, capturing leaves bare King+Bishop vs King,
    # which board.is_insufficient_material() auto-draws (same quirk noted
    # in test_ai_hero_fallback.py's Hydra tests), masking the real gain.
    board = chess.Board(fen="4k3/7p/8/3n4/3B4/8/8/4K3 w - - 0 1")
    game = store.create_game(board, white_pope_square=chess.D4)
    game.status = "in_progress"
    from_sq, to_sq, shoot = hero_ai.choose_move(game, chess.WHITE)
    assert (from_sq, to_sq) == (chess.D4, chess.D5)
    assert shoot is False


def test_choose_move_raises_when_no_legal_move_exists():
    # A plain back-rank checkmate, no hero pieces involved - not the AI's
    # usual reachable state (a caller should never ask for a move once the
    # game is already over), but choose_move's own contract is to raise
    # rather than crash oddly if it's ever asked anyway.
    board = chess.Board(fen="R6k/5ppp/8/8/8/8/8/7K b - - 0 1")
    game = store.create_game(board)
    game.status = "checkmate"
    try:
        hero_ai.choose_move(game, chess.BLACK)
        assert False, "expected RuntimeError"
    except RuntimeError:
        pass
