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
    white_dragon_square: Optional[chess.Square] = None
    black_dragon_square: Optional[chess.Square] = None
    # A Wizard evolution can produce more than one at once (the Bishop
    # evolution makes 2), unlike the Dragon's single evolution slot - so
    # these are sets, mirroring the Archer's own multi-instance tracking.
    white_wizard_squares: set[chess.Square] = field(default_factory=set)
    black_wizard_squares: set[chess.Square] = field(default_factory=set)
    white_archer_squares: set[chess.Square] = field(default_factory=set)
    black_archer_squares: set[chess.Square] = field(default_factory=set)
    # Hydra/Cyclops/Mirror are drafted directly (like the Archer), not
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
    vs_ai: bool = False
    status: str = "in_progress"
    action_log: list[str] = field(default_factory=list)
    # Online multiplayer only (unused/None for vs_ai and the old local
    # sandbox): secret tokens proving which connected browser is allowed to
    # move which color. A CustomGame is only ever created once both sides'
    # decks are known (see online_game_routes.py's room flow), so unlike an
    # earlier version of this feature there's no "black hasn't joined yet"
    # state to track here at all.
    white_token: Optional[str] = None
    black_token: Optional[str] = None


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
    white_back_rank: Optional[dict[str, str]] = None
    white_evolved_squares: Optional[list[str]] = None
    black_back_rank: Optional[dict[str, str]] = None
    black_evolved_squares: Optional[list[str]] = None
    game_id: Optional[str] = None


_GAMES: dict[str, CustomGame] = {}
_ROOMS: dict[str, PendingRoom] = {}
_SIMUL_ROOMS: dict[str, SimulRoom] = {}


def create_game(
    board: chess.Board,
    white_dragon_square: Optional[chess.Square] = None,
    black_dragon_square: Optional[chess.Square] = None,
    white_wizard_squares: Optional[set[chess.Square]] = None,
    black_wizard_squares: Optional[set[chess.Square]] = None,
    white_archer_squares: Optional[set[chess.Square]] = None,
    black_archer_squares: Optional[set[chess.Square]] = None,
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
        white_dragon_square=white_dragon_square,
        black_dragon_square=black_dragon_square,
        white_wizard_squares=white_wizard_squares or set(),
        black_wizard_squares=black_wizard_squares or set(),
        white_archer_squares=white_archer_squares or set(),
        black_archer_squares=black_archer_squares or set(),
        white_hydra_squares=white_hydra_squares or set(),
        black_hydra_squares=black_hydra_squares or set(),
        white_cyclops_squares=white_cyclops_squares or set(),
        black_cyclops_squares=black_cyclops_squares or set(),
        white_mirror_squares=white_mirror_squares or set(),
        black_mirror_squares=black_mirror_squares or set(),
        vs_ai=vs_ai,
    )
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


def create_simul_room(white_token: str, black_token: str) -> SimulRoom:
    room = SimulRoom(id=uuid.uuid4().hex, white_token=white_token, black_token=black_token)
    _SIMUL_ROOMS[room.id] = room
    return room


def get_simul_room(room_id: str) -> Optional[SimulRoom]:
    return _SIMUL_ROOMS.get(room_id)
