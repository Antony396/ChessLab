"""Hydra (jumps to any square at Chebyshev distance exactly 2 - knight-shape,
straight-two, or diagonal-two - and NEVER just one square, 12pts), Cyclops
(Pawn push + capture, plus an extra 2-square forward-left-only capture,
2pts), and Mirror (mimics whatever base type the opponent last moved, 5pts)
- the three newest hero pieces. Mirrors the style of test_rules.py (bare-board
unit checks) and test_dragon.py/test_wizard_archer_checkmate.py (route-level
integration)."""

import chess
import pytest

from app.api import custom_game_routes as routes
from app.custom_chess import rules
from app.custom_chess import store
from app.custom_chess.models import CustomSetupRequest


def _board(pieces, turn=chess.WHITE):
    board = chess.Board(None)
    for square, piece in pieces.items():
        board.set_piece_at(square, piece)
    board.turn = turn
    return board


def _kings(color_a=chess.WHITE, color_b=chess.BLACK):
    return {chess.E1: chess.Piece(chess.KING, color_a), chess.E8: chess.Piece(chess.KING, color_b)}


# --- Hydra ------------------------------------------------------------


def test_hydra_moves_like_knight():
    board = _board({**_kings(), chess.A1: chess.Piece(chess.KNIGHT, chess.WHITE)})
    rules.execute_hydra_move(board, chess.Move.from_uci("a1b3"))
    assert board.piece_at(chess.B3).piece_type == chess.KNIGHT


def test_hydra_moves_two_squares_straight():
    board = _board({**_kings(), chess.B3: chess.Piece(chess.KNIGHT, chess.WHITE)})
    rules.execute_hydra_move(board, chess.Move.from_uci("b3b5"))
    assert board.piece_at(chess.B5) is not None


def test_hydra_moves_two_squares_diagonal():
    board = _board({**_kings(), chess.B3: chess.Piece(chess.KNIGHT, chess.WHITE)})
    rules.execute_hydra_move(board, chess.Move.from_uci("b3d5"))
    assert board.piece_at(chess.D5) is not None


def test_hydra_cannot_move_one_square_like_a_king():
    board = _board({**_kings(), chess.B3: chess.Piece(chess.KNIGHT, chess.WHITE)})
    with pytest.raises(rules.IllegalMoveError):
        rules.execute_hydra_move(board, chess.Move.from_uci("b3b4"))


def test_hydra_rejects_a_shape_outside_the_ring():
    board = _board({**_kings(), chess.B4: chess.Piece(chess.KNIGHT, chess.WHITE)})
    with pytest.raises(rules.IllegalMoveError):
        rules.execute_hydra_move(board, chess.Move.from_uci("b4c5"))  # one diagonal square, not two


def test_hydra_ring_extra_move_respects_check_safety():
    # White king on e1, black Rook pinning down the e-file, Hydra directly
    # between them - a straight-two move sideways is a real ring-extra
    # move (not knight-shaped, so python-chess's native legality can't
    # catch this) but must still be rejected for exposing check.
    board = _board(
        {
            chess.E1: chess.Piece(chess.KING, chess.WHITE),
            chess.E8: chess.Piece(chess.KING, chess.BLACK),
            chess.E4: chess.Piece(chess.KNIGHT, chess.WHITE),
            chess.E7: chess.Piece(chess.ROOK, chess.BLACK),
        }
    )
    with pytest.raises(rules.IllegalMoveError):
        rules.execute_hydra_move(board, chess.Move.from_uci("e4c4"))  # straight-two off the pin file


# --- Cyclops ------------------------------------------------------------


def test_cyclops_forward_push_reuses_pawn_legality():
    board = _board({**_kings(), chess.D2: chess.Piece(chess.PAWN, chess.WHITE)})
    rules.execute_cyclops_move(board, chess.Move.from_uci("d2d4"))
    assert board.piece_at(chess.D4).piece_type == chess.PAWN


