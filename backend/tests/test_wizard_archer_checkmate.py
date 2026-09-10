import chess

from app.api.custom_game_routes import _archer_has_escape, _compute_status, _wizard_has_king_step_move
from app.custom_chess.store import CustomGame


def _make_game(fen: str, **squares) -> CustomGame:
    return CustomGame(id="test", board=chess.Board(fen=fen), vs_ai=False, **squares)


# Same "boxed-in king, queen mates on g1, bishop a7 guards the recapture
# square" skeleton as the Dragon false-checkmate tests, with the evolved
# piece swapped in on a square from which only its extra movement mode
# reaches g1.


def test_wizard_king_step_escape_detected_directly():
    # f1-g1 is horizontal, not diagonal - a real Bishop has no way to reach
    # it, but the Wizard's king-step mode does, capturing the queen.
    game = _make_game("k7/b7/8/8/8/8/6PP/5BqK w - - 0 1", white_wizard_squares={chess.F1})
    assert game.board.is_checkmate()  # confirms python-chess is fooled - it only sees the Bishop's diagonals
    assert _wizard_has_king_step_move(game, chess.F1) is True


def test_wizard_king_step_escape_false_when_none_exists():
    # Same shape, but the Wizard is on a3 where neither its diagonals nor a
    # king-step reach g1 or otherwise resolve the check - a genuine mate.
    game = _make_game("k7/b7/8/8/8/B7/6PP/6qK w - - 0 1", white_wizard_squares={chess.A3})
    assert game.board.is_checkmate()
    assert _wizard_has_king_step_move(game, chess.A3) is False


def test_compute_status_not_checkmate_when_wizard_can_escape():
    game = _make_game("k7/b7/8/8/8/8/6PP/5BqK w - - 0 1", white_wizard_squares={chess.F1})
    assert _compute_status(game) == "in_progress"


def test_compute_status_is_checkmate_when_wizard_cannot_escape():
    game = _make_game("k7/b7/8/8/8/B7/6PP/6qK w - - 0 1", white_wizard_squares={chess.A3})
    assert _compute_status(game) == "checkmate"


# Archer at f3: python-chess's legal_moves generator already sees the real
# f3-g1 knight capture (it IS a legitimate knight move) and correctly
# concludes this isn't checkmate on its own - but that capture isn't a legal
# *relocation* for an Archer (only a king-step is), so _side_has_a_real_move
# must filter it out and instead recognize the equivalent *shoot* action as
# the real escape.


def test_archer_shoot_escape_detected_directly():
    game = _make_game("k7/b7/8/8/8/5N2/6PP/6qK w - - 0 1", white_archer_squares={chess.F3})
    board = game.board
    assert board.is_checkmate() is False  # python-chess sees SOME move here...
    assert any(m.from_square == chess.F3 for m in board.legal_moves)  # ...but only the phantom relocate
    assert _archer_has_escape(board, game, chess.F3, chess.WHITE) is True  # the real action is a shoot, not a move


def test_archer_escape_false_when_none_exists():
    # Same shape, but the Archer is on a3, where neither a king-step nor a
    # knight's-move shot reaches g1 or otherwise resolves the check.
    game = _make_game("k7/b7/8/8/8/N7/6PP/6qK w - - 0 1", white_archer_squares={chess.A3})
    assert _archer_has_escape(game.board, game, chess.A3, chess.WHITE) is False


def test_compute_status_not_checkmate_when_archer_can_shoot_the_checker():
    game = _make_game("k7/b7/8/8/8/5N2/6PP/6qK w - - 0 1", white_archer_squares={chess.F3})
    assert _compute_status(game) == "in_progress"


def test_compute_status_is_checkmate_when_archer_cannot_escape():
    game = _make_game("k7/b7/8/8/8/N7/6PP/6qK w - - 0 1", white_archer_squares={chess.A3})
    assert _compute_status(game) == "checkmate"


def test_compute_status_ignores_evolved_pieces_belonging_to_the_side_not_in_trouble():
    # The escape hatches must only apply to the side actually to move.
    game = _make_game("k7/b7/8/8/8/B7/6PP/6qK w - - 0 1", black_wizard_squares={chess.A3})
    assert _compute_status(game) == "checkmate"
    game = _make_game("k7/b7/8/8/8/N7/6PP/6qK w - - 0 1", black_archer_squares={chess.A3})
    assert _compute_status(game) == "checkmate"
