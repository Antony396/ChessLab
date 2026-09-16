"""Move execution for custom games: standard moves still go through
python-chess's own legality checking untouched; the hero pieces (Dragon,
Pope, Archer, and the rest) each bypass it for their non-standard movement
mode(s), since python-chess only ever validates moves for the real piece
type they're stored as.
"""

from __future__ import annotations

from typing import Optional

import chess

KING_STEP_OFFSETS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
KNIGHT_SHAPE_OFFSETS = [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]
# The other 8 squares at Chebyshev distance 2 from a square - straight or
# diagonal, two squares out. Together with KNIGHT_SHAPE_OFFSETS these form
# the full 16-square ring (a literal square outline two steps out) a Hydra
# jumps to - see execute_hydra_move.
HYDRA_RING_EXTRA_OFFSETS = [(-2, -2), (-2, 0), (-2, 2), (0, -2), (0, 2), (2, -2), (2, 0), (2, 2)]


class IllegalMoveError(ValueError):
    pass


def offset_squares(square: chess.Square, offsets: list[tuple[int, int]]) -> list[chess.Square]:
    file, rank = chess.square_file(square), chess.square_rank(square)
    squares = []
    for d_file, d_rank in offsets:
        f, r = file + d_file, rank + d_rank
        if 0 <= f <= 7 and 0 <= r <= 7:
            squares.append(chess.square(f, r))
    return squares


def is_king_step(from_square: chess.Square, to_square: chess.Square) -> bool:
    return to_square in offset_squares(from_square, KING_STEP_OFFSETS)


def is_knight_shape(from_square: chess.Square, to_square: chess.Square) -> bool:
    return to_square in offset_squares(from_square, KNIGHT_SHAPE_OFFSETS)


def is_hydra_ring_extra(from_square: chess.Square, to_square: chess.Square) -> bool:
    return to_square in offset_squares(from_square, HYDRA_RING_EXTRA_OFFSETS)


def leaves_own_king_in_check(board: chess.Board, color: chess.Color) -> bool:
    """True if color's king is attacked by any of the opponent's pieces via
    their STORED type's native attack pattern. Every hero piece's *extra*
    movement mode is handled separately by the caller (custom_game_routes.py's
    _in_check/_extra_threat_squares), since only that layer has the tracking
    info to know which squares hold one."""
    return board.is_attacked_by(not color, board.king(color))


def execute_standard_move(board: chess.Board, move: chess.Move) -> None:
    if move not in board.legal_moves:
        raise IllegalMoveError("That move is not legal")
    board.push(move)


def execute_dragon_move(board: chess.Board, move: chess.Move) -> None:
    """A Dragon (an evolved Knight) permanently moves like a Rook OR a
    Knight - not a toggled ability, just what the piece is from the moment
    it evolves. Internally it's stored as a Rook so python-chess's own
    legality/check-safety engine handles rook-line moves for free; for a
    knight-shaped move, the piece is temporarily swapped to a Knight to
    borrow that same legality engine (pins, checks, and all), then swapped
    back to a Rook before the move is actually committed - the board should
    never think a Dragon is "really" a Knight once it's evolved.
    """
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type != chess.ROOK:
        raise IllegalMoveError("That square doesn't hold a Dragon")

    if move in board.legal_moves:
        board.push(move)
        return

    color = piece.color
    board.set_piece_at(move.from_square, chess.Piece(chess.KNIGHT, color))
    is_knight_shaped_legal = move in board.legal_moves
    board.set_piece_at(move.from_square, piece)  # always restore Rook representation
    if not is_knight_shaped_legal:
        raise IllegalMoveError("That is not a legal Dragon move")
    board.push(move)


