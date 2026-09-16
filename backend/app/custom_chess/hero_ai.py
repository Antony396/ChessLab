"""A depth-limited minimax search that actually understands the hero
pieces - unlike ai.py's Stockfish, which only ever sees each hero piece's
plain storage type (a Dragon looks like a Rook to it, an Archer/Hydra like
a Knight, etc.) and can never use, or even recognize a threat from, any of
their extra movement modes.

Built directly on this app's own rules/move-application code
(custom_game_routes.py's _real_legal_standard_moves/_iter_hero_special_moves/
_apply_move) rather than a real chess engine, since no existing engine can
be taught custom rules like these. This is also why adding a new hero piece
later needs no "recalibration": this isn't a trained model, so there's
nothing to retrain - a new piece just needs its own move-candidate branch
in _iter_hero_special_moves (already true today, independent of this file)
and one more entry in _HERO_BONUS below.

Deliberately shallow (see SEARCH_DEPTH): every candidate at every node is
generated via real per-move validation (_apply_move, which itself replays
through python-chess's own legality/check-safety engine), not a real
engine's bitboard move generation - orders of magnitude slower per node,
so depth has to stay small to keep think time reasonable.
"""

from __future__ import annotations

import copy
import math
from typing import Optional

import chess

from app.custom_chess import store as game_store

SEARCH_DEPTH = 2

# Standard material values (the usual 100-per-pawn engine convention).
_STANDARD_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 300,
    chess.BISHOP: 300,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 0,
}
# Added on top of a hero piece's stored base-type value above, sized so the
# resulting total roughly tracks POINT_COSTS' own deck-drafting price for
# that piece (frontend/src/pieces/flat2dPieces.jsx) relative to a Knight's
# 3 points - e.g. HYDRA_COST=12 is 4x a Knight's 3, so a Hydra's total here
# (1200) is 4x a plain Knight's 300.
_HERO_BONUS = {
    "dragon": 300,  # Rook (500) + 300 = 800, tracking DRAGON_COST=8
    "pope": 300,  # Bishop (300) + 300 = 600, tracking POPE_COST=6
    "archer": 300,  # Knight (300) + 300 = 600, tracking ARCHER_COST=6
    "hydra": 900,  # Knight (300) + 900 = 1200, tracking HYDRA_COST=12
    "cyclops": 100,  # Pawn (100) + 100 = 200, tracking CYCLOPS_COST=2
    "mirror": 200,  # Bishop (300) + 200 = 500, tracking MIRROR_COST=5
}


def _hero_kind_at(game: game_store.CustomGame, square: chess.Square, color: chess.Color) -> Optional[str]:
    if square in (game.white_dragon_squares if color == chess.WHITE else game.black_dragon_squares):
        return "dragon"
    if square == (game.white_pope_square if color == chess.WHITE else game.black_pope_square):
        return "pope"
    if square == (game.white_archer_square if color == chess.WHITE else game.black_archer_square):
        return "archer"
    if square in (game.white_hydra_squares if color == chess.WHITE else game.black_hydra_squares):
        return "hydra"
    if square in (game.white_cyclops_squares if color == chess.WHITE else game.black_cyclops_squares):
        return "cyclops"
    if square in (game.white_mirror_squares if color == chess.WHITE else game.black_mirror_squares):
        return "mirror"
    return None


def _material_score(game: game_store.CustomGame, color: chess.Color) -> int:
    total = 0
    for square, piece in game.board.piece_map().items():
        if piece.color != color:
            continue
        value = _STANDARD_VALUES[piece.piece_type]
        hero_kind = _hero_kind_at(game, square, color)
        if hero_kind:
            value += _HERO_BONUS[hero_kind]
        total += value
    return total


def color_has_hero_pieces(game: game_store.CustomGame, color: chess.Color) -> bool:
    """True if `color` itself has a hero piece to actually use. Only
    matters for deciding which color needs hero_ai's own search - if only
    the OPPONENT has a hero piece, the AI's own moves are all standard
    ones and the existing Stockfish + pre-filtered-excluded-moves path
    (custom_ai_move's original mechanism, still in place below) already
    handles that correctly and more strongly than this shallow search
    would. hero_ai is only worth its weaker positional play when the side
    to move actually has a hero-piece ability available to use."""
    if color == chess.WHITE:
        return bool(
            game.white_dragon_squares
            or game.white_pope_square is not None
            or game.white_archer_square is not None
            or game.white_hydra_squares
            or game.white_cyclops_squares
            or game.white_mirror_squares
        )
    return bool(
        game.black_dragon_squares
        or game.black_pope_square is not None
        or game.black_archer_square is not None
        or game.black_hydra_squares
        or game.black_cyclops_squares
        or game.black_mirror_squares
    )


