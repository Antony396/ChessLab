"""In-memory session store for custom games.

Deliberately not SQLite-backed: this is a live, ephemeral session
(python-chess Board objects aren't trivially JSON-serializable, and there's
no requirement for these sessions to survive a server restart). Games are
lost on restart - acceptable for this feature; say so if that changes.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Optional

import chess


@dataclass
class CustomGame:
    id: str
    board: chess.Board
    # A Dragon is drafted directly now (like Hydra/Cyclops/Mirror), so - like
    # them - there can be more than one at once, hence a set.
    white_dragon_squares: set[chess.Square] = field(default_factory=set)
    black_dragon_squares: set[chess.Square] = field(default_factory=set)
    # The Bishop evolution slot produces at most one Pope, and the Knight
    # evolution slot produces at most one Archer - both singular, unlike the
    # directly-drafted heroes below.
    white_pope_square: Optional[chess.Square] = None
    black_pope_square: Optional[chess.Square] = None
    white_archer_square: Optional[chess.Square] = None
    black_archer_square: Optional[chess.Square] = None
    # Hydra/Cyclops/Mirror are drafted directly (like the Dragon), not
    # evolved from another piece, so each just needs its own tracked-squares
    # set the same way.
    white_hydra_squares: set[chess.Square] = field(default_factory=set)
    black_hydra_squares: set[chess.Square] = field(default_factory=set)
    white_cyclops_squares: set[chess.Square] = field(default_factory=set)
    black_cyclops_squares: set[chess.Square] = field(default_factory=set)
    white_mirror_squares: set[chess.Square] = field(default_factory=set)
    black_mirror_squares: set[chess.Square] = field(default_factory=set)
    # The base piece type (chess.PieceType) each color most recently moved -
    # e.g. a Dragon's move records ROOK (its stored type), a Mirror's move
    # records whatever it mimicked that turn. None until that color has
    # moved at all. A Mirror's own legal moves/threats are resolved by
    # reading the OPPONENT's copy of this field - see custom_game_routes.py.
    white_last_moved_type: Optional[chess.PieceType] = None
    black_last_moved_type: Optional[chess.PieceType] = None
    # True when white_last_moved_type/black_last_moved_type == KNIGHT because
    # a Hydra moved (as opposed to a plain Knight or an Archer's knight-shape
    # shoot/relocate) - a Mirror mimicking that move needs to know this,
    # since a Hydra's ring-extra squares are legal for it to copy but
    # board.legal_moves has no idea they exist (see execute_mirror_move's
    # mimic_is_hydra parameter).
    white_last_moved_was_hydra: bool = False
    black_last_moved_was_hydra: bool = False
    # Same idea as white_last_moved_was_hydra/black_last_moved_was_hydra
    # above, for an Archer instead of a Hydra: an Archer's relocate (a
    # king-step) and shoot (a knight-shape non-relocating capture) are BOTH
    # recorded under last_moved_type == KNIGHT (its storage type), same as a
    # plain Knight or a Hydra - without this flag a Mirror had no way to
    # tell the three apart, so it fell through to trying a real Knight's
    # L-shaped legal_moves check, which a king-step relocate always fails
    # (rejecting a move that should be legal) and a knight-shape shoot only
    # passes by coincidence while getting the wrong semantics (relocating
    # onto the square instead of shooting it from afar). See
    # execute_mirror_archer_move/execute_mirror_archer_shoot.
    white_last_moved_was_archer: bool = False
    black_last_moved_was_archer: bool = False
    # Same idea again, for a Pope instead of a Hydra/Archer: a Pope's
    # king-step is recorded under last_moved_type == BISHOP (its storage
    # type), same as a plain Bishop - without this flag a Mirror had no way
    # to tell them apart, so it mimicked what it thought was a genuine
    # Bishop's full diagonal-line reach instead of a king-step, a much
    # broader (and wrong) move/threat pattern than the Pope it was actually
    # supposed to be copying. See execute_mirror_move's mimic_is_pope
    # parameter and _mirror_current_mimic_is_pope.
    white_last_moved_was_pope: bool = False
    black_last_moved_was_pope: bool = False
    vs_ai: bool = False
    status: str = "in_progress"
    # Set (to the color that gave up) only when status == "resigned" - see
    # online_game_routes.py's resign endpoint, the only place this changes.
    resigned_by: Optional[chess.Color] = None
    action_log: list[str] = field(default_factory=list)
    # One FEN per position the board has actually been in, oldest first,
    # starting with the initial setup - lets the frontend's move-history
    # back/forward navigation show the exact position after any past move
    # without needing its own copy of the move-application logic.
    fen_history: list[str] = field(default_factory=list)
    # One evolution-tracking snapshot per fen_history entry, same indexing -
    # a plain dict copy of every white_*/black_*_square(s) field above at
    # that point in time. Without this, a reviewed past position would have
    # no way to know a given square held a Dragon/Hydra/etc. rather than its
    # plain base type, and would have to fall back to rendering everything
    # as its base art - confusing right after an evolved piece has actually
    # moved, since the reviewed position would show it as a plain Rook/
    # Knight/etc. instead of what it actually was.
    evolution_history: list[dict] = field(default_factory=list)
    # Online multiplayer only (unused/None for vs_ai and the old local
    # sandbox): secret tokens proving which connected browser is allowed to
    # move which color. A CustomGame is only ever created once both sides'
    # decks are known (see online_game_routes.py's room flow), so unlike an
    # earlier version of this feature there's no "black hasn't joined yet"
    # state to track here at all.
    white_token: Optional[str] = None
    black_token: Optional[str] = None
    # Account ids for each side, when known - only ever set for a genuinely
    # authenticated online game (the plain shareable-link flow and the
    # friend-challenge flow both thread these through at creation time; an
    # unauthenticated caller or a vs_ai/local-sandbox game leaves them None).
    # This is the sole source of truth online_move reads before applying an
    # ELO update on game end - a game missing either id never gets rated.
    white_user_id: Optional[str] = None
    black_user_id: Optional[str] = None


@dataclass
class PendingRoom:
    """An online-multiplayer room that only has white's drafted deck so far -
    promoted to a real CustomGame (with an actual board) once a second
    player submits black's deck too, since a chess position needs both sides
    to exist at all."""

    id: str
    white_back_rank: dict[str, str]
    white_evolved_squares: list[str]
    white_token: str
    game_id: Optional[str] = None
    # The creator's account id, if they were authenticated when they
    # created this room - carried over onto the built CustomGame (see
    # online_game_routes.py's online_room_join) so ELO can apply later.
    white_user_id: Optional[str] = None


@dataclass
class SimulRoom:
    """A friend-to-friend challenge, accepted before either side has
    drafted anything - unlike PendingRoom (always seeded with white's
    already-drafted deck, from the shareable-link flow), both sides here
    start out empty and submit independently, in whichever order they
    finish drafting. Promoted to a real CustomGame the moment both have.
    Both tokens are minted up front (at challenge time), since both
    players' identities are already known - there's no "second player
    joins with a link" step to mint black's token at."""

    id: str
    white_token: str
    black_token: str
    # Whoever sent the challenge (always White here) - needed purely so
    # accepting/declining can notify THEM specifically over their presence
    # connection, since the accept/decline request only ever carries the
    # recipient's own token, not the challenger's identity. Also doubles as
    # White's account id for ELO purposes once the game is built - a
    # challenge always comes from a real logged-in account, unlike
    # PendingRoom.white_user_id which is only sometimes known.
    challenger_id: str
    # The challenged friend's account id - known from the start here (the
    # challenge names them directly), unlike PendingRoom's black side which
    # only shows up once someone actually opens the join link.
    black_user_id: Optional[str] = None
    white_back_rank: Optional[dict[str, str]] = None
    white_evolved_squares: Optional[list[str]] = None
    black_back_rank: Optional[dict[str, str]] = None
    black_evolved_squares: Optional[list[str]] = None
    game_id: Optional[str] = None
    # True once the recipient has accepted - both sides only enter the deck
    # builder after this, restoring an explicit accept step in front of the
    # simultaneous-drafting flow.
    accepted: bool = False


