from __future__ import annotations

from typing import Optional

import chess
from fastapi import APIRouter, HTTPException

from app.custom_chess import ai
from app.custom_chess import fen as fen_utils
from app.custom_chess import hero_ai
from app.custom_chess import rules
from app.custom_chess import store
from app.custom_chess.models import CustomGameState, CustomMoveRequest, CustomSetupRequest, EvolutionSnapshot

router = APIRouter()

STANDARD_BACK_RANK_LETTERS = "RNBQKBNR"
DRAGON_COST = 8
POPE_COST = 6
ARCHER_COST = 6
HYDRA_COST = 12
CYCLOPS_COST = 2
MIRROR_COST = 5
PAWN_COST = 1
POINT_COSTS = {
    "K": 0,
    "Q": 9,
    "R": 5,
    "B": 3,
    "N": 3,
    "D": DRAGON_COST,
    "H": HYDRA_COST,
    "C": CYCLOPS_COST,
    "M": MIRROR_COST,
    "P": PAWN_COST,
}
MAX_DECK_POINTS = 31

# Dragon/Hydra/Cyclops/Mirror are drafted directly, not evolved - each draft
# letter isn't a real FEN piece letter, so it's translated to the closest
# real type before build_fen, then recovered afterwards as a tracked-squares
# set. A Dragon needs a Rook's native line movement, a Hydra needs a Knight's
# native jump, a Cyclops needs a Pawn's native forward push, a Mirror is
# stored as a Bishop (an arbitrary placeholder - see rules.execute_mirror_move).
HERO_DRAFT_LETTER_TO_STORED = {"D": "R", "H": "N", "C": "P", "M": "B"}


def _standard_back_rank(rank: str) -> dict[str, str]:
    return {f"{file}{rank}": letter for file, letter in zip("abcdefgh", STANDARD_BACK_RANK_LETTERS)}


def _compute_deck_points(back_rank: dict[str, str], evolved_squares: list[str]) -> int:
    evolved = {s.strip().lower() for s in evolved_squares}
    total = 0
    for square, letter in back_rank.items():
        letter = letter.strip().upper()
        square = square.strip().lower()
        if square in evolved and letter == "N":
            total += ARCHER_COST
        elif square in evolved and letter == "B":
            total += POPE_COST
        else:
            total += POINT_COSTS.get(letter, 0)
    return total


# --- Check detection for evolved pieces --------------------------------
#
# Every evolved/hero piece is stored as the closest real python-chess piece
# type (Dragon=Rook, Pope=Bishop, Archer=Knight) so the board stays a valid,
# serializable position. python-chess's own board.is_check()/is_attacked_by()
# only ever look at a piece's STORED type's native attack pattern, so they
# have a blind spot for exactly the movement mode that makes each piece
# special:
#   - a Dragon threatens the enemy king via a knight-shaped hop that a Rook
#     could never make
#   - a Pope threatens it via a one-square king-step that a Bishop could
#     never make (its only movement mode)
#   - a Pawn boosted by a nearby Pope's aura threatens the enemy king via a
#     two-square diagonal capture jump that a plain Pawn could never make
#
# An Archer is deliberately NOT in this list, even though it's stored as a
# Knight and so has the exact same blind-spot shape as the others: its
# relocate is move-only (execute_archer_move rejects ANY occupied target,
# friend or foe - "shoot to capture" is right there in the error message),
# and its shoot explicitly refuses the enemy King as a target
# (execute_archer_shoot's own check). Neither mode can ever actually
# capture a king, so an Archer poses no real threat to it at all - the
# code used to add a king-step "threat" around the Archer anyway (probably
# copied from the Pope case above without noticing the Pope's king-step
# CAN capture), which had the enemy king unable to stand next to an Archer
# at all, ever, for no real reason - "king can't come close to archer" was
# a real, reported bug from exactly this.
#
# Without accounting for the pieces above, a side could simply ignore a
# Dragon/Pope/boosted-Pawn's threat against their own king (since
# python-chess never flags it as check), or even have their king actually
# captured outright by one of these moves - the checkmate rule that's
# supposed to prevent that entirely depends on check being detected
# correctly in the first place. Everything below layers the missing threat
# squares on top of python-chess's own attack detection, and is used both
# to reject a mover's own move that leaves them exposed (_apply_move) and
# to compute true checkmate/stalemate (_compute_status).


def _mirror_current_mimic_type(game: store.CustomGame, mirror_owner_color: chess.Color) -> Optional[chess.PieceType]:
    """A Mirror moves like whatever the OPPONENT of its own color most
    recently moved - so White's Mirror reads Black's last-moved-type field,
    and vice versa. None until that opponent has moved at all."""
    return game.black_last_moved_type if mirror_owner_color == chess.WHITE else game.white_last_moved_type


def _mirror_current_mimic_is_hydra(game: store.CustomGame, mirror_owner_color: chess.Color) -> bool:
    """Companion to _mirror_current_mimic_type: True when the opponent's
    last move (whatever set that KNIGHT-typed field) was specifically a
    Hydra move, so execute_mirror_move/threat-square code know a Hydra's
    ring-extra squares are in play, not just a plain Knight/Archer move."""
    return game.black_last_moved_was_hydra if mirror_owner_color == chess.WHITE else game.white_last_moved_was_hydra


def _mirror_current_mimic_is_archer(game: store.CustomGame, mirror_owner_color: chess.Color) -> bool:
    """Companion to _mirror_current_mimic_type, parallel to
    _mirror_current_mimic_is_hydra above: True when the opponent's last
    move (whatever set that KNIGHT-typed field) was specifically an
    Archer's relocate or shoot - both recorded under the same KNIGHT type
    as a plain Knight or a Hydra move, since that's the Archer's storage
    type. Without this, a Mirror had no way to tell the three apart and
    fell through to a plain Knight's L-shaped legal_moves check, which an
    Archer's king-step relocate always fails (wrongly rejecting a move
    that should be legal) and its knight-shape shoot only passes by
    geometric coincidence while getting the wrong semantics (relocating
    onto the square instead of shooting it from afar and staying put) -
    this was the actual "Archer isn't being mirrored properly" bug. See
    execute_mirror_archer_move/execute_mirror_archer_shoot."""
    return game.black_last_moved_was_archer if mirror_owner_color == chess.WHITE else game.white_last_moved_was_archer


def _mirror_current_mimic_is_pope(game: store.CustomGame, mirror_owner_color: chess.Color) -> bool:
    """Companion to _mirror_current_mimic_type, parallel to
    _mirror_current_mimic_is_hydra/_mirror_current_mimic_is_archer above:
    True when the opponent's last move (whatever set that BISHOP-typed
    field) was specifically a Pope's king-step, not a real Bishop's
    diagonal-line move. Without this a Mirror had no way to tell the two
    apart and mimicked a full diagonal instead of one king-step - a much
    broader (and wrong) move/threat pattern than the Pope it was actually
    copying. See execute_mirror_move's mimic_is_pope parameter."""
    return game.black_last_moved_was_pope if mirror_owner_color == chess.WHITE else game.white_last_moved_was_pope


def _mirror_threat_squares(
    board: chess.Board,
    mirror_square: chess.Square,
    mimic_type: chess.PieceType,
    mimic_is_hydra: bool = False,
    mimic_is_pope: bool = False,
) -> set[chess.Square]:
    """Squares a Mirror currently threatens, given it's mimicking
    mimic_type. King mimicry is pure geometry (mirroring the Pope's
    king-step threat above); every other type reuses python-chess's own
    board.attacks() on a scratch copy with the Mirror's real Bishop
    temporarily swapped for the mimicked type - correctly blocked by
    whatever's actually on the board, and correctly excluding a Pawn's
    forward (non-attacking) push. mimic_is_hydra additionally layers on a
    Hydra's ring-extra squares (see _extra_threat_squares), invisible to
    board.attacks() the same way they're invisible to board.legal_moves.
    No equivalent parameter for mimicking an Archer: a Mirror copying one
    poses exactly the same non-threat to a king that a real Archer does
    (see _extra_threat_squares's own docstring for why) - the knight-shape
    portion (its shoot) is already covered by scratch.attacks() above, same
    as a plain Knight/Hydra, and its relocate mode can't capture anything
    at all, so there's nothing further to add here.

    mimic_is_pope routes a mimicked Bishop into the exact same king-step
    geometry as King mimicry instead of falling through to
    scratch.attacks() - a Pope has no native diagonal-line movement at all
    (see execute_pope_move), so treating it as a real Bishop threatened the
    whole diagonal instead of the one square a Pope's king-step actually
    reaches (the bug this fixes: a Mirror mimicking a Pope could make a
    king unable to move anywhere along that phantom diagonal)."""
    if mimic_type == chess.KING or (mimic_type == chess.BISHOP and mimic_is_pope):
        return set(rules.offset_squares(mirror_square, rules.KING_STEP_OFFSETS))
    piece = board.piece_at(mirror_square)
    if piece is None:
        return set()
    scratch = board.copy(stack=False)
    scratch.set_piece_at(mirror_square, chess.Piece(mimic_type, piece.color))
    squares = set(scratch.attacks(mirror_square))
    if mimic_is_hydra and mimic_type == chess.KNIGHT:
        squares.update(rules.offset_squares(mirror_square, rules.HYDRA_RING_EXTRA_OFFSETS))
    return squares


