"""Builds a FEN for a custom back-rank draft: pawns fixed on ranks 2 and 7,
arbitrary non-pawn pieces on ranks 1 and 8. Fully separate from the real-game
analyzer's PGN/FEN handling - this never touches app.models.game.
"""

from __future__ import annotations

FILES = "abcdefgh"
# "P" is allowed here too - an extra pawn drafted onto the back rank starts
# out immobile (its only forward square is always occupied by the fixed
# rank-2/7 pawn ahead of it) until that pawn is traded off. The resulting
# position isn't reachable through normal play (more than 8 pawns for that
# color, pawns on the back rank), same as every other custom piece here -
# custom_game_routes.py's validity check knows to tolerate exactly that.
VALID_BACK_RANK_PIECES = {"K", "Q", "R", "B", "N", "P"}


class InvalidSetupError(ValueError):
    pass


def _normalize_back_rank(pieces: dict[str, str], rank: str) -> dict[str, str]:
    normalized: dict[str, str] = {}
    king_count = 0
    for raw_square, raw_piece in pieces.items():
        square = raw_square.strip().lower()
        if len(square) != 2 or square[0] not in FILES or square[1] != rank:
            raise InvalidSetupError(f"'{raw_square}' is not a valid rank-{rank} square")
        piece_letter = raw_piece.strip().upper()
        if piece_letter not in VALID_BACK_RANK_PIECES:
            raise InvalidSetupError(f"'{raw_piece}' is not a valid back-rank piece (use K, Q, R, B, N, or P)")
        if square in normalized:
            raise InvalidSetupError(f"Square '{square}' specified more than once")
        if piece_letter == "K":
            king_count += 1
        normalized[square] = piece_letter

    if king_count != 1:
        raise InvalidSetupError(f"Rank {rank} must have exactly one king, got {king_count}")
    return normalized


def _rank_to_fen(pieces: dict[str, str], rank: str, upper: bool) -> str:
    row: list[str] = []
    empty_run = 0
    for file_letter in FILES:
        piece = pieces.get(f"{file_letter}{rank}")
        if piece is None:
            empty_run += 1
            continue
        if empty_run:
            row.append(str(empty_run))
            empty_run = 0
        row.append(piece if upper else piece.lower())
    if empty_run:
        row.append(str(empty_run))
    return "".join(row)


def build_fen(white_back_rank: dict[str, str], black_back_rank: dict[str, str], turn: str = "w") -> str:
    """white_back_rank/black_back_rank map square -> piece letter (K/Q/R/B/N),
    e.g. {"a1": "R", "b1": "N", ..., "e1": "K"}. Unspecified squares on that
    rank are empty. Pawns are always placed on ranks 2 and 7.

    No castling rights are granted (custom back ranks make the standard
    castling squares meaningless) and there's no en passant target at setup.
    """
    white = _normalize_back_rank(white_back_rank, "1")
    black = _normalize_back_rank(black_back_rank, "8")

    rank8 = _rank_to_fen(black, "8", upper=False)
    rank7 = "p" * 8
    rank2 = "P" * 8
    rank1 = _rank_to_fen(white, "1", upper=True)

    board = "/".join([rank8, rank7, "8", "8", "8", "8", rank2, rank1])
    return f"{board} {turn} - - 0 1"