def execute_pope_move(board: chess.Board, move: chess.Move) -> None:
    """A Pope (an evolved Bishop) moves exactly one square in any direction,
    like a King - no diagonal-line travel at all (unlike the old Wizard this
    replaces). Stored as a Bishop, an arbitrary placeholder never relied on
    directly (same idea as the Mirror). Can't reuse the Dragon's "temporarily
    relabel and ask legal_moves" trick: relabeling as an actual King would put
    two kings on the board at once, corrupting python-chess's own check
    detection. Instead this simulates the king-step on a scratch copy and
    asks is_attacked_by directly - see custom_game_routes.py for the Pope's
    other half, the aura that lets nearby Pawns move further.
    """
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type != chess.BISHOP:
        raise IllegalMoveError("That square doesn't hold a Pope")

    if not is_king_step(move.from_square, move.to_square):
        raise IllegalMoveError("That is not a legal Pope move")

    target = board.piece_at(move.to_square)
    if target is not None and target.color == piece.color:
        raise IllegalMoveError("That square is occupied by your own piece")

    scratch = board.copy(stack=False)
    scratch.remove_piece_at(move.from_square)
    scratch.set_piece_at(move.to_square, piece)
    if leaves_own_king_in_check(scratch, piece.color):
        raise IllegalMoveError("That move would leave your king in check")

    board.push(move)


def execute_archer_move(board: chess.Board, move: chess.Move) -> None:
    """An Archer relocates exactly one square in any direction (a king's
    step) - never in the L-shape of the Knight it's stored as internally.
    That real L-shaped "knight move" python-chess would happily validate for
    it is repurposed entirely for shoot() below, so this never consults
    board.legal_moves at all.

    Move-only, never a capture - king-step relocation can't be used to take
    a piece (an enemy king included), whether by rule or just by accident of
    dropping onto an occupied square: shooting (a knight's-move away,
    non-king only) is the sole way an Archer captures.
    """
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type != chess.KNIGHT:
        raise IllegalMoveError("That square doesn't hold an Archer")
    if not is_king_step(move.from_square, move.to_square):
        raise IllegalMoveError("An Archer can only move one square in any direction")

    target = board.piece_at(move.to_square)
    if target is not None:
        raise IllegalMoveError("An Archer can only move onto an empty square - shoot to capture")

    scratch = board.copy(stack=False)
    scratch.remove_piece_at(move.from_square)
    scratch.set_piece_at(move.to_square, piece)
    if leaves_own_king_in_check(scratch, piece.color):
        raise IllegalMoveError("That move would leave your king in check")

    board.push(move)


def execute_archer_shoot(board: chess.Board, move: chess.Move) -> None:
    """An Archer can shoot a knight's-move away without relocating: the
    target is destroyed but the Archer stays put. Since no piece actually
    moves, board.push() doesn't apply - this manually replicates the parts
    of its bookkeeping a capture would normally trigger (turn flip, halfmove
    clock reset, fullmove increment, clearing any pending en passant).
    Shooting the enemy King is disallowed so checkmate stays the only way to
    win - a shot must resolve check like any other move, never end the game
    by itself.
    """
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type != chess.KNIGHT:
        raise IllegalMoveError("That square doesn't hold an Archer")
    if not is_knight_shape(move.from_square, move.to_square):
        raise IllegalMoveError("An Archer can only shoot a knight's-move away")

    target = board.piece_at(move.to_square)
    if target is None or target.color == piece.color:
        raise IllegalMoveError("An Archer must shoot an enemy piece")
    if target.piece_type == chess.KING:
        raise IllegalMoveError("The Archer cannot shoot the enemy King")

    scratch = board.copy(stack=False)
    scratch.remove_piece_at(move.to_square)
    if leaves_own_king_in_check(scratch, piece.color):
        raise IllegalMoveError("That shot would leave your king in check")

    board.remove_piece_at(move.to_square)
    board.ep_square = None
    board.halfmove_clock = 0
    if piece.color == chess.BLACK:
        board.fullmove_number += 1
    board.turn = not board.turn


