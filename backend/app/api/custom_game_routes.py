from __future__ import annotations

from typing import Optional

import chess
from fastapi import APIRouter, HTTPException

from app.custom_chess import ai
from app.custom_chess import fen as fen_utils
from app.custom_chess import rules
from app.custom_chess import store
from app.custom_chess.models import CustomGameState, CustomMoveRequest, CustomSetupRequest

router = APIRouter()

STANDARD_BACK_RANK_LETTERS = "RNBQKBNR"
DRAGON_COST = 8
WIZARD_COST = 6
ARCHER_COST = 4
PAWN_COST = 1
POINT_COSTS = {"K": 0, "Q": 9, "R": 5, "B": 3, "N": 3, "A": ARCHER_COST, "P": PAWN_COST}
MAX_DECK_POINTS = 31


def _standard_back_rank(rank: str) -> dict[str, str]:
    return {f"{file}{rank}": letter for file, letter in zip("abcdefgh", STANDARD_BACK_RANK_LETTERS)}


def _compute_deck_points(back_rank: dict[str, str], evolved_squares: list[str]) -> int:
    evolved = {s.strip().lower() for s in evolved_squares}
    total = 0
    for square, letter in back_rank.items():
        letter = letter.strip().upper()
        square = square.strip().lower()
        if square in evolved and letter == "N":
            total += DRAGON_COST
        elif square in evolved and letter == "B":
            total += WIZARD_COST
        else:
            total += POINT_COSTS.get(letter, 0)
    return total


# --- Check detection for evolved pieces --------------------------------
#
# Every evolved piece is stored as the closest real python-chess piece type
# (Dragon=Rook, Wizard=Bishop, Archer=Knight) so the board stays a valid,
# serializable position. python-chess's own board.is_check()/is_attacked_by()
# only ever look at a piece's STORED type's native attack pattern, so they
# have a blind spot for exactly the movement mode that makes each piece
# special:
#   - a Dragon threatens the enemy king via a knight-shaped hop that a Rook
#     could never make
#   - a Wizard threatens it via a one-square king-step that a Bishop could
#     never make
#   - an Archer threatens it via a one-square king-step relocation that a
#     Knight could never make (its knight-shaped "shoot" mode - the one mode
#     that IS visible to python-chess, since it happens to match a Knight's
#     real attack pattern - can never target the King at all: see
#     rules.execute_archer_shoot's ban on shooting it)
#
# Without accounting for these, a side could simply ignore a Dragon/Wizard/
# Archer's threat against their own king (since python-chess never flags it
# as check), or even have their king actually captured outright by one of
# these moves - the checkmate rule that's supposed to prevent that entirely
# depends on check being detected correctly in the first place. Everything
# below layers the missing threat squares on top of python-chess's own
# attack detection, and is used both to reject a mover's own move that
# leaves them exposed (_apply_move) and to compute true checkmate/stalemate
# (_compute_status).


def _extra_threat_squares(game: store.CustomGame, attacker_color: chess.Color) -> set[chess.Square]:
    """Squares attacked by attacker_color's evolved pieces via a movement
    mode python-chess's own attack detection doesn't know about."""
    squares: set[chess.Square] = set()

    dragon_square = game.white_dragon_square if attacker_color == chess.WHITE else game.black_dragon_square
    if dragon_square is not None:
        squares.update(rules.offset_squares(dragon_square, rules.KNIGHT_SHAPE_OFFSETS))

    wizard_squares = game.white_wizard_squares if attacker_color == chess.WHITE else game.black_wizard_squares
    for wizard_square in wizard_squares:
        squares.update(rules.offset_squares(wizard_square, rules.KING_STEP_OFFSETS))

    archer_squares = game.white_archer_squares if attacker_color == chess.WHITE else game.black_archer_squares
    for archer_square in archer_squares:
        squares.update(rules.offset_squares(archer_square, rules.KING_STEP_OFFSETS))

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
        white_dragon_square=game.white_dragon_square,
        black_dragon_square=game.black_dragon_square,
        white_wizard_squares=set(game.white_wizard_squares),
        black_wizard_squares=set(game.black_wizard_squares),
        white_archer_squares=set(game.white_archer_squares),
        black_archer_squares=set(game.black_archer_squares),
    )
    _update_dragon_tracking(scratch, mover_color, from_square, to_square)
    _update_wizard_tracking(scratch, mover_color, from_square, to_square)
    _update_archer_tracking(scratch, mover_color, from_square, to_square, is_shoot)
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