def _boosted_pawn_threat_squares(game: store.CustomGame, pope_square: Optional[chess.Square], color: chess.Color) -> set[chess.Square]:
    """Squares a color's own plain Pawns threaten via the Pope's aura - the
    two-square diagonal capture jump (see rules.pope_boosted_diagonal_capture_squares),
    invisible to python-chess's own attack detection the same way every
    other hero-special mode is. The aura's forward push isn't a capture, so
    it never threatens anything and has no analog here. A Cyclops is stored
    as a Pawn too but is a distinct hero identity with its own special move
    already, so it's excluded here - the aura only ever boosts PLAIN Pawns."""
    squares: set[chess.Square] = set()
    if pope_square is None:
        return squares
    cyclops_squares = game.white_cyclops_squares if color == chess.WHITE else game.black_cyclops_squares
    for square in game.board.pieces(chess.PAWN, color):
        if square in cyclops_squares:
            continue
        if rules.is_within_pope_aura(pope_square, square):
            squares.update(rules.pope_boosted_diagonal_capture_squares(square, color))
    return squares


def _extra_threat_squares(game: store.CustomGame, attacker_color: chess.Color) -> set[chess.Square]:
    """Squares attacked by attacker_color's hero pieces via a movement mode
    python-chess's own attack detection doesn't know about."""
    squares: set[chess.Square] = set()

    dragon_squares = game.white_dragon_squares if attacker_color == chess.WHITE else game.black_dragon_squares
    for dragon_square in dragon_squares:
        squares.update(rules.offset_squares(dragon_square, rules.KNIGHT_SHAPE_OFFSETS))

    pope_square = game.white_pope_square if attacker_color == chess.WHITE else game.black_pope_square
    if pope_square is not None:
        squares.update(rules.offset_squares(pope_square, rules.KING_STEP_OFFSETS))
    squares.update(_boosted_pawn_threat_squares(game, pope_square, attacker_color))

    # No entry for the Archer here on purpose - see this function's own
    # section docstring above for why it poses no direct threat to a king
    # at all, unlike every other hero piece in this list.

    # A Hydra's knight-shaped third of its ring is already covered by
    # python-chess's own native attack detection (it's stored as a real
    # Knight) - only the other two thirds (straight-two/diagonal-two) are
    # invisible to it.
    hydra_squares = game.white_hydra_squares if attacker_color == chess.WHITE else game.black_hydra_squares
    for hydra_square in hydra_squares:
        squares.update(rules.offset_squares(hydra_square, rules.HYDRA_RING_EXTRA_OFFSETS))

    cyclops_squares = game.white_cyclops_squares if attacker_color == chess.WHITE else game.black_cyclops_squares
    for cyclops_square in cyclops_squares:
        dest = rules.cyclops_special_capture_square(cyclops_square, attacker_color)
        if dest is not None:
            squares.add(dest)

    mirror_squares = game.white_mirror_squares if attacker_color == chess.WHITE else game.black_mirror_squares
    if mirror_squares:
        mimic_type = _mirror_current_mimic_type(game, attacker_color)
        if mimic_type is not None:
            mimic_is_hydra = _mirror_current_mimic_is_hydra(game, attacker_color)
            mimic_is_pope = _mirror_current_mimic_is_pope(game, attacker_color)
            for mirror_square in mirror_squares:
                squares.update(_mirror_threat_squares(game.board, mirror_square, mimic_type, mimic_is_hydra, mimic_is_pope))

    return squares


def _in_check(game: store.CustomGame, color: chess.Color) -> bool:
    """The true check state for `color`, accounting for the extra threat
    squares above on top of python-chess's own board.is_check()."""
    board = game.board
    king_square = board.king(color)
    if king_square is None:
        return False
    if board.is_attacked_by(not color, king_square):
        return True
    return king_square in _extra_threat_squares(game, not color)


def _scratch_game_after(
    game: store.CustomGame,
    board_after: chess.Board,
    mover_color: chess.Color,
    from_square: chess.Square,
    to_square: chess.Square,
    is_shoot: bool,
) -> store.CustomGame:
    """A throwaway CustomGame carrying board_after plus what the tracked
    evolved squares would become after this hypothetical move - reuses the
    same tracking-update functions a real move goes through, so a captured
    evolved piece correctly stops threatening anything."""
    scratch = store.CustomGame(
        id="scratch",
        board=board_after,
        white_dragon_squares=set(game.white_dragon_squares),
        black_dragon_squares=set(game.black_dragon_squares),
        white_pope_square=game.white_pope_square,
        black_pope_square=game.black_pope_square,
        white_archer_square=game.white_archer_square,
        black_archer_square=game.black_archer_square,
        white_hydra_squares=set(game.white_hydra_squares),
        black_hydra_squares=set(game.black_hydra_squares),
        white_cyclops_squares=set(game.white_cyclops_squares),
        black_cyclops_squares=set(game.black_cyclops_squares),
        white_mirror_squares=set(game.white_mirror_squares),
        black_mirror_squares=set(game.black_mirror_squares),
        # A single hypothetical move can't change what either side most
        # recently REALLY moved (that's only set by an actual applied move,
        # not by the move being test-simulated here), so these just carry
        # over unchanged - see _mirror_current_mimic_type.
        white_last_moved_type=game.white_last_moved_type,
        black_last_moved_type=game.black_last_moved_type,
        white_last_moved_was_hydra=game.white_last_moved_was_hydra,
        black_last_moved_was_hydra=game.black_last_moved_was_hydra,
        white_last_moved_was_archer=game.white_last_moved_was_archer,
        black_last_moved_was_archer=game.black_last_moved_was_archer,
        white_last_moved_was_pope=game.white_last_moved_was_pope,
        black_last_moved_was_pope=game.black_last_moved_was_pope,
    )
    _update_dragon_tracking(scratch, mover_color, from_square, to_square)
    _update_pope_tracking(scratch, mover_color, from_square, to_square)
    _update_archer_tracking(scratch, mover_color, from_square, to_square, is_shoot)
    _update_hydra_tracking(scratch, mover_color, from_square, to_square)
    _update_cyclops_tracking(scratch, mover_color, from_square, to_square)
    _update_mirror_tracking(scratch, mover_color, from_square, to_square, is_shoot)
    return scratch


def _move_keeps_king_safe(game: store.CustomGame, move: chess.Move, mover_color: chess.Color) -> bool:
    """Simulates `move` and asks whether mover_color's king would be safe
    afterwards - both from what python-chess itself recognizes and from the
    opponent's evolved-piece extra threats it doesn't."""
    board_after = game.board.copy(stack=False)
    board_after.push(move)
    scratch = _scratch_game_after(game, board_after, mover_color, move.from_square, move.to_square, is_shoot=False)
    return not _in_check(scratch, mover_color)


def _shoot_keeps_king_safe(
    game: store.CustomGame, archer_square: chess.Square, target_square: chess.Square, mover_color: chess.Color
) -> bool:
    board_after = game.board.copy(stack=False)
    board_after.remove_piece_at(target_square)
    scratch = _scratch_game_after(game, board_after, mover_color, archer_square, target_square, is_shoot=True)
    return not _in_check(scratch, mover_color)


def _dragon_has_knight_shaped_move(game: store.CustomGame, dragon_square: chess.Square) -> bool:
    """True if the Dragon at dragon_square has at least one legal
    knight-shaped move (including out of check) - board.is_checkmate() and
    is_stalemate() only see the Dragon's rook-line moves, since it's stored
    as a plain Rook."""
    board = game.board
    piece = board.piece_at(dragon_square)
    if piece is None or piece.piece_type != chess.ROOK:
        return False
    color = piece.color
    for dest in rules.offset_squares(dragon_square, rules.KNIGHT_SHAPE_OFFSETS):
        target = board.piece_at(dest)
        if target is not None and target.color == color:
            continue
        if _move_keeps_king_safe(game, chess.Move(dragon_square, dest), color):
            return True
    return False


