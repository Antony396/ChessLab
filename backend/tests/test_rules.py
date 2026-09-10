import chess
import pytest

from app.custom_chess.rules import (
    IllegalMoveError,
    execute_archer_move,
    execute_archer_shoot,
    execute_standard_move,
    execute_wizard_move,
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


def test_wizard_moves_diagonally_like_a_bishop():
    board = chess.Board(fen="7k/8/8/8/8/8/8/B6K w - - 0 1")
    execute_wizard_move(board, chess.Move.from_uci("a1d4"))
    assert board.piece_at(chess.D4) == chess.Piece(chess.BISHOP, chess.WHITE)
    assert board.piece_at(chess.A1) is None


def test_wizard_moves_one_square_like_a_king():
    board = chess.Board(fen="7k/8/8/8/8/8/8/B6K w - - 0 1")
    execute_wizard_move(board, chess.Move.from_uci("a1a2"))  # not a bishop move at all
    assert board.piece_at(chess.A2) == chess.Piece(chess.BISHOP, chess.WHITE)
    assert board.piece_at(chess.A1) is None


def test_wizard_king_step_can_capture_an_enemy_piece():
    # b2-b3 is straight, not diagonal - only reachable via the king-step
    # mode, so this actually exercises the added capture path (a1-b2 in the
    # test above would double as a legal bishop move and not prove anything
    # new).
    board = chess.Board(fen="7k/8/8/8/8/1p6/1B6/7K w - - 0 1")
    execute_wizard_move(board, chess.Move.from_uci("b2b3"))
    assert board.piece_at(chess.B3) == chess.Piece(chess.BISHOP, chess.WHITE)


def test_wizard_rejects_king_step_onto_own_piece():
    board = chess.Board(fen="7k/8/8/8/8/8/1P6/B6K w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_wizard_move(board, chess.Move.from_uci("a1b2"))


def test_wizard_rejects_move_that_is_neither_bishop_nor_king_shaped():
    board = chess.Board(fen="7k/8/8/8/8/8/8/B6K w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_wizard_move(board, chess.Move.from_uci("a1a5"))  # straight line, not diagonal or king-step


def test_wizard_rejects_king_step_that_exposes_own_king():
    # King a1, Wizard a2, pinned by a black rook on a8 along the a-file.
    board = chess.Board(fen="r6k/8/8/8/8/8/B7/K7 w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_wizard_move(board, chess.Move.from_uci("a2b2"))  # king-step off the pin file
    # Staying on the pin file (a diagonal bishop move isn't available from
    # a2 along the a-file, but a king-step straight up the file is fine).
    execute_wizard_move(board, chess.Move.from_uci("a2a3"))
    assert board.piece_at(chess.A3) == chess.Piece(chess.BISHOP, chess.WHITE)


def test_wizard_rejects_non_bishop_piece():
    board = chess.Board()
    with pytest.raises(IllegalMoveError, match="doesn't hold a Wizard"):
        execute_wizard_move(board, chess.Move.from_uci("e2e4"))


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


def test_archer_relocate_can_capture_by_moving_onto_an_enemy_piece():
    board = chess.Board(fen="7k/8/8/8/8/8/1p6/N6K w - - 0 1")
    execute_archer_move(board, chess.Move.from_uci("a1b2"))
    assert board.piece_at(chess.B2) == chess.Piece(chess.KNIGHT, chess.WHITE)


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