def test_cyclops_captures_two_squares_forward_left():
    board = _board(
        {**_kings(), chess.D4: chess.Piece(chess.PAWN, chess.WHITE), chess.B6: chess.Piece(chess.KNIGHT, chess.BLACK)}
    )
    rules.execute_cyclops_move(board, chess.Move.from_uci("d4b6"))
    assert board.piece_at(chess.B6) == chess.Piece(chess.PAWN, chess.WHITE)


def test_cyclops_still_captures_a_plain_one_square_diagonal_like_a_pawn():
    board = _board(
        {**_kings(), chess.D3: chess.Piece(chess.PAWN, chess.WHITE), chess.E4: chess.Piece(chess.KNIGHT, chess.BLACK)}
    )
    rules.execute_cyclops_move(board, chess.Move.from_uci("d3e4"))
    assert board.piece_at(chess.E4) == chess.Piece(chess.PAWN, chess.WHITE)


def test_cyclops_rejects_two_square_forward_right_capture():
    board = _board(
        {**_kings(), chess.D3: chess.Piece(chess.PAWN, chess.WHITE), chess.F5: chess.Piece(chess.KNIGHT, chess.BLACK)}
    )
    with pytest.raises(rules.IllegalMoveError):
        rules.execute_cyclops_move(board, chess.Move.from_uci("d3f5"))


def test_cyclops_cannot_capture_the_king():
    board = _board({chess.E1: chess.Piece(chess.KING, chess.WHITE), chess.D3: chess.Piece(chess.PAWN, chess.WHITE), chess.B5: chess.Piece(chess.KING, chess.BLACK)})
    with pytest.raises(rules.IllegalMoveError):
        rules.execute_cyclops_move(board, chess.Move.from_uci("d3b5"))


def test_cyclops_special_capture_target_helper():
    assert rules.cyclops_special_capture_square(chess.D4, chess.WHITE) == chess.B6
    assert rules.cyclops_special_capture_square(chess.D4, chess.BLACK) == chess.F2
    assert rules.cyclops_special_capture_square(chess.A4, chess.WHITE) is None  # off the board


# --- Mirror ------------------------------------------------------------


def test_mirror_mimics_knight():
    board = _board({**_kings(), chess.A1: chess.Piece(chess.BISHOP, chess.WHITE)})
    rules.execute_mirror_move(board, chess.Move.from_uci("a1b3"), chess.KNIGHT)
    assert board.piece_at(chess.B3).piece_type == chess.BISHOP  # storage never changes


def test_mirror_rejects_move_not_matching_mimicked_type():
    board = _board({**_kings(), chess.A1: chess.Piece(chess.BISHOP, chess.WHITE)})
    with pytest.raises(rules.IllegalMoveError):
        rules.execute_mirror_move(board, chess.Move.from_uci("a1a4"), chess.KNIGHT)


def test_mirror_mimics_rook():
    board = _board({**_kings(), chess.A1: chess.Piece(chess.BISHOP, chess.WHITE)})
    rules.execute_mirror_move(board, chess.Move.from_uci("a1a4"), chess.ROOK)
    assert board.piece_at(chess.A4) is not None


def test_mirror_mimics_king_step():
    board = _board({**_kings(), chess.D4: chess.Piece(chess.BISHOP, chess.WHITE)})
    rules.execute_mirror_move(board, chess.Move.from_uci("d4e5"), chess.KING)
    assert board.piece_at(chess.E5) is not None


def test_mirror_king_mimic_respects_check_safety():
    board = _board(
        {
            chess.E1: chess.Piece(chess.KING, chess.WHITE),
            chess.E8: chess.Piece(chess.KING, chess.BLACK),
            chess.E2: chess.Piece(chess.BISHOP, chess.WHITE),
            chess.E7: chess.Piece(chess.ROOK, chess.BLACK),
        }
    )
    with pytest.raises(rules.IllegalMoveError):
        rules.execute_mirror_move(board, chess.Move.from_uci("e2d3"), chess.KING)