def _pope_has_king_step_move(game: store.CustomGame, pope_square: chess.Square) -> bool:
    """Mirrors _dragon_has_knight_shaped_move for the Pope's king-step mode -
    its ONLY movement mode, so unlike the old Wizard this replaces,
    board.is_checkmate()/is_stalemate() can't see ANY of its moves natively
    (a Bishop's diagonal-line moves are never actually legal for a Pope)."""
    board = game.board
    piece = board.piece_at(pope_square)
    if piece is None or piece.piece_type != chess.BISHOP:
        return False
    color = piece.color
    for dest in rules.offset_squares(pope_square, rules.KING_STEP_OFFSETS):
        target = board.piece_at(dest)
        if target is not None and target.color == color:
            continue
        if _move_keeps_king_safe(game, chess.Move(pope_square, dest), color):
            return True
    return False


def _hydra_has_ring_jump_move(game: store.CustomGame, hydra_square: chess.Square) -> bool:
    """Mirrors _pope_has_king_step_move for the Hydra's full jump ring
    (knight-shape plus the straight-two/diagonal-two squares) -
    board.is_checkmate()/is_stalemate() only ever sees its knight-shaped
    (Knight) moves natively."""
    board = game.board
    piece = board.piece_at(hydra_square)
    if piece is None or piece.piece_type != chess.KNIGHT:
        return False
    color = piece.color
    ring = rules.KNIGHT_SHAPE_OFFSETS + rules.HYDRA_RING_EXTRA_OFFSETS
    for dest in rules.offset_squares(hydra_square, ring):
        target = board.piece_at(dest)
        if target is not None and target.color == color:
            continue
        if _move_keeps_king_safe(game, chess.Move(hydra_square, dest), color):
            return True
    return False


def _cyclops_has_special_capture_move(game: store.CustomGame, cyclops_square: chess.Square, color: chess.Color) -> bool:
    """True if the Cyclops at cyclops_square has a legal (including
    out-of-check) two-square forward-left capture - the one mode
    board.is_checkmate()/is_stalemate() can't see, since it only looks at
    the Cyclops's stored-Pawn straight-line moves."""
    board = game.board
    dest = rules.cyclops_special_capture_square(cyclops_square, color)
    if dest is None:
        return False
    target = board.piece_at(dest)
    if target is None or target.color == color or target.piece_type == chess.KING:
        return False
    return _move_keeps_king_safe(game, chess.Move(cyclops_square, dest), color)


def _boosted_pawn_has_escape_move(game: store.CustomGame, pope_square: Optional[chess.Square], color: chess.Color) -> bool:
    """True if any of color's own Pawns within an allied Pope's aura has a
    legal (including out-of-check) boosted forward-2 push or diagonal-2
    capture - the extra modes board.is_checkmate()/is_stalemate() can't see,
    mirroring _cyclops_has_special_capture_move for the Pope's aura."""
    if pope_square is None:
        return False
    board = game.board
    cyclops_squares = game.white_cyclops_squares if color == chess.WHITE else game.black_cyclops_squares
    for pawn_square in board.pieces(chess.PAWN, color):
        if pawn_square in cyclops_squares:
            continue
        if not rules.is_within_pope_aura(pope_square, pawn_square):
            continue
        forward = rules.pope_boosted_forward_square(pawn_square, color)
        if forward is not None and board.piece_at(forward) is None:
            one_ahead_rank = chess.square_rank(pawn_square) + (1 if color == chess.WHITE else -1)
            one_ahead = chess.square(chess.square_file(pawn_square), one_ahead_rank)
            if board.piece_at(one_ahead) is None:
                if _move_keeps_king_safe(game, chess.Move(pawn_square, forward), color):
                    return True
        for dest in rules.pope_boosted_diagonal_capture_squares(pawn_square, color):
            target = board.piece_at(dest)
            if target is None or target.color == color or target.piece_type == chess.KING:
                continue
            if _move_keeps_king_safe(game, chess.Move(pawn_square, dest), color):
                return True
    return False


def _mirror_candidate_destinations(
    board: chess.Board,
    mirror_square: chess.Square,
    mimic_type: chess.PieceType,
    mimic_is_hydra: bool = False,
    mimic_is_pope: bool = False,
) -> set[chess.Square]:
    """Every square the Mirror could try moving to this turn, given it's
    mimicking mimic_type - king-step geometry for King (and for a mimicked
    Bishop that was really a Pope's king-step, see mimic_is_pope), otherwise
    every destination python-chess's own legal-move generator would allow
    for the mimicked type on a scratch copy (the same relabel trick
    rules.execute_mirror_move validates an actual move with). mimic_is_hydra
    layers on a Hydra's ring-extra squares the same way _mirror_threat_squares
    does, so escape/legal-move search doesn't miss them either."""
    if mimic_type == chess.KING or (mimic_type == chess.BISHOP and mimic_is_pope):
        return set(rules.offset_squares(mirror_square, rules.KING_STEP_OFFSETS))
    piece = board.piece_at(mirror_square)
    if piece is None:
        return set()
    scratch = board.copy(stack=False)
    scratch.set_piece_at(mirror_square, chess.Piece(mimic_type, piece.color))
    destinations = {move.to_square for move in scratch.legal_moves if move.from_square == mirror_square}
    if mimic_is_hydra and mimic_type == chess.KNIGHT:
        destinations.update(rules.offset_squares(mirror_square, rules.HYDRA_RING_EXTRA_OFFSETS))
    return destinations


def _mirror_has_a_move(game: store.CustomGame, mirror_square: chess.Square, color: chess.Color) -> bool:
    """True if the Mirror at mirror_square has a legal (including
    out-of-check) move this turn - board.legal_moves is meaningless for this
    square (it only ever sees the Mirror's placeholder Bishop storage, never
    what it's actually mimicking), so this is the sole source of truth,
    mirroring the Dragon/Pope/Archer/Hydra/Cyclops checks above."""
    mimic_type = _mirror_current_mimic_type(game, color)
    if mimic_type is None:
        return False
    board = game.board
    if mimic_type == chess.KNIGHT and _mirror_current_mimic_is_archer(game, color):
        # An Archer's relocate/shoot are two entirely different move shapes
        # (move-only-onto-empty vs capture-only-from-a-knight's-move-away),
        # not "Knight plus extra squares" the way a Hydra's ring is - the
        # generic _mirror_candidate_destinations path below can't express
        # that distinction, so this mirrors _archer_has_escape's own
        # dual-loop instead of reusing it.
        for dest in rules.offset_squares(mirror_square, rules.KING_STEP_OFFSETS):
            if board.piece_at(dest) is not None:  # move-only - never a capture
                continue
            if _move_keeps_king_safe(game, chess.Move(mirror_square, dest), color):
                return True
        for dest in rules.offset_squares(mirror_square, rules.KNIGHT_SHAPE_OFFSETS):
            target = board.piece_at(dest)
            if target is None or target.color == color or target.piece_type == chess.KING:
                continue
            if _shoot_keeps_king_safe(game, mirror_square, dest, color):
                return True
        return False
    mimic_is_hydra = _mirror_current_mimic_is_hydra(game, color)
    mimic_is_pope = _mirror_current_mimic_is_pope(game, color)
    for dest in _mirror_candidate_destinations(board, mirror_square, mimic_type, mimic_is_hydra, mimic_is_pope):
        target = board.piece_at(dest)
        if target is not None and target.color == color:
            continue
        if _move_keeps_king_safe(game, chess.Move(mirror_square, dest), color):
            return True
    return False


def _archer_has_escape(board: chess.Board, game: store.CustomGame, archer_square: chess.Square, color: chess.Color) -> bool:
    """True if the Archer at archer_square has a legal king-step relocation
    or knight's-move shot (including out of check). Needed for the reverse
    problem the Dragon/Pope checks solve: python-chess's is_checkmate()
    sees a real (but meaningless to us) L-shaped "knight move" for this
    square, which _compute_status must NOT trust as an escape - so this is
    the source of truth for what the Archer can actually still do."""
    for dest in rules.offset_squares(archer_square, rules.KING_STEP_OFFSETS):
        if board.piece_at(dest) is not None:  # move-only - never a capture, see execute_archer_move
            continue
        if _move_keeps_king_safe(game, chess.Move(archer_square, dest), color):
            return True
    for dest in rules.offset_squares(archer_square, rules.KNIGHT_SHAPE_OFFSETS):
        target = board.piece_at(dest)
        if target is None or target.color == color or target.piece_type == chess.KING:
            continue
        if _shoot_keeps_king_safe(game, archer_square, dest, color):
            return True
    return False