def _wizard_has_king_step_move(game: store.CustomGame, wizard_square: chess.Square) -> bool:
    """Mirrors _dragon_has_knight_shaped_move for the Wizard's king-step
    mode, which board.is_checkmate()/is_stalemate() can't see either, since
    it only looks at the Wizard's diagonal (Bishop) moves."""
    board = game.board
    piece = board.piece_at(wizard_square)
    if piece is None or piece.piece_type != chess.BISHOP:
        return False
    color = piece.color
    for dest in rules.offset_squares(wizard_square, rules.KING_STEP_OFFSETS):
        target = board.piece_at(dest)
        if target is not None and target.color == color:
            continue
        if _move_keeps_king_safe(game, chess.Move(wizard_square, dest), color):
            return True
    return False


def _archer_has_escape(board: chess.Board, game: store.CustomGame, archer_square: chess.Square, color: chess.Color) -> bool:
    """True if the Archer at archer_square has a legal king-step relocation
    or knight's-move shot (including out of check). Needed for the reverse
    problem the Dragon/Wizard checks solve: python-chess's is_checkmate()
    sees a real (but meaningless to us) L-shaped "knight move" for this
    square, which _compute_status must NOT trust as an escape - so this is
    the source of truth for what the Archer can actually still do."""
    for dest in rules.offset_squares(archer_square, rules.KING_STEP_OFFSETS):
        target = board.piece_at(dest)
        if target is not None and target.color == color:
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
    Archer squares, where it reports a real (per python-chess's rules for a
    Knight) but not actually-a-real-Archer-action L-shaped move - so those
    entries are filtered out here. Every remaining candidate (plus the
    Dragon/Wizard/Archer extra modes invisible to legal_moves) is then
    re-verified with _move_keeps_king_safe, since board.legal_moves only
    ever accounts for python-chess's own idea of check safety, not the
    opponent's evolved-piece extra threats."""
    archer_squares = game.white_archer_squares if color == chess.WHITE else game.black_archer_squares
    board = game.board
    for move in board.legal_moves:
        if move.from_square in archer_squares:
            continue
        if _move_keeps_king_safe(game, move, color):
            return True

    dragon_square = game.white_dragon_square if color == chess.WHITE else game.black_dragon_square
    if dragon_square is not None and _dragon_has_knight_shaped_move(game, dragon_square):
        return True

    wizard_squares = game.white_wizard_squares if color == chess.WHITE else game.black_wizard_squares
    for wizard_square in wizard_squares:
        if _wizard_has_king_step_move(game, wizard_square):
            return True

    for archer_square in archer_squares:
        if _archer_has_escape(board, game, archer_square, color):
            return True

    return False


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


def _to_state(game: store.CustomGame) -> CustomGameState:
    return CustomGameState(
        id=game.id,
        fen=game.board.fen(),
        turn="white" if game.board.turn == chess.WHITE else "black",
        status=game.status,
        vs_ai=game.vs_ai,
        white_dragon_square=_square_name_or_none(game.white_dragon_square),
        black_dragon_square=_square_name_or_none(game.black_dragon_square),
        white_wizard_squares=_square_names(game.white_wizard_squares),
        black_wizard_squares=_square_names(game.black_wizard_squares),
        white_archer_squares=_square_names(game.white_archer_squares),
        black_archer_squares=_square_names(game.black_archer_squares),
        action_log=list(game.action_log),
    )