# --- Route-level integration --------------------------------------------


def _make_game(white_back_rank, black_back_rank):
    payload = CustomSetupRequest(
        white_back_rank=white_back_rank, black_back_rank=black_back_rank, white_evolved_squares=[], vs_ai=False
    )
    return routes._build_game_from_setup(payload, enforce_points_budget=False)


def test_point_costs_for_new_pieces():
    back_rank = {"e1": "K", "a1": "H", "b1": "C", "c1": "M"}
    assert routes._compute_deck_points(back_rank, []) == routes.HYDRA_COST + routes.CYCLOPS_COST + routes.MIRROR_COST
    assert routes.HYDRA_COST == 12
    assert routes.CYCLOPS_COST == 2
    assert routes.MIRROR_COST == 5


def test_draft_and_track_all_three():
    game = _make_game({"e1": "K", "a1": "H", "b1": "C", "c1": "M"}, {"e8": "K"})
    assert game.white_hydra_squares == {chess.A1}
    assert game.white_cyclops_squares == {chess.B1}
    assert game.white_mirror_squares == {chess.C1}


def test_mirror_has_no_move_before_opponent_has_moved():
    game = _make_game({"e1": "K", "a1": "M"}, {"e8": "K"})
    with pytest.raises(rules.IllegalMoveError):
        routes._apply_move(game, chess.WHITE, chess.A1, chess.A2, False, "a1", "a2")


def test_mirror_mimics_opponents_last_moved_base_type_end_to_end():
    game = _make_game({"e1": "K", "a1": "H", "c1": "M"}, {"e8": "K", "b8": "N"})
    routes._apply_move(game, chess.WHITE, chess.A1, chess.B3, False, "a1", "b3")  # White moves first
    routes._apply_move(game, chess.BLACK, chess.B8, chess.C6, False, "b8", "c6")  # Black moves a Knight
    assert game.black_last_moved_type == chess.KNIGHT

    # d3 is the one knight-shape destination from c1 not blocked by the
    # fixed rank-2 pawns or White's own Hydra (already on b3).
    routes._apply_move(game, chess.WHITE, chess.C1, chess.D3, False, "c1", "d3")
    assert game.white_mirror_squares == {chess.D3}
    # The Mirror's own move records what it MIMICKED, not its Bishop storage.
    assert game.white_last_moved_type == chess.KNIGHT


def test_cyclops_plain_diagonal_gives_check_like_a_real_pawn():
    """A Cyclops sitting one square diagonally from the enemy king gives
    check exactly like a real Pawn would - this is just python-chess's own
    native attack detection, but locks in that nothing here suppresses it."""
    board = chess.Board(None)
    board.set_piece_at(chess.E1, chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(chess.E8, chess.Piece(chess.KING, chess.BLACK))
    board.set_piece_at(chess.D7, chess.Piece(chess.PAWN, chess.WHITE))  # Cyclops, one diagonal step from e8
    board.turn = chess.BLACK
    game = store.create_game(board, white_cyclops_squares={chess.D7})
    assert routes._in_check(game, chess.BLACK) is True


def test_cyclops_extra_far_left_threat_also_gives_check():
    """The Cyclops's extra two-square forward-left hop ALSO gives check -
    the one mode python-chess's native attack detection can't see at all."""
    board = chess.Board(None)
    board.set_piece_at(chess.E1, chess.Piece(chess.KING, chess.WHITE))
    board.set_piece_at(chess.B7, chess.Piece(chess.KING, chess.BLACK))
    board.set_piece_at(chess.D5, chess.Piece(chess.PAWN, chess.WHITE))  # Cyclops
    board.turn = chess.BLACK
    assert rules.cyclops_special_capture_square(chess.D5, chess.WHITE) == chess.B7
    game = store.create_game(board, white_cyclops_squares={chess.D5})
    assert routes._in_check(game, chess.BLACK) is True