def _side_has_a_real_move(game: store.CustomGame, color: chess.Color) -> bool:
    """board.legal_moves is trustworthy for every square except a color's
    Archer/Mirror square(s), where it reports a real (per python-chess's
    rules for the stored Knight/Bishop) but not actually-real move - so
    those entries are filtered out entirely. A Cyclops's stored-Pawn moves
    (including its plain diagonal capture) are all real, so no filtering is
    needed there - it only ever ADDS the extra far-left hop on top, checked
    separately below. Every remaining candidate (plus the Dragon/Pope/
    Archer/Hydra/Cyclops/Mirror/boosted-Pawn extra modes invisible to
    legal_moves) is then re-verified with _move_keeps_king_safe, since
    board.legal_moves only ever accounts for python-chess's own idea of
    check safety, not the opponent's hero-piece extra threats."""
    archer_square = game.white_archer_square if color == chess.WHITE else game.black_archer_square
    mirror_squares = game.white_mirror_squares if color == chess.WHITE else game.black_mirror_squares
    cyclops_squares = game.white_cyclops_squares if color == chess.WHITE else game.black_cyclops_squares
    board = game.board
    for move in board.legal_moves:
        if move.from_square == archer_square or move.from_square in mirror_squares:
            continue
        if _move_keeps_king_safe(game, move, color):
            return True

    dragon_squares = game.white_dragon_squares if color == chess.WHITE else game.black_dragon_squares
    for dragon_square in dragon_squares:
        if _dragon_has_knight_shaped_move(game, dragon_square):
            return True

    pope_square = game.white_pope_square if color == chess.WHITE else game.black_pope_square
    if pope_square is not None and _pope_has_king_step_move(game, pope_square):
        return True

    hydra_squares = game.white_hydra_squares if color == chess.WHITE else game.black_hydra_squares
    for hydra_square in hydra_squares:
        if _hydra_has_ring_jump_move(game, hydra_square):
            return True

    if archer_square is not None and _archer_has_escape(board, game, archer_square, color):
        return True

    for cyclops_square in cyclops_squares:
        if _cyclops_has_special_capture_move(game, cyclops_square, color):
            return True

    for mirror_square in mirror_squares:
        if _mirror_has_a_move(game, mirror_square, color):
            return True

    if _boosted_pawn_has_escape_move(game, pope_square, color):
        return True

    return False


def _real_legal_standard_moves(game: store.CustomGame, color: chess.Color) -> set[chess.Move]:
    """Every board.legal_moves entry for color that's ALSO safe under our
    own true check-safety rules - the same filtering _side_has_a_real_move
    does, except collecting every match instead of stopping at the first.

    This is the actual fix for "the AI doesn't respond well to a check from
    a hero piece": Stockfish (ai.py) can structurally never propose a
    hero-special escape move itself (it has no concept of a Dragon's
    knight-hop or similar), so the best it can ever do when the only real
    threat is one of those is choose intelligently among the STANDARD moves
    that are genuinely legal. It can only do that if it's actually given
    that exact candidate set up front - custom_ai_move used to instead let
    it guess blind and exclude one rejected move at a time, which wastes a
    full engine search per illegal guess and, worse, means every one of
    those wasted searches was picked with zero awareness the king needed
    saving at all.
    """
    archer_square = game.white_archer_square if color == chess.WHITE else game.black_archer_square
    mirror_squares = game.white_mirror_squares if color == chess.WHITE else game.black_mirror_squares
    board = game.board
    return {
        move
        for move in board.legal_moves
        if move.from_square != archer_square
        and move.from_square not in mirror_squares
        and _move_keeps_king_safe(game, move, color)
    }


def _iter_hero_special_moves(game: store.CustomGame, color: chess.Color):
    """Every legal move for `color` that board.legal_moves structurally
    cannot represent - a hero piece's extra movement mode, plus the two
    pieces (Archer, Mirror) whose entire move set is non-standard. Yields
    (from_square, to_square, is_shoot) tuples, already filtered for check
    safety via _move_keeps_king_safe/_shoot_keeps_king_safe.

    This used to be _find_hero_special_move, which stopped at the first
    match (a "does the AI have SOME hero-special escape" fallback for when
    Stockfish exhausts every standard move - see custom_ai_move). It's a
    generator now so hero_ai.py's move enumerator can collect every match
    instead of just the first, without duplicating any of this per-piece
    candidate logic - _find_hero_special_move below is now a thin wrapper
    over this for that original caller.
    """
    board = game.board

    dragon_squares = game.white_dragon_squares if color == chess.WHITE else game.black_dragon_squares
    for dragon_square in dragon_squares:
        piece = board.piece_at(dragon_square)
        if piece is None or piece.piece_type != chess.ROOK:
            continue
        for dest in rules.offset_squares(dragon_square, rules.KNIGHT_SHAPE_OFFSETS):
            target = board.piece_at(dest)
            if target is not None and target.color == color:
                continue
            if _move_keeps_king_safe(game, chess.Move(dragon_square, dest), color):
                yield dragon_square, dest, False

    pope_square = game.white_pope_square if color == chess.WHITE else game.black_pope_square
    if pope_square is not None:
        piece = board.piece_at(pope_square)
        if piece is not None and piece.piece_type == chess.BISHOP:
            for dest in rules.offset_squares(pope_square, rules.KING_STEP_OFFSETS):
                target = board.piece_at(dest)
                if target is not None and target.color == color:
                    continue
                if _move_keeps_king_safe(game, chess.Move(pope_square, dest), color):
                    yield pope_square, dest, False

    hydra_squares = game.white_hydra_squares if color == chess.WHITE else game.black_hydra_squares
    for hydra_square in hydra_squares:
        piece = board.piece_at(hydra_square)
        if piece is None or piece.piece_type != chess.KNIGHT:
            continue
        ring = rules.KNIGHT_SHAPE_OFFSETS + rules.HYDRA_RING_EXTRA_OFFSETS
        for dest in rules.offset_squares(hydra_square, ring):
            target = board.piece_at(dest)
            if target is not None and target.color == color:
                continue
            if _move_keeps_king_safe(game, chess.Move(hydra_square, dest), color):
                yield hydra_square, dest, False

    archer_square = game.white_archer_square if color == chess.WHITE else game.black_archer_square
    if archer_square is not None:
        for dest in rules.offset_squares(archer_square, rules.KING_STEP_OFFSETS):
            if board.piece_at(dest) is not None:  # move-only - never a capture, see execute_archer_move
                continue
            if _move_keeps_king_safe(game, chess.Move(archer_square, dest), color):
                yield archer_square, dest, False
        for dest in rules.offset_squares(archer_square, rules.KNIGHT_SHAPE_OFFSETS):
            target = board.piece_at(dest)
            if target is None or target.color == color or target.piece_type == chess.KING:
                continue
            if _shoot_keeps_king_safe(game, archer_square, dest, color):
                yield archer_square, dest, True

    cyclops_squares = game.white_cyclops_squares if color == chess.WHITE else game.black_cyclops_squares
    for cyclops_square in cyclops_squares:
        dest = rules.cyclops_special_capture_square(cyclops_square, color)
        if dest is None:
            continue
        target = board.piece_at(dest)
        if target is None or target.color == color or target.piece_type == chess.KING:
            continue
        if _move_keeps_king_safe(game, chess.Move(cyclops_square, dest), color):
            yield cyclops_square, dest, False

    mirror_squares = game.white_mirror_squares if color == chess.WHITE else game.black_mirror_squares
    mimic_type = _mirror_current_mimic_type(game, color)
    if mimic_type is not None:
        if mimic_type == chess.KNIGHT and _mirror_current_mimic_is_archer(game, color):
            # See _mirror_has_a_move's own comment on why an Archer-mimicking
            # Mirror needs this dedicated dual-loop instead of the generic
            # _mirror_candidate_destinations path below.
            for mirror_square in mirror_squares:
                for dest in rules.offset_squares(mirror_square, rules.KING_STEP_OFFSETS):
                    if board.piece_at(dest) is not None:
                        continue
                    if _move_keeps_king_safe(game, chess.Move(mirror_square, dest), color):
                        yield mirror_square, dest, False
                for dest in rules.offset_squares(mirror_square, rules.KNIGHT_SHAPE_OFFSETS):
                    target = board.piece_at(dest)
                    if target is None or target.color == color or target.piece_type == chess.KING:
                        continue
                    if _shoot_keeps_king_safe(game, mirror_square, dest, color):
                        yield mirror_square, dest, True
        else:
            mimic_is_hydra = _mirror_current_mimic_is_hydra(game, color)
            mimic_is_pope = _mirror_current_mimic_is_pope(game, color)
            for mirror_square in mirror_squares:
                for dest in _mirror_candidate_destinations(board, mirror_square, mimic_type, mimic_is_hydra, mimic_is_pope):
                    target = board.piece_at(dest)
                    if target is not None and target.color == color:
                        continue
                    if _move_keeps_king_safe(game, chess.Move(mirror_square, dest), color):
                        yield mirror_square, dest, False

    if pope_square is not None:
        cyclops_squares = game.white_cyclops_squares if color == chess.WHITE else game.black_cyclops_squares
        for pawn_square in board.pieces(chess.PAWN, color):
            if pawn_square in cyclops_squares or not rules.is_within_pope_aura(pope_square, pawn_square):
                continue
            forward = rules.pope_boosted_forward_square(pawn_square, color)
            if forward is not None and board.piece_at(forward) is None:
                one_ahead_rank = chess.square_rank(pawn_square) + (1 if color == chess.WHITE else -1)
                one_ahead = chess.square(chess.square_file(pawn_square), one_ahead_rank)
                if board.piece_at(one_ahead) is None and _move_keeps_king_safe(
                    game, chess.Move(pawn_square, forward), color
                ):
                    yield pawn_square, forward, False
            for dest in rules.pope_boosted_diagonal_capture_squares(pawn_square, color):
                target = board.piece_at(dest)
                if target is None or target.color == color or target.piece_type == chess.KING:
                    continue
                if _move_keeps_king_safe(game, chess.Move(pawn_square, dest), color):
                    yield pawn_square, dest, False


