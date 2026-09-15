import chess

from app.api.custom_game_routes import _apply_move, _in_check, _to_state
from app.custom_chess.store import CustomGame


def _make_game(fen: str, **squares) -> CustomGame:
    return CustomGame(id="test", board=chess.Board(fen=fen), vs_ai=False, **squares)


# Regression coverage for the frontend's check/checkmate banner: it reads
# CustomGameState.in_check rather than re-deriving check itself (which would
# require duplicating every hero-piece threat rule above in JS) - so
# _to_state must actually wire _in_check's result through, including the
# same hero-piece blind spot python-chess's own check detection has.
def test_to_state_exposes_in_check_including_hero_piece_threats():
    game = _make_game("8/8/8/8/8/5R2/8/K5k1 b - - 0 1", white_dragon_squares={chess.F3})
    assert _to_state(game).in_check is True


def test_to_state_in_check_false_when_not_in_check():
    game = _make_game("8/8/8/8/8/8/8/K6k w - - 0 1")
    assert _to_state(game).in_check is False


# Regression coverage for: "the dragon pieces aren't putting the enemy king
# in check" (and the same blind spot for Pope). python-chess's own
# is_check()/is_attacked_by() only ever look at a piece's STORED type's
# native attacks, so a Dragon threatening the enemy king via its knight-shape
# mode - or a Pope via its king-step mode - was invisible to it entirely: the
# opponent could freely ignore the threat, and the Dragon could then walk in
# and actually capture the king outright instead of the game ending in
# checkmate first.
#
# The Archer does NOT belong in this list, despite also being stored as a
# Knight: its relocate is move-only (execute_archer_move rejects any
# occupied target, friend or foe) and its shoot explicitly refuses the King
# as a target (execute_archer_shoot's own check) - neither mode can ever
# actually capture a king, so unlike the pieces above it poses no threat to
# one at all. See test_archer_proximity_to_king_is_never_check below - an
# earlier version of this file asserted the opposite (an Archer's mere
# adjacency put the enemy king in check), which was itself the bug behind
# "king can't come close to archer": the enemy king couldn't legally stand
# next to an Archer at all, for a capture that could never actually happen.


def test_dragon_knight_shape_delivers_check_that_native_check_detection_misses():
    # White Dragon on f3 is a knight's-move from black's king on g1 - not a
    # rook-line distance, so board.is_check() alone would miss this.
    game = _make_game("8/8/8/8/8/5R2/8/K5k1 b - - 0 1", white_dragon_squares={chess.F3})
    assert game.board.is_check() is False  # confirms the blind spot exists
    assert _in_check(game, chess.BLACK) is True


def test_pope_king_step_delivers_check_that_native_check_detection_misses():
    # White Pope on f1 is one (non-diagonal) square from black's king on
    # g1 - a real Bishop could never threaten that square.
    game = _make_game("8/8/8/8/8/8/8/K4Bk1 b - - 0 1", white_pope_square=chess.F1)
    assert game.board.is_check() is False
    assert _in_check(game, chess.BLACK) is True


def test_archer_proximity_to_king_is_never_check():
    # White Archer on f1 is one square from black's king on g1 - adjacent,
    # the same geometry a Pope's king-step check above uses - but an
    # Archer's relocate can only ever move onto an EMPTY square (never a
    # capture, friend or foe), so unlike the Pope it can never actually
    # take the king from here. No check.
    game = _make_game("8/8/8/8/8/8/8/K4Nk1 b - - 0 1", white_archer_square=chess.F1)
    assert game.board.is_check() is False
    assert _in_check(game, chess.BLACK) is False


def test_king_can_legally_move_adjacent_to_an_archer():
    # The actual reported bug ("king can't come close to archer"): with the
    # White Archer on d4, Black's king stepping from d6 to d5 (adjacent to
    # the Archer) used to be rejected as "leaves your king in check", even
    # though the Archer could never actually capture on d5 once it got
    # there (relocate is move-only, never a capture).
    game = _make_game("8/8/3k4/8/3N4/8/8/K7 b - - 0 1", white_archer_square=chess.D4)
    _apply_move(game, chess.BLACK, chess.D6, chess.D5, shoot=False, from_square_str="d6", to_square_str="d5")
    assert game.board.piece_at(chess.D5) == chess.Piece(chess.KING, chess.BLACK)


def test_move_that_ignores_a_dragon_knight_shape_check_is_rejected():
    # Black king g1 is under threat from White's Dragon on f3 (knight-shape).
    # Black has an unrelated pawn move available that python-chess's own
    # legality check would happily allow (it doesn't see the threat at all),
    # but it must be rejected for ignoring check.
    game = _make_game("8/p7/8/8/8/5R2/8/K5k1 b - - 0 1", white_dragon_squares={chess.F3})
    board_before = game.board.copy()
    try:
        _apply_move(game, chess.BLACK, chess.A7, chess.A6, shoot=False, from_square_str="a7", to_square_str="a6")
        raised = False
    except Exception:
        raised = True
    assert raised, "a move ignoring the Dragon's knight-shape check must be rejected"
    assert game.board == board_before  # rejected move must not have mutated the game


def test_move_that_escapes_a_dragon_knight_shape_check_is_accepted():
    # Same threat, but this time the king actually steps out of it (g2 isn't
    # one of the Dragon's knight-shape squares from f3).
    game = _make_game("8/8/8/8/8/5R2/8/K5k1 b - - 0 1", white_dragon_squares={chess.F3})
    _apply_move(game, chess.BLACK, chess.G1, chess.G2, shoot=False, from_square_str="g1", to_square_str="g2")
    assert game.board.piece_at(chess.G2) == chess.Piece(chess.KING, chess.BLACK)