def execute_mirror_archer_move(board: chess.Board, move: chess.Move) -> None:
    """A Mirror mimicking an Archer's relocate - identical rules to
    execute_archer_move (a king-step onto an empty square, move-only, never
    a capture), just validated against the Mirror's own Bishop storage
    instead of the Archer's Knight storage. See execute_mirror_move's own
    docstring for why this needs to be a separate function rather than
    another branch inside it: an Archer's relocate and shoot are two
    completely different move shapes, not "Knight plus some extra
    squares" the way a Hydra's ring is - there's no single geometry check
    that covers both, so each gets its own function exactly like the real
    Archer does."""
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type != chess.BISHOP:
        raise IllegalMoveError("That square doesn't hold a Mirror")
    if not is_king_step(move.from_square, move.to_square):
        raise IllegalMoveError("That is not a legal Mirror move")

    target = board.piece_at(move.to_square)
    if target is not None:
        raise IllegalMoveError("That is not a legal Mirror move")

    scratch = board.copy(stack=False)
    scratch.remove_piece_at(move.from_square)
    scratch.set_piece_at(move.to_square, piece)
    if leaves_own_king_in_check(scratch, piece.color):
        raise IllegalMoveError("That move would leave your king in check")

    board.push(move)


def execute_mirror_archer_shoot(board: chess.Board, move: chess.Move) -> None:
    """A Mirror mimicking an Archer's shoot - identical rules to
    execute_archer_shoot (a knight's-move-away non-relocating capture, never
    the enemy King), just validated against the Mirror's own Bishop storage.
    See execute_mirror_archer_move's docstring for why this is separate."""
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type != chess.BISHOP:
        raise IllegalMoveError("That square doesn't hold a Mirror")
    if not is_knight_shape(move.from_square, move.to_square):
        raise IllegalMoveError("That is not a legal Mirror shot")

    target = board.piece_at(move.to_square)
    if target is None or target.color == piece.color:
        raise IllegalMoveError("That is not a legal Mirror shot")
    if target.piece_type == chess.KING:
        raise IllegalMoveError("The Mirror cannot shoot the enemy King")

    scratch = board.copy(stack=False)
    scratch.remove_piece_at(move.to_square)
    if leaves_own_king_in_check(scratch, piece.color):
        raise IllegalMoveError("That shot would leave your king in check")

    board.remove_piece_at(move.to_square)
    board.ep_square = None
    board.halfmove_clock = 0
    if piece.color == chess.BLACK:
        board.fullmove_number += 1
    board.turn = not board.turn


def execute_hydra_move(board: chess.Board, move: chess.Move) -> None:
    """A Hydra jumps to any square at Chebyshev distance exactly 2 - a
    knight's-L shape, straight two squares, or diagonal two squares - the
    full ring forming a literal square outline two steps out. It can NEVER
    move just one square in any direction (no king-step at all, unlike the
    Wizard/Archer/Hydra's own earlier design). Stored as a Knight, so the
    knight-shaped third of that ring is just python-chess's own legality
    check for free (pins, checks, and all); the other two thirds
    (straight-two and diagonal-two) need the Pope's scratch-board
    technique instead, since neither matches any real piece's native
    movement.
    """
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type != chess.KNIGHT:
        raise IllegalMoveError("That square doesn't hold a Hydra")

    if move in board.legal_moves:
        board.push(move)
        return

    if not is_hydra_ring_extra(move.from_square, move.to_square):
        raise IllegalMoveError("That is not a legal Hydra move")

    target = board.piece_at(move.to_square)
    if target is not None and target.color == piece.color:
        raise IllegalMoveError("That square is occupied by your own piece")

    scratch = board.copy(stack=False)
    scratch.remove_piece_at(move.from_square)
    scratch.set_piece_at(move.to_square, piece)
    if leaves_own_king_in_check(scratch, piece.color):
        raise IllegalMoveError("That move would leave your king in check")

    board.push(move)