def _find_hero_special_move(game: store.CustomGame, color: chess.Color) -> Optional[tuple[chess.Square, chess.Square, bool]]:
    """The first hero-special escape found for `color`, if any - see
    custom_ai_move's use of this as a last-resort fallback once Stockfish
    has exhausted every standard move. See _iter_hero_special_moves for the
    actual per-piece candidate logic; this just takes its first result."""
    return next(_iter_hero_special_moves(game, color), None)


def _compute_status(game: store.CustomGame) -> str:
    board = game.board

    if not _side_has_a_real_move(game, board.turn):
        return "checkmate" if _in_check(game, board.turn) else "stalemate"
    if board.is_insufficient_material() or board.is_seventyfive_moves():
        return "draw"
    return "in_progress"


def _square_name_or_none(square: Optional[chess.Square]) -> Optional[str]:
    return chess.square_name(square) if square is not None else None


def _square_names(squares: set[chess.Square]) -> list[str]:
    return sorted(chess.square_name(sq) for sq in squares)


def _piece_letter_or_none(piece_type: Optional[chess.PieceType]) -> Optional[str]:
    return chess.piece_symbol(piece_type).upper() if piece_type is not None else None


def _evolution_snapshot_to_model(snapshot: dict) -> EvolutionSnapshot:
    return EvolutionSnapshot(
        white_dragon_squares=_square_names(snapshot["white_dragon_squares"]),
        black_dragon_squares=_square_names(snapshot["black_dragon_squares"]),
        white_pope_square=_square_name_or_none(snapshot["white_pope_square"]),
        black_pope_square=_square_name_or_none(snapshot["black_pope_square"]),
        white_archer_square=_square_name_or_none(snapshot["white_archer_square"]),
        black_archer_square=_square_name_or_none(snapshot["black_archer_square"]),
        white_hydra_squares=_square_names(snapshot["white_hydra_squares"]),
        black_hydra_squares=_square_names(snapshot["black_hydra_squares"]),
        white_cyclops_squares=_square_names(snapshot["white_cyclops_squares"]),
        black_cyclops_squares=_square_names(snapshot["black_cyclops_squares"]),
        white_mirror_squares=_square_names(snapshot["white_mirror_squares"]),
        black_mirror_squares=_square_names(snapshot["black_mirror_squares"]),
    )


def _to_state(game: store.CustomGame) -> CustomGameState:
    return CustomGameState(
        id=game.id,
        fen=game.board.fen(),
        turn="white" if game.board.turn == chess.WHITE else "black",
        status=game.status,
        vs_ai=game.vs_ai,
        white_dragon_squares=_square_names(game.white_dragon_squares),
        black_dragon_squares=_square_names(game.black_dragon_squares),
        white_pope_square=_square_name_or_none(game.white_pope_square),
        black_pope_square=_square_name_or_none(game.black_pope_square),
        white_archer_square=_square_name_or_none(game.white_archer_square),
        black_archer_square=_square_name_or_none(game.black_archer_square),
        white_hydra_squares=_square_names(game.white_hydra_squares),
        black_hydra_squares=_square_names(game.black_hydra_squares),
        white_cyclops_squares=_square_names(game.white_cyclops_squares),
        black_cyclops_squares=_square_names(game.black_cyclops_squares),
        white_mirror_squares=_square_names(game.white_mirror_squares),
        black_mirror_squares=_square_names(game.black_mirror_squares),
        white_last_moved_type=_piece_letter_or_none(game.white_last_moved_type),
        black_last_moved_type=_piece_letter_or_none(game.black_last_moved_type),
        white_last_moved_was_hydra=game.white_last_moved_was_hydra,
        black_last_moved_was_hydra=game.black_last_moved_was_hydra,
        white_last_moved_was_archer=game.white_last_moved_was_archer,
        black_last_moved_was_archer=game.black_last_moved_was_archer,
        white_last_moved_was_pope=game.white_last_moved_was_pope,
        black_last_moved_was_pope=game.black_last_moved_was_pope,
        in_check=_in_check(game, game.board.turn),
        action_log=list(game.action_log),
        fen_history=list(game.fen_history),
        evolution_history=[_evolution_snapshot_to_model(snap) for snap in game.evolution_history],
    )


def _update_dragon_tracking(
    game: store.CustomGame,
    mover_color: bool,
    from_square: chess.Square,
    to_square: chess.Square,
) -> None:
    mover_squares = game.white_dragon_squares if mover_color == chess.WHITE else game.black_dragon_squares
    opponent_squares = game.black_dragon_squares if mover_color == chess.WHITE else game.white_dragon_squares

    if from_square in mover_squares:
        mover_squares.discard(from_square)
        mover_squares.add(to_square)

    # Any move (not just a Dragon's own) can capture an opponent's Dragon.
    opponent_squares.discard(to_square)


def _update_pope_tracking(
    game: store.CustomGame,
    mover_color: bool,
    from_square: chess.Square,
    to_square: chess.Square,
) -> None:
    if mover_color == chess.WHITE and game.white_pope_square == from_square:
        game.white_pope_square = to_square
    elif mover_color == chess.BLACK and game.black_pope_square == from_square:
        game.black_pope_square = to_square

    # Any move (not just a Pope's own) can capture the opponent's Pope.
    opponent_is_white = mover_color != chess.WHITE
    if opponent_is_white and game.white_pope_square == to_square:
        game.white_pope_square = None
    elif not opponent_is_white and game.black_pope_square == to_square:
        game.black_pope_square = None


def _update_archer_tracking(
    game: store.CustomGame,
    mover_color: bool,
    from_square: chess.Square,
    to_square: chess.Square,
    is_shoot: bool,
) -> None:
    if not is_shoot:
        if mover_color == chess.WHITE and game.white_archer_square == from_square:
            game.white_archer_square = to_square
        elif mover_color == chess.BLACK and game.black_archer_square == from_square:
            game.black_archer_square = to_square

    # Covers a standard/Dragon/Pope capture landing on an opposing Archer, or
    # a shot destroying one in place - either way it stops being tracked.
    opponent_is_white = mover_color != chess.WHITE
    if opponent_is_white and game.white_archer_square == to_square:
        game.white_archer_square = None
    elif not opponent_is_white and game.black_archer_square == to_square:
        game.black_archer_square = None


def _update_hydra_tracking(game: store.CustomGame, mover_color: bool, from_square: chess.Square, to_square: chess.Square) -> None:
    mover_squares = game.white_hydra_squares if mover_color == chess.WHITE else game.black_hydra_squares
    opponent_squares = game.black_hydra_squares if mover_color == chess.WHITE else game.white_hydra_squares
    if from_square in mover_squares:
        mover_squares.discard(from_square)
        mover_squares.add(to_square)
    opponent_squares.discard(to_square)


def _update_cyclops_tracking(game: store.CustomGame, mover_color: bool, from_square: chess.Square, to_square: chess.Square) -> None:
    mover_squares = game.white_cyclops_squares if mover_color == chess.WHITE else game.black_cyclops_squares
    opponent_squares = game.black_cyclops_squares if mover_color == chess.WHITE else game.white_cyclops_squares
    if from_square in mover_squares:
        mover_squares.discard(from_square)
        mover_squares.add(to_square)
    opponent_squares.discard(to_square)


