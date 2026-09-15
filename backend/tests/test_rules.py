import chess
import pytest

from app.custom_chess.rules import (
    IllegalMoveError,
    execute_archer_move,
    execute_archer_shoot,
    execute_boosted_pawn_move,
    execute_pope_move,
    execute_standard_move,
    is_within_pope_aura,
    pope_boosted_diagonal_capture_squares,
    pope_boosted_forward_square,
)


def test_standard_move_still_uses_real_chess_legality():
    board = chess.Board()  # untouched python-chess starting position
    execute_standard_move(board, chess.Move.from_uci("e2e4"))
    assert board.piece_at(chess.E4) == chess.Piece(chess.PAWN, chess.WHITE)
    assert board.piece_at(chess.E2) is None


def test_standard_move_rejects_illegal_move():
    board = chess.Board()
    with pytest.raises(IllegalMoveError):
        execute_standard_move(board, chess.Move.from_uci("e2e5"))  # pawns can't jump 3


def test_pope_moves_one_square_like_a_king():
    board = chess.Board(fen="7k/8/8/8/8/8/8/B6K w - - 0 1")
    execute_pope_move(board, chess.Move.from_uci("a1a2"))
    assert board.piece_at(chess.A2) == chess.Piece(chess.BISHOP, chess.WHITE)
    assert board.piece_at(chess.A1) is None


