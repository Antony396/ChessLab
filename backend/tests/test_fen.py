import chess
import pytest

from app.custom_chess.fen import InvalidSetupError, build_fen


def test_standard_back_ranks_produce_the_real_starting_position():
    white = {"a1": "R", "b1": "N", "c1": "B", "d1": "Q", "e1": "K", "f1": "B", "g1": "N", "h1": "R"}
    black = {"a8": "R", "b8": "N", "c8": "B", "d8": "Q", "e8": "K", "f8": "B", "g8": "N", "h8": "R"}
    fen = build_fen(white, black)
    board = chess.Board(fen)
    assert board.is_valid()
    # Board part only (castling rights differ from the real start by design).
    assert fen.split(" ")[0] == chess.STARTING_BOARD_FEN


def test_arbitrary_arrangement_is_parseable_and_keeps_pawns_in_place():
    white = {"a1": "K", "h1": "R"}  # sparse - other squares left empty
    black = {"a8": "K", "h8": "R"}
    fen = build_fen(white, black)
    board = chess.Board(fen)
    assert board.is_valid()
    assert board.piece_at(chess.A1) == chess.Piece(chess.KING, chess.WHITE)
    assert board.piece_at(chess.H1) == chess.Piece(chess.ROOK, chess.WHITE)
    assert board.piece_at(chess.B1) is None
    for file in "abcdefgh":
        assert board.piece_at(chess.parse_square(f"{file}2")) == chess.Piece(chess.PAWN, chess.WHITE)
        assert board.piece_at(chess.parse_square(f"{file}7")) == chess.Piece(chess.PAWN, chess.BLACK)


def test_rejects_missing_king():
    white = {"a1": "R"}
    black = {"a8": "K"}
    with pytest.raises(InvalidSetupError, match="exactly one king"):
        build_fen(white, black)


def test_rejects_two_kings():
    white = {"a1": "K", "b1": "K"}
    black = {"a8": "K"}
    with pytest.raises(InvalidSetupError, match="exactly one king"):
        build_fen(white, black)


def test_allows_an_extra_pawn_on_the_back_rank():
    # An extra drafted Pawn is allowed on the back rank (it starts immobile,
    # blocked by the fixed rank-2 pawn ahead of it, until that's traded off).
    white = {"a1": "K", "b1": "P"}
    black = {"a8": "K"}
    fen = build_fen(white, black)
    board = chess.Board(fen)
    assert board.piece_at(chess.B1) == chess.Piece(chess.PAWN, chess.WHITE)


def test_rejects_invalid_back_rank_letter():
    white = {"a1": "K", "b1": "X"}
    black = {"a8": "K"}
    with pytest.raises(InvalidSetupError, match="not a valid back-rank piece"):
        build_fen(white, black)


def test_rejects_square_on_wrong_rank():
    white = {"a1": "K", "b2": "N"}
    black = {"a8": "K"}
    with pytest.raises(InvalidSetupError, match="not a valid rank-1 square"):
        build_fen(white, black)


def test_no_castling_rights_granted():
    white = {"a1": "R", "e1": "K", "h1": "R"}
    black = {"a8": "R", "e8": "K", "h8": "R"}
    fen = build_fen(white, black)
    assert fen.split(" ")[2] == "-"