def _update_mirror_tracking(
    game: store.CustomGame, mover_color: bool, from_square: chess.Square, to_square: chess.Square, is_shoot: bool = False
) -> None:
    """is_shoot mirrors _update_archer_tracking's own parameter: a Mirror
    mimicking an Archer's shoot never relocates (same as the real Archer's
    shoot - the target is destroyed but the shooter stays put), so the
    mover's own square must NOT move to to_square in that case - only
    capturing an opposing Mirror (to_square) still applies either way."""
    mover_squares = game.white_mirror_squares if mover_color == chess.WHITE else game.black_mirror_squares
    opponent_squares = game.black_mirror_squares if mover_color == chess.WHITE else game.white_mirror_squares
    if not is_shoot and from_square in mover_squares:
        mover_squares.discard(from_square)
        mover_squares.add(to_square)
    opponent_squares.discard(to_square)


def _update_last_moved_type(
    game: store.CustomGame,
    mover_color: bool,
    moved_type: Optional[chess.PieceType],
    was_hydra: bool = False,
    was_archer: bool = False,
    was_pope: bool = False,
) -> None:
    """Records the base type mover_color just moved, for the OPPONENT's
    Mirror (if any) to read on its own next turn - see
    _mirror_current_mimic_type/_mirror_current_mimic_is_hydra/
    _mirror_current_mimic_is_archer/_mirror_current_mimic_is_pope. Rolled
    back in _apply_move exactly like the other tracking fields if the move
    turns out to be unsafe."""
    if mover_color == chess.WHITE:
        game.white_last_moved_type = moved_type
        game.white_last_moved_was_hydra = was_hydra
        game.white_last_moved_was_archer = was_archer
        game.white_last_moved_was_pope = was_pope
    else:
        game.black_last_moved_type = moved_type
        game.black_last_moved_was_hydra = was_hydra
        game.black_last_moved_was_archer = was_archer
        game.black_last_moved_was_pope = was_pope


def _apply_move(
    game: store.CustomGame,
    mover_color: bool,
    from_square: chess.Square,
    to_square: chess.Square,
    shoot: bool,
    from_square_str: str,
    to_square_str: str,
    promotion: Optional[chess.PieceType] = None,
) -> str:
    """Executes one move (Pope / Dragon / Archer shoot / Archer move / Hydra /
    Cyclops / Mirror / boosted-Pawn / standard, in that priority order) and
    returns the action-log entry for it. Raises HTTPException or
    rules.IllegalMoveError on invalid input."""
    board = game.board

    dragon_squares = game.white_dragon_squares if mover_color == chess.WHITE else game.black_dragon_squares
    pope_square = game.white_pope_square if mover_color == chess.WHITE else game.black_pope_square
    archer_square = game.white_archer_square if mover_color == chess.WHITE else game.black_archer_square
    hydra_squares = game.white_hydra_squares if mover_color == chess.WHITE else game.black_hydra_squares
    cyclops_squares = game.white_cyclops_squares if mover_color == chess.WHITE else game.black_cyclops_squares
    mirror_squares = game.white_mirror_squares if mover_color == chess.WHITE else game.black_mirror_squares
    is_dragon_move = from_square in dragon_squares
    is_pope_move = pope_square == from_square
    is_archer_move = archer_square == from_square
    is_hydra_move = from_square in hydra_squares
    is_cyclops_move = from_square in cyclops_squares
    is_mirror_move = from_square in mirror_squares
    mirror_mimic_type = _mirror_current_mimic_type(game, mover_color) if is_mirror_move else None
    mirror_mimic_is_hydra = _mirror_current_mimic_is_hydra(game, mover_color) if is_mirror_move else False
    mirror_mimic_is_archer = _mirror_current_mimic_is_archer(game, mover_color) if is_mirror_move else False
    mirror_mimic_is_pope = _mirror_current_mimic_is_pope(game, mover_color) if is_mirror_move else False

    if promotion is None:
        piece_to_move = board.piece_at(from_square)
        moving_as_pawn = (piece_to_move is not None and piece_to_move.piece_type == chess.PAWN) or (
            is_mirror_move and mirror_mimic_type == chess.PAWN
        )
        if moving_as_pawn and chess.square_rank(to_square) in (0, 7):
            # No promotion-choice UI yet - auto-queen, same as most casual
            # chess apps default to. A bare Move with no promotion isn't a
            # legal move onto the back rank at all, so without this a pawn
            # (or a Mirror mimicking one) could never actually finish
            # promoting - the "couldn't move the mirror to the last rank
            # copying a pawn" bug.
            promotion = chess.QUEEN

    move = chess.Move(from_square, to_square, promotion=promotion)

    # What base type mover_color is exercising THIS move, for the opponent's
    # Mirror (if any) to read on its own next turn - captured before the
    # move mutates anything. A Mirror's own move records what it mimicked,
    # not its Bishop placeholder storage.
    piece_before = board.piece_at(from_square)
    mimic_type = mirror_mimic_type
    moved_type_for_mirror = mimic_type if is_mirror_move else (piece_before.piece_type if piece_before else None)
    # Companion to moved_type_for_mirror: was THIS move (whatever just set
    # that field to KNIGHT) specifically a Hydra move - either the piece
    # itself is a Hydra, or it's a Mirror that was mimicking one - so the
    # opponent's own Mirror (if any) knows next turn whether ring-extra
    # squares are copyable. See _mirror_current_mimic_is_hydra.
    moved_type_for_mirror_was_hydra = moved_type_for_mirror == chess.KNIGHT and (
        is_hydra_move or (is_mirror_move and mirror_mimic_is_hydra)
    )
    # Same idea, for an Archer instead of a Hydra - see
    # _mirror_current_mimic_is_archer for why this needs its own flag
    # rather than falling under the Hydra/plain-Knight cases.
    moved_type_for_mirror_was_archer = moved_type_for_mirror == chess.KNIGHT and (
        is_archer_move or (is_mirror_move and mirror_mimic_is_archer)
    )
    # Same idea again, for a Pope instead of a Hydra/Archer - see
    # _mirror_current_mimic_is_pope for why this needs its own flag rather
    # than falling under the Bishop/plain-diagonal case.
    moved_type_for_mirror_was_pope = moved_type_for_mirror == chess.BISHOP and (
        is_pope_move or (is_mirror_move and mirror_mimic_is_pope)
    )

    # Snapshot everything that a move could mutate, so a move that turns out
    # to leave the mover's own king exposed to a threat python-chess's
    # native legality doesn't know about (an opponent hero piece's extra
    # movement mode) can be rolled back below rather than left half-applied.
    board_before = board.copy(stack=False)
    tracking_before = (
        set(game.white_dragon_squares),
        set(game.black_dragon_squares),
        game.white_pope_square,
        game.black_pope_square,
        game.white_archer_square,
        game.black_archer_square,
        set(game.white_hydra_squares),
        set(game.black_hydra_squares),
        set(game.white_cyclops_squares),
        set(game.black_cyclops_squares),
        set(game.white_mirror_squares),
        set(game.black_mirror_squares),
        game.white_last_moved_type,
        game.black_last_moved_type,
        game.white_last_moved_was_hydra,
        game.black_last_moved_was_hydra,
        game.white_last_moved_was_archer,
        game.black_last_moved_was_archer,
        game.white_last_moved_was_pope,
        game.black_last_moved_was_pope,
    )

    if shoot:
        if is_archer_move:
            rules.execute_archer_shoot(board, move)
            log_entry = f"{from_square_str} shoots {to_square_str}"
        elif is_mirror_move and mirror_mimic_is_archer:
            rules.execute_mirror_archer_shoot(board, move)
            log_entry = f"{from_square_str} shoots {to_square_str}: Mirror"
        else:
            raise HTTPException(400, "Only an Archer (or a Mirror copying one) can shoot")
    elif is_pope_move:
        rules.execute_pope_move(board, move)
        log_entry = f"{from_square_str}-{to_square_str}: Pope"
    elif is_dragon_move:
        rules.execute_dragon_move(board, move)
        log_entry = f"{from_square_str}-{to_square_str}: Dragon"
    elif is_hydra_move:
        rules.execute_hydra_move(board, move)
        log_entry = f"{from_square_str}-{to_square_str}: Hydra"
    elif is_cyclops_move:
        rules.execute_cyclops_move(board, move)
        log_entry = f"{from_square_str}-{to_square_str}: Cyclops"
    elif is_mirror_move:
        if mimic_type is None:
            raise rules.IllegalMoveError("The Mirror has nothing to copy yet")
        if mirror_mimic_is_archer:
            rules.execute_mirror_archer_move(board, move)
        else:
            rules.execute_mirror_move(board, move, mimic_type, mirror_mimic_is_hydra, mirror_mimic_is_pope)
        log_entry = f"{from_square_str}-{to_square_str}: Mirror"
    elif is_archer_move:
        rules.execute_archer_move(board, move)
        log_entry = f"{from_square_str}-{to_square_str}"
    elif piece_before is not None and piece_before.piece_type == chess.PAWN:
        # Not a Cyclops (already handled above) - a plain Pawn, possibly
        # boosted by a nearby allied Pope's aura. execute_boosted_pawn_move
        # tries a normal pseudo-legal Pawn move first, so this is safe to
        # call unconditionally for every plain Pawn move.
        rules.execute_boosted_pawn_move(board, move, pope_square)
        log_entry = f"{from_square_str}-{to_square_str}"
    else:
        rules.execute_standard_move(board, move)
        log_entry = f"{from_square_str}-{to_square_str}"

    _update_dragon_tracking(game, mover_color, from_square, to_square)
    _update_pope_tracking(game, mover_color, from_square, to_square)
    _update_archer_tracking(game, mover_color, from_square, to_square, shoot)
    _update_hydra_tracking(game, mover_color, from_square, to_square)
    _update_cyclops_tracking(game, mover_color, from_square, to_square)
    _update_mirror_tracking(game, mover_color, from_square, to_square, shoot)
    _update_last_moved_type(
        game,
        mover_color,
        moved_type_for_mirror,
        moved_type_for_mirror_was_hydra,
        moved_type_for_mirror_was_archer,
        moved_type_for_mirror_was_pope,
    )

    if _in_check(game, mover_color):
        game.board = board_before
        (
            game.white_dragon_squares,
            game.black_dragon_squares,
            game.white_pope_square,
            game.black_pope_square,
            game.white_archer_square,
            game.black_archer_square,
            game.white_hydra_squares,
            game.black_hydra_squares,
            game.white_cyclops_squares,
            game.black_cyclops_squares,
            game.white_mirror_squares,
            game.black_mirror_squares,
            game.white_last_moved_type,
            game.black_last_moved_type,
            game.white_last_moved_was_hydra,
            game.black_last_moved_was_hydra,
            game.white_last_moved_was_archer,
            game.black_last_moved_was_archer,
            game.white_last_moved_was_pope,
            game.black_last_moved_was_pope,
        ) = tracking_before
        raise rules.IllegalMoveError("That move would leave your king in check")

    game.fen_history.append(board.fen())
    game.evolution_history.append(store.snapshot_evolution(game))
    return log_entry