def evaluate(game: game_store.CustomGame, perspective: chess.Color) -> int:
    """Positive favors `perspective`. Pure material (plus each hero
    piece's bonus) - no positional term yet; depth is this version's main
    limitation, not eval sophistication (see module docstring)."""
    if game.status == "checkmate":
        loser = game.board.turn  # the side to move, with no real move, in check
        return -100000 if loser == perspective else 100000
    if game.status in ("stalemate", "draw"):
        return 0
    return _material_score(game, perspective) - _material_score(game, not perspective)


def enumerate_legal_moves(game: game_store.CustomGame, color: chess.Color) -> list[tuple[chess.Square, chess.Square, bool]]:
    """Every legal move for `color`, standard and hero-special alike -
    reuses custom_game_routes.py's own generators rather than re-deriving
    move legality from scratch. Deduped: a Hydra's knight-shape moves (say)
    are already covered by the standard set, and also revisited by the
    hero-special generator's ring-extra loop for convenience there."""
    # Imported lazily - custom_game_routes.py doesn't import this module,
    # but importing it at this module's own load time would run into
    # FastAPI route-decoration side effects before the app is ready.
    from app.api.custom_game_routes import _iter_hero_special_moves, _real_legal_standard_moves

    moves = {(m.from_square, m.to_square, False) for m in _real_legal_standard_moves(game, color)}
    moves.update(_iter_hero_special_moves(game, color))
    return list(moves)


def _apply_candidate(
    game: game_store.CustomGame, color: chess.Color, from_sq: chess.Square, to_sq: chess.Square, shoot: bool
) -> Optional[game_store.CustomGame]:
    """None if the candidate turns out not to actually be legal.
    _real_legal_standard_moves (one of enumerate_legal_moves's two sources)
    is a "probably legal" superset, not a guarantee, for any hero piece
    whose stored placeholder type has a wider native move set than the
    piece really has - a Pope's stored Bishop can travel the whole
    diagonal, but a real Pope only ever steps one square (see rules.py's
    execute_pope_move) - its OWN caller (custom_ai_move's Stockfish
    exclusion-seeding) tolerates that fine since a spurious entry in an
    exclusion set is harmless, but this module executes candidates
    directly, so it has to be defensive about it instead."""
    from app.api.custom_game_routes import _apply_move, _compute_status
    from app.custom_chess import rules

    clone = copy.deepcopy(game)
    try:
        log_entry = _apply_move(clone, color, from_sq, to_sq, shoot, chess.square_name(from_sq), chess.square_name(to_sq))
    except rules.IllegalMoveError:
        return None
    clone.action_log.append(log_entry)
    clone.status = _compute_status(clone)
    return clone


def _minimax(
    game: game_store.CustomGame, color_to_move: chess.Color, perspective: chess.Color, depth: int, alpha: float, beta: float
) -> float:
    if depth == 0 or game.status != "in_progress":
        return evaluate(game, perspective)

    moves = enumerate_legal_moves(game, color_to_move)
    if not moves:
        return evaluate(game, perspective)

    maximizing = color_to_move == perspective
    best = -math.inf if maximizing else math.inf
    for from_sq, to_sq, shoot in moves:
        child = _apply_candidate(game, color_to_move, from_sq, to_sq, shoot)
        if child is None:
            continue
        score = _minimax(child, not color_to_move, perspective, depth - 1, alpha, beta)
        if maximizing:
            best = max(best, score)
            alpha = max(alpha, best)
        else:
            best = min(best, score)
            beta = min(beta, best)
        if beta <= alpha:
            break  # alpha-beta cutoff
    if math.isinf(best):
        # Every candidate turned out to be a false positive from
        # _real_legal_standard_moves (see _apply_candidate) - fall back to
        # a static eval of this node rather than returning a sentinel.
        return evaluate(game, perspective)
    return best


def choose_move(
    game: game_store.CustomGame, color: chess.Color, depth: int = SEARCH_DEPTH
) -> tuple[chess.Square, chess.Square, bool]:
    """The hero-aware opponent's actual move choice: minimax with
    alpha-beta pruning over enumerate_legal_moves. Raises RuntimeError if
    `color` genuinely has no legal move - should never happen, since
    callers only reach this while game.status == "in_progress", which
    _compute_status already guarantees means a real move exists."""
    moves = enumerate_legal_moves(game, color)
    if not moves:
        raise RuntimeError("No legal moves available for the hero-aware AI")

    best_move: Optional[tuple[chess.Square, chess.Square, bool]] = None
    best_score = -math.inf
    alpha, beta = -math.inf, math.inf
    for from_sq, to_sq, shoot in moves:
        child = _apply_candidate(game, color, from_sq, to_sq, shoot)
        if child is None:
            continue  # a false positive from _real_legal_standard_moves - see _apply_candidate
        score = _minimax(child, not color, color, depth - 1, alpha, beta)
        if best_move is None or score > best_score:
            best_score = score
            best_move = (from_sq, to_sq, shoot)
        alpha = max(alpha, best_score)

    if best_move is None:
        raise RuntimeError("No legal moves available for the hero-aware AI")
    return best_move
