from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class CustomSetupRequest(BaseModel):
    white_back_rank: dict[str, str]
    # None => auto-filled with the standard back rank (the AI opponent's
    # formation isn't drafted by the player).
    black_back_rank: Optional[dict[str, str]] = None
    # Squares to evolve at setup: a square holding a Knight becomes a Dragon
    # (permanent knight+rook movement); a square holding a Bishop becomes a
    # Wizard (permanent bishop+king-step movement). More than one Bishop
    # square may be given (the Evo Orb turns a single Bishop into 2
    # Wizards); only the first Knight square is used, since a Knight's
    # evolution only ever produces one Dragon.
    white_evolved_squares: list[str] = []
    vs_ai: bool = True


class CustomMoveRequest(BaseModel):
    game_id: str
    from_square: str
    to_square: str
    # Archer-only: interpret from_square/to_square as a non-relocating,
    # knight's-move-away capture instead of a move.
    shoot: bool = False


class CustomGameState(BaseModel):
    id: str
    fen: str
    turn: Literal["white", "black"]
    status: Literal["in_progress", "checkmate", "stalemate", "draw"]
    vs_ai: bool
    # Current square of each side's Dragon (evolved Knight), or None if never
    # evolved / captured.
    white_dragon_square: Optional[str] = None
    black_dragon_square: Optional[str] = None
    # Current squares of each side's Wizards (evolved Bishops) - a Bishop
    # evolution produces 2 at once.
    white_wizard_squares: list[str] = []
    black_wizard_squares: list[str] = []
    # Current squares of each side's Archers (there can be several).
    white_archer_squares: list[str] = []
    black_archer_squares: list[str] = []
    # Current squares of each side's Hydras/Cyclopses/Mirrors (each can have
    # several, drafted directly like the Archer).
    white_hydra_squares: list[str] = []
    black_hydra_squares: list[str] = []
    white_cyclops_squares: list[str] = []
    black_cyclops_squares: list[str] = []
    white_mirror_squares: list[str] = []
    black_mirror_squares: list[str] = []
    # The base piece letter (K/Q/R/B/N/P) each color most recently moved, or
    # None if that color hasn't moved yet - what the OPPONENT's Mirror (if
    # any) currently mimics. Exposed so the frontend can show correct legal-
    # move hints for a Mirror square without duplicating the tracking logic.
    white_last_moved_type: Optional[str] = None
    black_last_moved_type: Optional[str] = None
    # Companion flags: True when the corresponding *_last_moved_type above is
    # "N" specifically because a Hydra moved (not a plain Knight or an
    # Archer's knight-shape shoot/relocate) - lets the frontend's own Mirror
    # legal-move-hint logic know a Hydra's ring-extra squares are copyable
    # too, mirroring the backend's _mirror_current_mimic_is_hydra.
    white_last_moved_was_hydra: bool = False
    black_last_moved_was_hydra: bool = False
    # True when whoever's turn it currently is (see `turn` above) is in
    # check right now - the same true-check computation _compute_status
    # uses for checkmate, so this correctly accounts for a hero piece's
    # extra threat squares too, not just what python-chess's own
    # board.is_check() can see. Lets the frontend show a check/checkmate
    # banner without duplicating any of that threat-detection logic itself.
    in_check: bool = False
    action_log: list[str]


class OnlineMoveRequest(BaseModel):
    game_id: str
    player_token: str
    from_square: str
    to_square: str
    shoot: bool = False


class OnlineRoomCreateResponse(BaseModel):
    room_id: str
    # Secret - identifies the creator's browser as white. Never included in
    # broadcasts or GETs, only this one response.
    white_token: str


class OnlineRoomJoinRequest(BaseModel):
    black_back_rank: dict[str, str]
    black_evolved_squares: list[str] = []


class OnlineJoinResponse(CustomGameState):
    # Secret - identifies the joining browser as black.
    black_token: str
