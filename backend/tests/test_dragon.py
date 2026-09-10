import chess
import pytest

from app.custom_chess.rules import IllegalMoveError, execute_dragon_move


def test_dragon_moves_like_a_rook_along_a_clear_file():
    # Dragon stored as a Rook internally; king parked out of the way.
    board = chess.Board(fen="7k/8/8/8/8/8/8/R6K w - - 0 1")
    execute_dragon_move(board, chess.Move.from_uci("a1a5"))
    assert board.piece_at(chess.A5) == chess.Piece(chess.ROOK, chess.WHITE)
    assert board.piece_at(chess.A1) is None


def test_dragon_moves_like_a_knight_over_blocking_pieces():
    # a1 dragon surrounded by pawns that would block any rook-line move;
    # only the knight-shaped hop to b3 should work.
    board = chess.Board(fen="7k/8/8/8/8/1p6/PP6/R6K w - - 0 1")
    execute_dragon_move(board, chess.Move.from_uci("a1b3"))
    assert board.piece_at(chess.B3) == chess.Piece(chess.ROOK, chess.WHITE)  # still a Rook internally
    assert board.piece_at(chess.A1) is None
    assert board.piece_at(chess.B2) == chess.Piece(chess.PAWN, chess.WHITE)  # untouched, no jump side-effect


def test_dragon_stays_a_rook_after_a_knight_shaped_move():
    board = chess.Board(fen="7k/8/8/8/8/8/8/R6K w - - 0 1")
    execute_dragon_move(board, chess.Move.from_uci("a1b3"))
    board.push(chess.Move.from_uci("h8g8"))  # black's turn - shuffle the king to pass
    # A further rook-line move from the new square must still work.
    execute_dragon_move(board, chess.Move.from_uci("b3b8"))
    assert board.piece_at(chess.B8) == chess.Piece(chess.ROOK, chess.WHITE)


def test_dragon_rejects_move_that_is_neither_rook_nor_knight_shaped():
    board = chess.Board(fen="7k/8/8/8/8/8/8/R6K w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_dragon_move(board, chess.Move.from_uci("a1c3"))  # not a rook line, not a knight shape


def test_dragon_rejects_knight_shaped_move_that_exposes_own_king():
    # King a1, Dragon a2, pinned by a black rook on a8 along the a-file
    # (black king parked at h8, well clear of that file).
    board = chess.Board(fen="r6k/8/8/8/8/8/R7/K7 w - - 0 1")
    with pytest.raises(IllegalMoveError):
        execute_dragon_move(board, chess.Move.from_uci("a2b2"))  # rook-shaped, leaves the file
    with pytest.raises(IllegalMoveError):
        execute_dragon_move(board, chess.Move.from_uci("a2c3"))  # knight-shaped, also leaves the file
    # Staying on the pin file (rook-shaped) is fine.
    execute_dragon_move(board, chess.Move.from_uci("a2a5"))
    assert board.piece_at(chess.A5) == chess.Piece(chess.ROOK, chess.WHITE)


def test_dragon_rejects_non_rook_piece():
    board = chess.Board()
    with pytest.raises(IllegalMoveError, match="doesn't hold a Dragon"):
        execute_dragon_move(board, chess.Move.from_uci("e2e4"))