def _update_dragon_tracking(
    game: store.CustomGame,
    mover_color: bool,
    from_square: chess.Square,
    to_square: chess.Square,
) -> None:
    if mover_color == chess.WHITE and game.white_dragon_square == from_square:
        game.white_dragon_square = to_square
    elif mover_color == chess.BLACK and game.black_dragon_square == from_square:
        game.black_dragon_square = to_square

    # Any move (not just a Dragon's own) can capture the opponent's Dragon.
    opponent_is_white = mover_color != chess.WHITE
    if opponent_is_white and game.white_dragon_square == to_square:
        game.white_dragon_square = None
    elif not opponent_is_white and game.black_dragon_square == to_square:
        game.black_dragon_square = None


def _update_wizard_tracking(
    game: store.CustomGame,
    mover_color: bool,
    from_square: chess.Square,
    to_square: chess.Square,
) -> None:
    mover_squares = game.white_wizard_squares if mover_color == chess.WHITE else game.black_wizard_squares
    opponent_squares = game.black_wizard_squares if mover_color == chess.WHITE else game.white_wizard_squares

    if from_square in mover_squares:
        mover_squares.discard(from_square)
        mover_squares.add(to_square)

    # Any move (not just a Wizard's own) can capture an opponent's Wizard.
    opponent_squares.discard(to_square)