def cyclops_special_capture_square(from_square: chess.Square, color: chess.Color) -> Optional[chess.Square]:
    """The one square a Cyclops's extra special capture threatens: two
    squares diagonally toward its own forward-left (the file direction on
    White's left hand facing the opponent, or Black's left hand facing the
    other way) - on top of, not instead of, a real Pawn's plain one-square
    diagonal capture in either direction, which a Cyclops keeps. Returns
    None if that square would fall off the board."""
    file = chess.square_file(from_square)
    rank = chess.square_rank(from_square)
    d_file, d_rank = (-2, 2) if color == chess.WHITE else (2, -2)
    f, r = file + d_file, rank + d_rank
    if 0 <= f <= 7 and 0 <= r <= 7:
        return chess.square(f, r)
    return None


def execute_cyclops_move(board: chess.Board, move: chess.Move) -> None:
    """A Cyclops moves and captures exactly like a real Pawn (forward push,
    two-square first move, plain one-square diagonal capture in either
    direction, promotion, en passant - all free from python-chess's own
    legality, since it's stored as one), PLUS one extra capture: a
    two-square hop diagonally to its own forward-left. That extra hop is a
    jump (like the Archer's shoot, nothing in between matters), only ever a
    capture (never a plain relocation), and can never target the enemy King,
    so checkmate stays the only way to win.
    """
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type != chess.PAWN:
        raise IllegalMoveError("That square doesn't hold a Cyclops")

    if move in board.legal_moves:
        board.push(move)
        return

    if move.to_square != cyclops_special_capture_square(move.from_square, piece.color):
        raise IllegalMoveError("That is not a legal Cyclops move")

    target = board.piece_at(move.to_square)
    if target is None or target.color == piece.color:
        raise IllegalMoveError("A Cyclops must capture an enemy piece with that move")
    if target.piece_type == chess.KING:
        raise IllegalMoveError("The Cyclops cannot capture the enemy King")

    scratch = board.copy(stack=False)
    scratch.remove_piece_at(move.from_square)
    scratch.set_piece_at(move.to_square, piece)
    if leaves_own_king_in_check(scratch, piece.color):
        raise IllegalMoveError("That move would leave your king in check")

    landed_piece = piece
    if move.promotion is not None and chess.square_rank(move.to_square) in (0, 7):
        landed_piece = chess.Piece(move.promotion, piece.color)

    board.remove_piece_at(move.from_square)
    board.set_piece_at(move.to_square, landed_piece)
    board.ep_square = None
    board.halfmove_clock = 0
    if piece.color == chess.BLACK:
        board.fullmove_number += 1
    board.turn = not board.turn