def test_pope_rejects_bishop_line_move():
    # Unlike the old Wizard this replaces, a Pope has NO diagonal-line
    # movement at all - only a king-step, even though it's stored as a
    # Bishop and a1-d4 would be a perfectly legal Bishop move.
    board = chess.Board(fen="7k/8/8/8/8/8/8/B6K w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_pope_move(board, chess.Move.from_uci("a1d4"))


def test_pope_king_step_can_capture_an_enemy_piece():
    board = chess.Board(fen="7k/8/8/8/8/1p6/1B6/7K w - - 0 1")
    execute_pope_move(board, chess.Move.from_uci("b2b3"))
    assert board.piece_at(chess.B3) == chess.Piece(chess.BISHOP, chess.WHITE)


def test_pope_rejects_king_step_onto_own_piece():
    board = chess.Board(fen="7k/8/8/8/8/8/1P6/B6K w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_pope_move(board, chess.Move.from_uci("a1b2"))


def test_pope_rejects_move_more_than_one_square():
    board = chess.Board(fen="7k/8/8/8/8/8/8/B6K w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_pope_move(board, chess.Move.from_uci("a1a5"))


def test_pope_rejects_king_step_that_exposes_own_king():
    # King a1, Pope a2, pinned by a black rook on a8 along the a-file.
    board = chess.Board(fen="r6k/8/8/8/8/8/B7/K7 w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_pope_move(board, chess.Move.from_uci("a2b2"))  # king-step off the pin file
    # Staying on the pin file is fine.
    execute_pope_move(board, chess.Move.from_uci("a2a3"))
    assert board.piece_at(chess.A3) == chess.Piece(chess.BISHOP, chess.WHITE)


def test_pope_rejects_non_bishop_piece():
    board = chess.Board()
    with pytest.raises(IllegalMoveError, match="doesn't hold a Pope"):
        execute_pope_move(board, chess.Move.from_uci("e2e4"))


def test_is_within_pope_aura_covers_chebyshev_distance_one():
    pope_square = chess.D4
    assert is_within_pope_aura(pope_square, chess.D4) is True  # the Pope's own square
    assert is_within_pope_aura(pope_square, chess.E5) is True  # diagonal neighbor
    assert is_within_pope_aura(pope_square, chess.D6) is False  # two squares away
    assert is_within_pope_aura(None, chess.E5) is False


def test_boosted_pawn_can_push_two_from_a_non_starting_rank():
    # White Pawn on d3 (already past its own starting rank), Pope adjacent
    # on e3 (beside it, not blocking the forward path) - the aura should
    # let it push all the way to d5.
    board = chess.Board(fen="7k/8/8/8/8/3PB3/8/7K w - - 0 1")
    execute_boosted_pawn_move(board, chess.Move.from_uci("d3d5"), pope_square=chess.E3)
    assert board.piece_at(chess.D5) == chess.Piece(chess.PAWN, chess.WHITE)
    assert board.piece_at(chess.D3) is None


def test_boosted_pawn_forward_push_needs_a_clear_path():
    board = chess.Board(fen="7k/8/8/3p4/8/3PB3/8/7K w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_boosted_pawn_move(board, chess.Move.from_uci("d3d5"), pope_square=chess.E3)


def test_boosted_pawn_can_capture_two_squares_diagonally_either_direction():
    # b5/f5 are the two real diagonal-2 squares from d3 (see
    # test_pope_boosted_forward_square_and_diagonal_squares_geometry).
    board = chess.Board(fen="7k/8/8/1p3p2/8/3PB3/8/7K w - - 0 1")
    execute_boosted_pawn_move(board, chess.Move.from_uci("d3b5"), pope_square=chess.E3)
    assert board.piece_at(chess.B5) == chess.Piece(chess.PAWN, chess.WHITE)
    assert board.piece_at(chess.D3) is None


def test_boosted_pawn_capture_cannot_target_the_enemy_king():
    board = chess.Board(fen="8/8/8/1k6/8/3PB3/8/7K w - - 0 1")
    with pytest.raises(IllegalMoveError, match="cannot capture the enemy King"):
        execute_boosted_pawn_move(board, chess.Move.from_uci("d3b5"), pope_square=chess.E3)


def test_boosted_pawn_move_rejected_when_pawn_is_outside_the_aura():
    # Same shape as the successful push test, but the Pope is now two
    # squares away - out of aura range.
    board = chess.Board(fen="7k/8/8/4B3/8/3P4/8/7K w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_boosted_pawn_move(board, chess.Move.from_uci("d3d5"), pope_square=chess.E5)


def test_pope_boosted_forward_square_and_diagonal_squares_geometry():
    assert pope_boosted_forward_square(chess.D3, chess.WHITE) == chess.D5
    assert pope_boosted_forward_square(chess.D3, chess.BLACK) == chess.D1
    assert set(pope_boosted_diagonal_capture_squares(chess.D3, chess.WHITE)) == {chess.B5, chess.F5}


def test_archer_relocates_one_square_any_direction():
    board = chess.Board(fen="7k/8/8/8/8/8/8/N6K w - - 0 1")
    execute_archer_move(board, chess.Move.from_uci("a1b2"))
    assert board.piece_at(chess.B2) == chess.Piece(chess.KNIGHT, chess.WHITE)
    assert board.piece_at(chess.A1) is None


def test_archer_relocate_rejects_the_l_shaped_knight_move():
    # This is exactly the "real" knight move python-chess would validate for
    # a Knight-stored piece - the whole point is the Archer doesn't get it.
    board = chess.Board(fen="7k/8/8/8/8/8/8/N6K w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_archer_move(board, chess.Move.from_uci("a1b3"))


def test_archer_relocate_cannot_capture_an_enemy_piece():
    # Move-only: relocating is never a capture, even of an ordinary enemy
    # piece - shooting (a knight's-move away) is the sole way an Archer
    # takes anything, so it can never accidentally take a King this way.
    board = chess.Board(fen="7k/8/8/8/8/8/1p6/N6K w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_archer_move(board, chess.Move.from_uci("a1b2"))


def test_archer_relocate_rejects_move_that_exposes_own_king():
    board = chess.Board(fen="r6k/8/8/8/8/8/N7/K7 w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_archer_move(board, chess.Move.from_uci("a2b2"))  # steps off the a-file pin
    execute_archer_move(board, chess.Move.from_uci("a2a3"))
    assert board.piece_at(chess.A3) == chess.Piece(chess.KNIGHT, chess.WHITE)


def test_archer_shoot_destroys_target_without_relocating():
    board = chess.Board(fen="7k/8/8/8/8/1p6/8/N6K w - - 0 1")
    execute_archer_shoot(board, chess.Move.from_uci("a1b3"))  # knight's-move away from a1
    assert board.piece_at(chess.A1) == chess.Piece(chess.KNIGHT, chess.WHITE)  # archer didn't move
    assert board.piece_at(chess.B3) is None  # target destroyed
    assert board.turn == chess.BLACK  # turn still passed


def test_archer_shoot_rejects_targeting_empty_square():
    board = chess.Board(fen="7k/8/8/8/8/8/8/N6K w - - 0 1")
    with pytest.raises(IllegalMoveError, match="must shoot an enemy piece"):
        execute_archer_shoot(board, chess.Move.from_uci("a1b3"))


def test_archer_shoot_rejects_own_piece():
    board = chess.Board(fen="7k/8/8/8/8/1P6/8/N6K w - - 0 1")
    with pytest.raises(IllegalMoveError, match="must shoot an enemy piece"):
        execute_archer_shoot(board, chess.Move.from_uci("a1b3"))


def test_archer_shoot_rejects_targeting_the_enemy_king():
    board = chess.Board(fen="8/8/8/8/8/1k6/8/N6K w - - 0 1")
    with pytest.raises(IllegalMoveError, match="cannot shoot the enemy King"):
        execute_archer_shoot(board, chess.Move.from_uci("a1b3"))


def test_archer_shoot_rejects_non_knight_shape():
    board = chess.Board(fen="7k/8/8/8/8/8/1p6/N6K w - - 0 1")
    with pytest.raises(IllegalMoveError, match="knight's-move away"):
        execute_archer_shoot(board, chess.Move.from_uci("a1b2"))  # king-step, not a shot


def test_archer_shoot_must_resolve_existing_check():
    # White king h1 in check from a black rook on h4; the Archer on a1 could
    # shoot the unrelated black pawn on b3, but that does nothing about the
    # check, so it must be rejected.
    board = chess.Board(fen="7k/8/8/8/7r/1p6/8/N6K w - - 0 1")
    with pytest.raises(IllegalMoveError, match="leave your king in check"):
        execute_archer_shoot(board, chess.Move.from_uci("a1b3"))


def test_archer_shoot_rejects_non_knight_piece():
    board = chess.Board(fen="7k/8/8/8/1p6/8/8/R6K w - - 0 1")
    with pytest.raises(IllegalMoveError, match="doesn't hold an Archer"):
        execute_archer_shoot(board, chess.Move.from_uci("a1b4"))