def _update_archer_tracking(
    game: store.CustomGame,
    mover_color: bool,
    from_square: chess.Square,
    to_square: chess.Square,
    is_shoot: bool,
) -> None:
    mover_squares = game.white_archer_squares if mover_color == chess.WHITE else game.black_archer_squares
    opponent_squares = game.black_archer_squares if mover_color == chess.WHITE else game.white_archer_squares

    if not is_shoot and from_square in mover_squares:
        mover_squares.discard(from_square)
        mover_squares.add(to_square)

    # Covers a standard/Dragon/Wizard capture landing on an opposing Archer,
    # or a shot destroying one in place - either way it stops being tracked.
    opponent_squares.discard(to_square)


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
    """Executes one move (Wizard / Dragon / Archer shoot / Archer move /
    standard, in that priority order) and returns the action-log entry for
    it. Raises HTTPException or rules.IllegalMoveError on invalid input."""
    board = game.board

    if promotion is None:
        piece_to_move = board.piece_at(from_square)
        if piece_to_move is not None and piece_to_move.piece_type == chess.PAWN and chess.square_rank(to_square) in (0, 7):
            # No promotion-choice UI yet - auto-queen, same as most casual
            # chess apps default to. A bare Move with no promotion isn't a
            # legal move onto the back rank at all, so without this a pawn
            # could never actually finish promoting.
            promotion = chess.QUEEN

    move = chess.Move(from_square, to_square, promotion=promotion)
    dragon_square = game.white_dragon_square if mover_color == chess.WHITE else game.black_dragon_square
    wizard_squares = game.white_wizard_squares if mover_color == chess.WHITE else game.black_wizard_squares
    archer_squares = game.white_archer_squares if mover_color == chess.WHITE else game.black_archer_squares
    is_wizard_move = from_square in wizard_squares
    is_archer_move = from_square in archer_squares

    # Snapshot everything that a move could mutate, so a move that turns out
    # to leave the mover's own king exposed to a threat python-chess's
    # native legality doesn't know about (an opponent evolved piece's extra
    # movement mode) can be rolled back below rather than left half-applied.
    board_before = board.copy(stack=False)
    tracking_before = (
        game.white_dragon_square,
        game.black_dragon_square,
        set(game.white_wizard_squares),
        set(game.black_wizard_squares),
        set(game.white_archer_squares),
        set(game.black_archer_squares),
    )

    if shoot:
        if not is_archer_move:
            raise HTTPException(400, "Only an Archer can shoot")
        rules.execute_archer_shoot(board, move)
        log_entry = f"{from_square_str} shoots {to_square_str}"
    elif is_wizard_move:
        rules.execute_wizard_move(board, move)
        log_entry = f"{from_square_str}-{to_square_str}: Wizard"
    elif dragon_square == from_square:
        rules.execute_dragon_move(board, move)
        log_entry = f"{from_square_str}-{to_square_str}: Dragon"
    elif is_archer_move:
        rules.execute_archer_move(board, move)
        log_entry = f"{from_square_str}-{to_square_str}"
    else:
        rules.execute_standard_move(board, move)
        log_entry = f"{from_square_str}-{to_square_str}"

    _update_dragon_tracking(game, mover_color, from_square, to_square)
    _update_wizard_tracking(game, mover_color, from_square, to_square)
    _update_archer_tracking(game, mover_color, from_square, to_square, shoot)

    if _in_check(game, mover_color):
        game.board = board_before
        (
            game.white_dragon_square,
            game.black_dragon_square,
            game.white_wizard_squares,
            game.black_wizard_squares,
            game.white_archer_squares,
            game.black_archer_squares,
        ) = tracking_before
        raise rules.IllegalMoveError("That move would leave your king in check")

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

    # The Archer's draft letter ("A") isn't a real FEN piece letter - it's
    # stored as a Knight, same idea as the Dragon's evolution slot always
    # holding "N" for a piece that's actually a Rook underneath. Translate
    # before build_fen, then recover the original Archer squares afterwards.
    white_archer_squares: set[chess.Square] = set()
    translated_white_back_rank: dict[str, str] = {}
    for raw_square, raw_letter in payload.white_back_rank.items():
        letter = raw_letter.strip().upper()
        translated_white_back_rank[raw_square] = "N" if letter == "A" else raw_letter

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

    for raw_square, raw_letter in payload.white_back_rank.items():
        if raw_letter.strip().upper() == "A":
            try:
                white_archer_squares.add(chess.parse_square(raw_square.strip().lower()))
            except ValueError:
                raise HTTPException(400, f"'{raw_square}' is not a valid square")

    white_dragon_square: Optional[chess.Square] = None
    white_wizard_squares: set[chess.Square] = set()
    for raw_evolved_square in payload.white_evolved_squares:
        evolved_str = raw_evolved_square.strip().lower()
        try:
            evolved_square = chess.parse_square(evolved_str)
        except ValueError:
            raise HTTPException(400, f"'{evolved_str}' is not a valid square")
        evolved_letter = payload.white_back_rank.get(evolved_str, "").strip().upper()

        if evolved_letter == "N":
            # A Knight's evolution only ever produces one Dragon - if more
            # than one Knight square is given, the last one wins.
            white_dragon_square = evolved_square
            board.set_piece_at(white_dragon_square, chess.Piece(chess.ROOK, chess.WHITE))
        elif evolved_letter == "B":
            white_wizard_squares.add(evolved_square)  # already a Bishop in the FEN - no swap needed
        else:
            raise HTTPException(400, f"The evolving square ({evolved_str}) must contain a Knight or Bishop to evolve")

    return store.create_game(
        board,
        white_dragon_square=white_dragon_square,
        white_wizard_squares=white_wizard_squares,
        white_archer_squares=white_archer_squares,
        vs_ai=payload.vs_ai,
    )


def _validate_deck_points(back_rank: dict[str, str], evolved_squares: list[str]) -> None:
    points = _compute_deck_points(back_rank, evolved_squares)
    if points > MAX_DECK_POINTS:
        raise HTTPException(400, f"Deck costs {points} points - the max is {MAX_DECK_POINTS}")


def _translate_archer_letters(back_rank: dict[str, str]) -> dict[str, str]:
    translated: dict[str, str] = {}
    for raw_square, raw_letter in back_rank.items():
        letter = raw_letter.strip().upper()
        translated[raw_square] = "N" if letter == "A" else raw_letter
    return translated


def _collect_archer_squares(back_rank: dict[str, str]) -> set[chess.Square]:
    squares: set[chess.Square] = set()
    for raw_square, raw_letter in back_rank.items():
        if raw_letter.strip().upper() == "A":
            try:
                squares.add(chess.parse_square(raw_square.strip().lower()))
            except ValueError:
                raise HTTPException(400, f"'{raw_square}' is not a valid square")
    return squares