def execute_mirror_move(
    board: chess.Board,
    move: chess.Move,
    mimic_piece_type: chess.PieceType,
    mimic_is_hydra: bool = False,
    mimic_is_pope: bool = False,
) -> None:
    """A Mirror moves exactly like whatever base piece type
    (custom_game_routes.py resolves this down to one of the six standard
    types first - see its design note) the opponent most recently moved.
    Stored as a Bishop, an arbitrary placeholder never relied on directly:
    every mimicked type except King is checked by temporarily relabeling to
    it and asking python-chess's own legality, the same trick the Dragon
    uses between Rook and Knight (safe since none of Queen/Rook/Bishop/
    Knight/Pawn need to stay unique on the board); King mimicry can't reuse
    that trick (a second King would corrupt python-chess's own check
    detection) so it's validated with the Pope's scratch-board technique
    instead.

    mimic_is_hydra additionally flags "the Knight being mimicked was
    specifically a Hydra" - the relabel trick alone only ever validates a
    *plain* Knight move, since board.legal_moves has no idea a Hydra's
    ring-extra (straight-two/diagonal-two) squares exist at all. Without
    this, a Mirror could copy the knight-shaped third of a Hydra's last
    move but never the other two thirds, which is exactly the "couldn't
    copy a Hydra in some cases" bug this fixes - reuses the same
    ring-extra-or-legal check execute_hydra_move itself does.

    mimic_is_pope is the same idea for a Bishop being mimicked: a Pope has
    no native diagonal-line movement at all (see execute_pope_move), so the
    relabel-to-Bishop trick would validate the wrong geometry entirely -
    the whole diagonal instead of one king-step. Routed into the exact same
    king-step-plus-scratch-board branch King mimicry already uses below,
    since a Pope's king-step (can capture, blocked only by its own color)
    is identical to a King's own move in every way that matters here.
    """
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type != chess.BISHOP:
        raise IllegalMoveError("That square doesn't hold a Mirror")
    color = piece.color

    if mimic_piece_type == chess.KING or (mimic_piece_type == chess.BISHOP and mimic_is_pope):
        if not is_king_step(move.from_square, move.to_square):
            raise IllegalMoveError("That is not a legal Mirror move")
        target = board.piece_at(move.to_square)
        if target is not None and target.color == color:
            raise IllegalMoveError("That square is occupied by your own piece")
        scratch = board.copy(stack=False)
        scratch.remove_piece_at(move.from_square)
        scratch.set_piece_at(move.to_square, piece)
        if leaves_own_king_in_check(scratch, color):
            raise IllegalMoveError("That move would leave your king in check")
        board.push(move)
        return

    if mimic_piece_type == chess.KNIGHT and mimic_is_hydra:
        board.set_piece_at(move.from_square, chess.Piece(chess.KNIGHT, color))
        is_legal_as_knight = move in board.legal_moves
        board.set_piece_at(move.from_square, piece)  # always restore Bishop representation
        if is_legal_as_knight:
            board.push(move)
            return
        if not is_hydra_ring_extra(move.from_square, move.to_square):
            raise IllegalMoveError("That is not a legal Mirror move")
        target = board.piece_at(move.to_square)
        if target is not None and target.color == color:
            raise IllegalMoveError("That square is occupied by your own piece")
        scratch = board.copy(stack=False)
        scratch.remove_piece_at(move.from_square)
        scratch.set_piece_at(move.to_square, piece)
        if leaves_own_king_in_check(scratch, color):
            raise IllegalMoveError("That move would leave your king in check")
        board.push(move)
        return

    board.set_piece_at(move.from_square, chess.Piece(mimic_piece_type, color))
    is_legal_as_mimic = move in board.legal_moves
    board.set_piece_at(move.from_square, piece)  # always restore Bishop representation
    if not is_legal_as_mimic:
        raise IllegalMoveError("That is not a legal Mirror move")
    # A Pawn-mimicking move to the back rank needs move.promotion set for the
    # relabeled-Pawn legality check just above to match a real legal move at
    # all - but the Mirror itself is still a Bishop, and python-chess's own
    # push() applies move.promotion to WHATEVER piece is actually at
    # from_square, promotion-eligible or not (it doesn't re-check piece
    # type). Pushed as-is, the Mirror would be silently replaced by a real
    # Queen, permanently losing its Mirror-ness. Strip the promotion before
    # actually applying the move so the Bishop just relocates, exactly like
    # every other mimicked type.
    board.push(chess.Move(move.from_square, move.to_square) if move.promotion else move)


# --- Pope aura: nearby Pawns move further -----------------------------
#
# The Pope's other half (see execute_pope_move above): any of its own
# side's plain Pawns (never a Cyclops - that's a distinct hero identity
# with its own special move already) within one square of an allied Pope
# can push two squares forward from ANYWHERE, not just their own starting
# rank, and can capture two squares diagonally forward in EITHER direction
# (a jump, like the Cyclops's own special hop - never the enemy King, so
# checkmate stays the only way to win). Unlike every other hero piece,
# this isn't a fixed identity tracked by its own square set - it's a live,
# position-dependent effect any ordinary Pawn can have or lose purely by
# walking in and out of an allied Pope's radius.