_GAMES: dict[str, CustomGame] = {}
_ROOMS: dict[str, PendingRoom] = {}
_SIMUL_ROOMS: dict[str, SimulRoom] = {}


def snapshot_evolution(game: CustomGame) -> dict:
    """A plain dict copy of every evolution-tracking field on `game` right
    now - see CustomGame.evolution_history for why. Squares are copied by
    value (a fresh set, not the same set object) so a later in-place mutation
    of game.white_dragon_squares (etc.) can never silently rewrite a past
    snapshot too."""
    return {
        "white_dragon_squares": set(game.white_dragon_squares),
        "black_dragon_squares": set(game.black_dragon_squares),
        "white_pope_square": game.white_pope_square,
        "black_pope_square": game.black_pope_square,
        "white_archer_square": game.white_archer_square,
        "black_archer_square": game.black_archer_square,
        "white_hydra_squares": set(game.white_hydra_squares),
        "black_hydra_squares": set(game.black_hydra_squares),
        "white_cyclops_squares": set(game.white_cyclops_squares),
        "black_cyclops_squares": set(game.black_cyclops_squares),
        "white_mirror_squares": set(game.white_mirror_squares),
        "black_mirror_squares": set(game.black_mirror_squares),
    }


def create_game(
    board: chess.Board,
    white_dragon_squares: Optional[set[chess.Square]] = None,
    black_dragon_squares: Optional[set[chess.Square]] = None,
    white_pope_square: Optional[chess.Square] = None,
    black_pope_square: Optional[chess.Square] = None,
    white_archer_square: Optional[chess.Square] = None,
    black_archer_square: Optional[chess.Square] = None,
    white_hydra_squares: Optional[set[chess.Square]] = None,
    black_hydra_squares: Optional[set[chess.Square]] = None,
    white_cyclops_squares: Optional[set[chess.Square]] = None,
    black_cyclops_squares: Optional[set[chess.Square]] = None,
    white_mirror_squares: Optional[set[chess.Square]] = None,
    black_mirror_squares: Optional[set[chess.Square]] = None,
    vs_ai: bool = False,
) -> CustomGame:
    game = CustomGame(
        id=uuid.uuid4().hex,
        board=board,
        white_dragon_squares=white_dragon_squares or set(),
        black_dragon_squares=black_dragon_squares or set(),
        white_pope_square=white_pope_square,
        black_pope_square=black_pope_square,
        white_archer_square=white_archer_square,
        black_archer_square=black_archer_square,
        white_hydra_squares=white_hydra_squares or set(),
        black_hydra_squares=black_hydra_squares or set(),
        white_cyclops_squares=white_cyclops_squares or set(),
        black_cyclops_squares=black_cyclops_squares or set(),
        white_mirror_squares=white_mirror_squares or set(),
        black_mirror_squares=black_mirror_squares or set(),
        vs_ai=vs_ai,
        fen_history=[board.fen()],
    )
    game.evolution_history.append(snapshot_evolution(game))
    _GAMES[game.id] = game
    return game


def get_game(game_id: str) -> Optional[CustomGame]:
    return _GAMES.get(game_id)


def create_room(white_back_rank: dict[str, str], white_evolved_squares: list[str], white_token: str) -> PendingRoom:
    room = PendingRoom(
        id=uuid.uuid4().hex,
        white_back_rank=white_back_rank,
        white_evolved_squares=white_evolved_squares,
        white_token=white_token,
    )
    _ROOMS[room.id] = room
    return room


def get_room(room_id: str) -> Optional[PendingRoom]:
    return _ROOMS.get(room_id)


def create_simul_room(
    white_token: str, black_token: str, challenger_id: str, black_user_id: Optional[str] = None
) -> SimulRoom:
    room = SimulRoom(
        id=uuid.uuid4().hex,
        white_token=white_token,
        black_token=black_token,
        challenger_id=challenger_id,
        black_user_id=black_user_id,
    )
    _SIMUL_ROOMS[room.id] = room
    return room


def get_simul_room(room_id: str) -> Optional[SimulRoom]:
    return _SIMUL_ROOMS.get(room_id)


def remove_simul_room(room_id: str) -> None:
    _SIMUL_ROOMS.pop(room_id, None)