def _resolve_evolution(
    board: chess.Board, back_rank: dict[str, str], evolved_squares: list[str], color: chess.Color
) -> tuple[Optional[chess.Square], set[chess.Square]]:
    """Returns (dragon_square, wizard_squares) for one side, swapping a
    Dragon's evolution-slot Knight into a Rook on `board` in place (a Wizard
    needs no swap - a Bishop is already its native storage type)."""
    dragon_square: Optional[chess.Square] = None
    wizard_squares: set[chess.Square] = set()
    for raw_evolved_square in evolved_squares:
        evolved_str = raw_evolved_square.strip().lower()
        try:
            evolved_square = chess.parse_square(evolved_str)
        except ValueError:
            raise HTTPException(400, f"'{evolved_str}' is not a valid square")
        evolved_letter = back_rank.get(evolved_str, "").strip().upper()

        if evolved_letter == "N":
            # A Knight's evolution only ever produces one Dragon - if more
            # than one Knight square is given, the last one wins.
            dragon_square = evolved_square
            board.set_piece_at(dragon_square, chess.Piece(chess.ROOK, color))
        elif evolved_letter == "B":
            wizard_squares.add(evolved_square)
        else:
            raise HTTPException(400, f"The evolving square ({evolved_str}) must contain a Knight or Bishop to evolve")
    return dragon_square, wizard_squares


def _build_game_from_two_decks(
    white_back_rank: dict[str, str],
    white_evolved_squares: list[str],
    black_back_rank: dict[str, str],
    black_evolved_squares: list[str],
) -> store.CustomGame:
    """Online multiplayer's two-sided sibling of _build_game_from_setup -
    both colors get the full custom-piece treatment (evolutions, Archers,
    extra Pawns), with the points budget always enforced on both sides
    (unlike /custom-setup, there's no local-sandbox mode here to exempt)."""
    _validate_deck_points(white_back_rank, white_evolved_squares)
    _validate_deck_points(black_back_rank, black_evolved_squares)

    try:
        fen = fen_utils.build_fen(_translate_archer_letters(white_back_rank), _translate_archer_letters(black_back_rank))
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

    white_dragon_square, white_wizard_squares = _resolve_evolution(board, white_back_rank, white_evolved_squares, chess.WHITE)
    black_dragon_square, black_wizard_squares = _resolve_evolution(board, black_back_rank, black_evolved_squares, chess.BLACK)

    return store.create_game(
        board,
        white_dragon_square=white_dragon_square,
        black_dragon_square=black_dragon_square,
        white_wizard_squares=white_wizard_squares,
        black_wizard_squares=black_wizard_squares,
        white_archer_squares=_collect_archer_squares(white_back_rank),
        black_archer_squares=_collect_archer_squares(black_back_rank),
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

    # Stockfish only ever reasons about the position's FEN, so it has no idea
    # a player's Dragon/Wizard/Archer is threatening its king via an extra
    # movement mode it can't see (see _extra_threat_squares) - its "best"
    # move can therefore turn out to be one _apply_move correctly rejects for
    # ignoring that check. Rather than surfacing that as an error and
    # stalling the game, ask again with that move excluded so it falls back
    # to its next-best try, repeating until one actually lands. _compute_status
    # already guarantees at least one real legal move exists here (this
    # endpoint is only reachable while game.status == "in_progress"), so this
    # is bounded by the position's legal move count, not open-ended.
    excluded_moves: set[chess.Move] = set()
    log_entry: Optional[str] = None
    for _ in range(len(list(board.legal_moves)) + 1):
        ai_move = ai.compute_ai_move(board, excluded_moves=excluded_moves)
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
        raise HTTPException(500, "AI could not find a legal move")

    game.action_log.append(f"{log_entry} (AI)")
    game.status = _compute_status(game)

    return _to_state(game)