def is_within_pope_aura(pope_square: Optional[chess.Square], square: chess.Square) -> bool:
    if pope_square is None:
        return False
    d_file = abs(chess.square_file(pope_square) - chess.square_file(square))
    d_rank = abs(chess.square_rank(pope_square) - chess.square_rank(square))
    return max(d_file, d_rank) <= 1


def pope_boosted_forward_square(from_square: chess.Square, color: chess.Color) -> Optional[chess.Square]:
    """Two squares straight ahead, regardless of rank (a normal Pawn only
    ever gets this from its own starting rank) - still needs the square
    directly ahead AND this one both empty, same as a normal double-step;
    this only extends how far, not whether the path must be clear."""
    file = chess.square_file(from_square)
    rank = chess.square_rank(from_square) + (2 if color == chess.WHITE else -2)
    if 0 <= rank <= 7:
        return chess.square(file, rank)
    return None


def pope_boosted_diagonal_capture_squares(from_square: chess.Square, color: chess.Color) -> list[chess.Square]:
    """Both two-square diagonal jumps forward - a real Pawn's own diagonal
    capture only ever reaches one square, and even the Cyclops's extra hop
    only ever covers its forward-LEFT; this covers both directions."""
    file = chess.square_file(from_square)
    rank = chess.square_rank(from_square) + (2 if color == chess.WHITE else -2)
    squares = []
    for d_file in (-2, 2):
        f = file + d_file
        if 0 <= f <= 7 and 0 <= rank <= 7:
            squares.append(chess.square(f, rank))
    return squares


def execute_boosted_pawn_move(board: chess.Board, move: chess.Move, pope_square: Optional[chess.Square]) -> None:
    """A plain Pawn's move, extended by a nearby allied Pope - see the
    module note above. Tries a normal pseudo-legal Pawn move first (a
    Pope's aura doesn't take anything away, only adds), so this only ever
    needs the aura-specific geometry for the genuinely new destinations."""
    piece = board.piece_at(move.from_square)
    if piece is None or piece.piece_type != chess.PAWN:
        raise IllegalMoveError("That square doesn't hold a Pawn")

    if move in board.legal_moves:
        board.push(move)
        return

    if not is_within_pope_aura(pope_square, move.from_square):
        raise IllegalMoveError("That is not a legal Pawn move")

    color = piece.color
    is_capture = False
    if move.to_square == pope_boosted_forward_square(move.from_square, color):
        one_ahead_rank = chess.square_rank(move.from_square) + (1 if color == chess.WHITE else -1)
        one_ahead = chess.square(chess.square_file(move.from_square), one_ahead_rank)
        if board.piece_at(one_ahead) is not None or board.piece_at(move.to_square) is not None:
            raise IllegalMoveError("Something is in the way")
    elif move.to_square in pope_boosted_diagonal_capture_squares(move.from_square, color):
        target = board.piece_at(move.to_square)
        if target is None or target.color == color:
            raise IllegalMoveError("A boosted Pawn must capture an enemy piece with that move")
        if target.piece_type == chess.KING:
            raise IllegalMoveError("A Pawn cannot capture the enemy King this way")
        is_capture = True
    else:
        raise IllegalMoveError("That is not a legal Pawn move")

    scratch = board.copy(stack=False)
    scratch.remove_piece_at(move.from_square)
    if is_capture:
        scratch.remove_piece_at(move.to_square)
    scratch.set_piece_at(move.to_square, piece)
    if leaves_own_king_in_check(scratch, color):
        raise IllegalMoveError("That move would leave your king in check")

    landed_piece = piece
    if move.promotion is not None and chess.square_rank(move.to_square) in (0, 7):
        landed_piece = chess.Piece(move.promotion, color)

    board.remove_piece_at(move.from_square)
    if is_capture:
        board.remove_piece_at(move.to_square)
    board.set_piece_at(move.to_square, landed_piece)
    board.ep_square = None
    board.halfmove_clock = 0
    if color == chess.BLACK:
        board.fullmove_number += 1
    board.turn = not board.turn
