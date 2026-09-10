import chess

from app.api.custom_game_routes import _apply_move, _compute_status, _dragon_has_knight_shaped_move
from app.custom_chess.store import CustomGame


def _make_game(fen: str, white_dragon_square=None, black_dragon_square=None) -> CustomGame:
    return CustomGame(
        id="test",
        board=chess.Board(fen=fen),
        white_dragon_square=white_dragon_square,
        black_dragon_square=black_dragon_square,
        vs_ai=False,
    )


def test_dragon_knight_mode_escape_detected_directly():
    # White king h1 boxed in by its own g2/h2 pawns, black queen checks from
    # g1, a black bishop on a7 covers g1 so the king can't recapture. Every
    # standard (rook-mode) response is exhausted - python-chess calls this
    # checkmate - but the Dragon on f3 has a knight-shaped hop to g1 that
    # captures the queen and escapes check, which python-chess can't see
    # since it thinks f3 holds a plain Rook.
    game = _make_game("k7/b7/8/8/8/5R2/6PP/6qK w - - 0 1", white_dragon_square=chess.F3)
    assert game.board.is_checkmate()  # confirms the scenario actually fools python-chess
    assert _dragon_has_knight_shaped_move(game, chess.F3) is True


def test_dragon_knight_mode_escape_false_when_none_exists():
    # Same shape, but the Dragon is on a3 where neither its rook-line nor a
    # knight jump reaches g1 - a genuine checkmate this time.
    game = _make_game("k7/b7/8/8/8/R7/6PP/6qK w - - 0 1", white_dragon_square=chess.A3)
    assert game.board.is_checkmate()
    assert _dragon_has_knight_shaped_move(game, chess.A3) is False


def test_compute_status_not_checkmate_when_dragon_can_escape():
    game = _make_game("k7/b7/8/8/8/5R2/6PP/6qK w - - 0 1", white_dragon_square=chess.F3)
    assert _compute_status(game) == "in_progress"


def test_compute_status_is_checkmate_when_dragon_cannot_escape():
    game = _make_game("k7/b7/8/8/8/R7/6PP/6qK w - - 0 1", white_dragon_square=chess.A3)
    assert _compute_status(game) == "checkmate"


def test_compute_status_ignores_a_dragon_belonging_to_the_side_not_in_trouble():
    # The escape hatch must only apply to the side actually to move - a
    # Dragon square recorded for the OTHER color shouldn't matter here.
    game = _make_game("k7/b7/8/8/8/R7/6PP/6qK w - - 0 1", black_dragon_square=chess.F3)
    assert _compute_status(game) == "checkmate"


def test_apply_move_auto_queens_a_pawn_reaching_the_back_rank():
    # A bare Move with no promotion specified isn't a legal move onto the
    # back rank at all (python-chess requires a promotion piece type there),
    # so without auto-queening a pawn could never actually finish promoting.
    game = _make_game("7k/P7/8/8/8/8/8/7K w - - 0 1")
    log_entry = _apply_move(
        game, chess.WHITE, chess.A7, chess.A8, shoot=False, from_square_str="a7", to_square_str="a8"
    )
    assert game.board.piece_at(chess.A8) == chess.Piece(chess.QUEEN, chess.WHITE)
    assert log_entry == "a7-a8"


def test_apply_move_promotion_via_capture():
    game = _make_game("1n5k/P7/8/8/8/8/8/7K w - - 0 1")
    _apply_move(
        game, chess.WHITE, chess.A7, chess.B8, shoot=False, from_square_str="a7", to_square_str="b8"
    )
    assert game.board.piece_at(chess.B8) == chess.Piece(chess.QUEEN, chess.WHITE)