def _build_game_from_setup(payload: CustomSetupRequest, enforce_points_budget: bool) -> store.CustomGame:
    """Shared by /custom-setup (vs_ai or the old local sandbox) and the
    online-multiplayer create endpoint - everything about turning a drafted
    back rank into a real CustomGame, independent of who ends up playing
    black or how the two sides find each other."""
    if enforce_points_budget:
        points = _compute_deck_points(payload.white_back_rank, payload.white_evolved_squares)
        if points > MAX_DECK_POINTS:
            raise HTTPException(400, f"Deck costs {points} points - the max is {MAX_DECK_POINTS}")

    black_back_rank = payload.black_back_rank
    if black_back_rank is None:
        black_back_rank = _standard_back_rank("8")

    # A hero's draft letter (Dragon "D", Hydra "H", Cyclops "C", Mirror "M")
    # isn't a real FEN piece letter - each is stored as the closest real
    # type, same idea as the Knight evolution slot always holding "N" for a
    # piece that's actually an Archer underneath. Translate before build_fen,
    # then recover the original squares for each afterwards.
    translated_white_back_rank = _translate_hero_letters(payload.white_back_rank)

    try:
        fen = fen_utils.build_fen(translated_white_back_rank, black_back_rank)
    except fen_utils.InvalidSetupError as exc:
        raise HTTPException(400, str(exc))

    board = chess.Board(fen)
    # An extra drafted Pawn on the back rank is deliberately unreachable
    # through normal play (more pawns for that color than a real game could
    # ever produce, and pawns don't start on the back rank) - python-chess's
    # is_valid() flags exactly that, so those two flags are tolerated here.
    # Every other flag (kings, opposite-side check, etc.) still fails setup.
    tolerated_status = chess.STATUS_PAWNS_ON_BACKRANK | chess.STATUS_TOO_MANY_WHITE_PAWNS | chess.STATUS_TOO_MANY_BLACK_PAWNS
    remaining_status = board.status() & ~tolerated_status
    if remaining_status != chess.STATUS_VALID:
        raise HTTPException(
            400,
            "That setup produces an illegal position (e.g. a king already in check) - " f"status flags: {remaining_status!r}",
        )

    white_dragon_squares = _collect_hero_squares(payload.white_back_rank, "D")
    white_hydra_squares = _collect_hero_squares(payload.white_back_rank, "H")
    white_cyclops_squares = _collect_hero_squares(payload.white_back_rank, "C")
    white_mirror_squares = _collect_hero_squares(payload.white_back_rank, "M")

    # A Knight's evolution slot swaps in the closest real stored type for a
    # piece that's actually an Archer (still stored as a Knight - no board
    # swap needed, unlike the Dragon's own draft-letter translation above).
    white_archer_square: Optional[chess.Square] = None
    white_pope_square: Optional[chess.Square] = None
    for raw_evolved_square in payload.white_evolved_squares:
        evolved_str = raw_evolved_square.strip().lower()
        try:
            evolved_square = chess.parse_square(evolved_str)
        except ValueError:
            raise HTTPException(400, f"'{evolved_str}' is not a valid square")
        evolved_letter = payload.white_back_rank.get(evolved_str, "").strip().upper()

        if evolved_letter == "N":
            # A Knight's evolution only ever produces one Archer - if more
            # than one Knight square is given, the last one wins.
            white_archer_square = evolved_square  # already a Knight in the FEN - no swap needed
        elif evolved_letter == "B":
            # A Bishop's evolution only ever produces one Pope - if more
            # than one Bishop square is given, the last one wins.
            white_pope_square = evolved_square  # already a Bishop in the FEN - no swap needed
        else:
            raise HTTPException(400, f"The evolving square ({evolved_str}) must contain a Knight or Bishop to evolve")

    return store.create_game(
        board,
        white_dragon_squares=white_dragon_squares,
        white_pope_square=white_pope_square,
        white_archer_square=white_archer_square,
        white_hydra_squares=white_hydra_squares,
        white_cyclops_squares=white_cyclops_squares,
        white_mirror_squares=white_mirror_squares,
        vs_ai=payload.vs_ai,
    )


def _validate_deck_points(back_rank: dict[str, str], evolved_squares: list[str]) -> None:
    points = _compute_deck_points(back_rank, evolved_squares)
    if points > MAX_DECK_POINTS:
        raise HTTPException(400, f"Deck costs {points} points - the max is {MAX_DECK_POINTS}")


def _translate_hero_letters(back_rank: dict[str, str]) -> dict[str, str]:
    translated: dict[str, str] = {}
    for raw_square, raw_letter in back_rank.items():
        letter = raw_letter.strip().upper()
        translated[raw_square] = HERO_DRAFT_LETTER_TO_STORED.get(letter, raw_letter)
    return translated


def _collect_hero_squares(back_rank: dict[str, str], letter: str) -> set[chess.Square]:
    squares: set[chess.Square] = set()
    for raw_square, raw_letter in back_rank.items():
        if raw_letter.strip().upper() == letter:
            try:
                squares.add(chess.parse_square(raw_square.strip().lower()))
            except ValueError:
                raise HTTPException(400, f"'{raw_square}' is not a valid square")
    return squares


def _resolve_evolution(
    board: chess.Board, back_rank: dict[str, str], evolved_squares: list[str], color: chess.Color
) -> tuple[Optional[chess.Square], Optional[chess.Square]]:
    """Returns (archer_square, pope_square) for one side - neither needs a
    board swap, since a Knight/Bishop is already the native storage type for
    an Archer/Pope (unlike a directly-drafted Dragon's own translation, see
    HERO_DRAFT_LETTER_TO_STORED)."""
    archer_square: Optional[chess.Square] = None
    pope_square: Optional[chess.Square] = None
    for raw_evolved_square in evolved_squares:
        evolved_str = raw_evolved_square.strip().lower()
        try:
            evolved_square = chess.parse_square(evolved_str)
        except ValueError:
            raise HTTPException(400, f"'{evolved_str}' is not a valid square")
        evolved_letter = back_rank.get(evolved_str, "").strip().upper()

        if evolved_letter == "N":
            # A Knight's evolution only ever produces one Archer - if more
            # than one Knight square is given, the last one wins.
            archer_square = evolved_square
        elif evolved_letter == "B":
            # A Bishop's evolution only ever produces one Pope - if more
            # than one Bishop square is given, the last one wins.
            pope_square = evolved_square
        else:
            raise HTTPException(400, f"The evolving square ({evolved_str}) must contain a Knight or Bishop to evolve")
    return archer_square, pope_square


def _build_game_from_two_decks(
    white_back_rank: dict[str, str],
    white_evolved_squares: list[str],
    black_back_rank: dict[str, str],
    black_evolved_squares: list[str],
) -> store.CustomGame:
    """Online multiplayer's two-sided sibling of _build_game_from_setup -
    both colors get the full custom-piece treatment (evolutions, Archers,
    Hydras, Cyclopses, Mirrors, extra Pawns), with the points budget always
    enforced on both sides (unlike /custom-setup, there's no local-sandbox
    mode here to exempt)."""
    _validate_deck_points(white_back_rank, white_evolved_squares)
    _validate_deck_points(black_back_rank, black_evolved_squares)

    try:
        fen = fen_utils.build_fen(_translate_hero_letters(white_back_rank), _translate_hero_letters(black_back_rank))
    except fen_utils.InvalidSetupError as exc:
        raise HTTPException(400, str(exc))

    board = chess.Board(fen)
    tolerated_status = chess.STATUS_PAWNS_ON_BACKRANK | chess.STATUS_TOO_MANY_WHITE_PAWNS | chess.STATUS_TOO_MANY_BLACK_PAWNS
    remaining_status = board.status() & ~tolerated_status
    if remaining_status != chess.STATUS_VALID:
        raise HTTPException(
            400,
            "That setup produces an illegal position (e.g. a king already in check) - " f"status flags: {remaining_status!r}",
        )

    white_archer_square, white_pope_square = _resolve_evolution(board, white_back_rank, white_evolved_squares, chess.WHITE)
    black_archer_square, black_pope_square = _resolve_evolution(board, black_back_rank, black_evolved_squares, chess.BLACK)

    return store.create_game(
        board,
        white_dragon_squares=_collect_hero_squares(white_back_rank, "D"),
        black_dragon_squares=_collect_hero_squares(black_back_rank, "D"),
        white_pope_square=white_pope_square,
        black_pope_square=black_pope_square,
        white_archer_square=white_archer_square,
        black_archer_square=black_archer_square,
        white_hydra_squares=_collect_hero_squares(white_back_rank, "H"),
        black_hydra_squares=_collect_hero_squares(black_back_rank, "H"),
        white_cyclops_squares=_collect_hero_squares(white_back_rank, "C"),
        black_cyclops_squares=_collect_hero_squares(black_back_rank, "C"),
        white_mirror_squares=_collect_hero_squares(white_back_rank, "M"),
        black_mirror_squares=_collect_hero_squares(black_back_rank, "M"),
        vs_ai=False,
    )


@router.post("/custom-setup", response_model=CustomGameState)
def custom_setup(payload: CustomSetupRequest):
    # The points budget is specifically an AI-arena concept ("31 points in
    # the first arena"); the older two-player sandbox mode (vs_ai=False)
    # stays unrestricted, matching its pre-existing behaviour.
    game = _build_game_from_setup(payload, enforce_points_budget=payload.vs_ai)
    return _to_state(game)


@router.get("/{game_id}", response_model=CustomGameState)
def get_custom_game(game_id: str):
    game = store.get_game(game_id)
    if game is None:
        raise HTTPException(404, "Custom game not found")
    return _to_state(game)


@router.post("/custom-move", response_model=CustomGameState)
def custom_move(payload: CustomMoveRequest):
    game = store.get_game(payload.game_id)
    if game is None:
        raise HTTPException(404, "Custom game not found")
    if game.status != "in_progress":
        raise HTTPException(400, f"Game is already over ({game.status})")

    board = game.board
    try:
        from_square = chess.parse_square(payload.from_square.strip().lower())
        to_square = chess.parse_square(payload.to_square.strip().lower())
    except ValueError:
        raise HTTPException(400, "Invalid square notation")

    piece = board.piece_at(from_square)
    if piece is None or piece.color != board.turn:
        raise HTTPException(400, "No piece of the side to move on that square")

    mover_color = board.turn
    try:
        log_entry = _apply_move(
            game, mover_color, from_square, to_square, payload.shoot, payload.from_square, payload.to_square
        )
    except rules.IllegalMoveError as exc:
        raise HTTPException(400, str(exc))

    game.action_log.append(log_entry)
    game.status = _compute_status(game)

    return _to_state(game)


@router.post("/{game_id}/ai-move", response_model=CustomGameState)
def custom_ai_move(game_id: str):
    """Separate from /custom-move so the player's own move round-trips (and
    renders) before the client asks for the AI's reply, instead of both
    moves landing in one request - Stockfish's think time was making the
    player's own move appear to hang until the AI had already replied."""
    game = store.get_game(game_id)
    if game is None:
        raise HTTPException(404, "Custom game not found")
    if game.status != "in_progress":
        raise HTTPException(400, f"Game is already over ({game.status})")
    if not game.vs_ai:
        raise HTTPException(400, "This game has no AI opponent")

    board = game.board
    if board.turn != chess.BLACK:
        raise HTTPException(400, "It's not the AI's turn")

    if hero_ai.color_has_hero_pieces(game, chess.BLACK):
        # Stockfish can never use a hero piece's extra movement mode itself
        # (only ever recognizing a THREAT from one, via the pre-filtering
        # below, which still handles the human-only-has-a-hero-piece case
        # just fine) - see hero_ai.py's module docstring. Once the AI's OWN
        # side actually has a hero piece to use, skip Stockfish entirely
        # and let the hero-aware search choose the move instead.
        hero_from, hero_to, hero_shoot = hero_ai.choose_move(game, chess.BLACK)
        log_entry = _apply_move(
            game,
            chess.BLACK,
            hero_from,
            hero_to,
            shoot=hero_shoot,
            from_square_str=chess.square_name(hero_from),
            to_square_str=chess.square_name(hero_to),
        )
        game.action_log.append(f"{log_entry} (AI)")
        game.status = _compute_status(game)
        return _to_state(game)

    # Stockfish only ever reasons about the position's FEN, so it has no idea
    # a player's Dragon/Pope/Archer is threatening its king via an extra
    # movement mode it can't see (see _extra_threat_squares) - its "best"
    # move can therefore turn out to be one _apply_move correctly rejects for
    # ignoring that check. Seed the exclusion set with every standard move
    # that's ALREADY known to be unsafe under our own rules (see
    # _real_legal_standard_moves), so its very first search only considers
    # genuinely legal candidates - rather than the old behavior of letting
    # it guess blind (with zero awareness a hero-piece check even existed)
    # and excluding one rejected move at a time, which could waste many
    # full engine searches on a position where only a handful of moves were
    # ever going to be legal. The loop below still retries on a further
    # rejection - a defensive fallback for anything this filtering missed,
    # not the primary mechanism anymore. _compute_status already guarantees
    # at least one real legal move exists here (this endpoint is only
    # reachable while game.status == "in_progress"), so this is bounded by
    # the position's legal move count, not open-ended.
    excluded_moves: set[chess.Move] = set(board.legal_moves) - _real_legal_standard_moves(game, chess.BLACK)
    log_entry: Optional[str] = None
    for _ in range(len(list(board.legal_moves)) + 1):
        try:
            ai_move = ai.compute_ai_move(board, excluded_moves=excluded_moves)
        except RuntimeError:
            # Every standard move is now excluded - the only escape left
            # (if any) is a hero-special one Stockfish could never have
            # proposed in the first place. Stop retrying standard moves and
            # fall through to the search below instead of crashing here.
            break
        ai_from, ai_to = ai_move.from_square, ai_move.to_square
        try:
            log_entry = _apply_move(
                game,
                chess.BLACK,
                ai_from,
                ai_to,
                shoot=False,
                from_square_str=chess.square_name(ai_from),
                to_square_str=chess.square_name(ai_to),
                promotion=ai_move.promotion,
            )
            break
        except rules.IllegalMoveError:
            excluded_moves.add(ai_move)

    if log_entry is None:
        # No STANDARD move worked - the AI's only way out is a hero-special
        # move of its own (see _find_hero_special_move's docstring for
        # exactly why this can happen even though _compute_status already
        # guaranteed some legal move exists).
        hero_move = _find_hero_special_move(game, chess.BLACK)
        if hero_move is not None:
            hero_from, hero_to, hero_shoot = hero_move
            log_entry = _apply_move(
                game,
                chess.BLACK,
                hero_from,
                hero_to,
                shoot=hero_shoot,
                from_square_str=chess.square_name(hero_from),
                to_square_str=chess.square_name(hero_to),
                promotion=None,
            )

    if log_entry is None:
        raise HTTPException(500, "AI could not find a legal move")

    game.action_log.append(f"{log_entry} (AI)")
    game.status = _compute_status(game)

    return _to_state(game)
