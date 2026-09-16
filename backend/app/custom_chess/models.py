from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class CustomSetupRequest(BaseModel):
    white_back_rank: dict[str, str]
    # None => auto-filled with the standard back rank (the AI opponent's
    # formation isn't drafted by the player).
    black_back_rank: Optional[dict[str, str]] = None
    # Squares to evolve at setup: a square holding a Knight becomes an Archer
    # (permanent king-step relocate + knight-shape shoot); a square holding a
    # Bishop becomes a Pope (permanent king-step-only movement, plus its
    # pawn-boosting aura). Only the first square of each type is used, since
    # each evolution slot only ever produces one hero.
    white_evolved_squares: list[str] = []
    vs_ai: bool = True
    # Only meaningful for /online/create - links the created room/game to
    # the creator's account (see online_game_routes.py's online_create) so
    # a real win/loss/draw can update ELO. None for every other use of this
    # same request shape (custom-setup's vs_ai/local-sandbox modes never
    # rate anyone), and even for online/create itself if the caller somehow
    # isn't authenticated - a game with an unlinked side just never gets
    # rated, same as any other online_create request wouldn't be if the
    # opponent's own side never linked either.
    auth_token: Optional[str] = None


class EvolutionSnapshot(BaseModel):
    """Which squares held which evolved/hero piece at one point in a game's
    history - one of these per CustomGameState.fen_history entry, same
    indexing. Mirrors CustomGameState's own evolution-tracking fields
    exactly, just frozen at that point in time, so the frontend can render a
    reviewed past position with the SAME hero-piece art logic it already
    uses for the live position, instead of falling back to plain base-type
    art (a Dragon/Hydra momentarily looking like a Rook/Knight) - confusing
    right after that piece just did something special."""

    white_dragon_squares: list[str] = []
    black_dragon_squares: list[str] = []
    white_pope_square: Optional[str] = None
    black_pope_square: Optional[str] = None
    white_archer_square: Optional[str] = None
    black_archer_square: Optional[str] = None
    white_hydra_squares: list[str] = []
    black_hydra_squares: list[str] = []
    white_cyclops_squares: list[str] = []
    black_cyclops_squares: list[str] = []
    white_mirror_squares: list[str] = []
    black_mirror_squares: list[str] = []


class CustomMoveRequest(BaseModel):
    game_id: str
    from_square: str
    to_square: str
    # Archer-only: interpret from_square/to_square as a non-relocating,
    # knight's-move-away capture instead of a move.
    shoot: bool = False


class ResignRequest(BaseModel):
    game_id: str
    player_token: str


class CustomGameState(BaseModel):
    id: str
    fen: str
    turn: Literal["white", "black"]
    status: Literal["in_progress", "checkmate", "stalemate", "draw", "resigned"]
    # Only set when status == "resigned" - who gave up, so the frontend can
    # show "you resigned" vs "they resigned" (unlike checkmate, this can't
    # be inferred from whose turn it is - the resigning side isn't
    # necessarily the one to move).
    resigned_by: Optional[Literal["white", "black"]] = None
    vs_ai: bool
    # Current squares of each side's Dragons (there can be several, drafted
    # directly like the Hydra/Cyclops/Mirror).
    white_dragon_squares: list[str] = []
    black_dragon_squares: list[str] = []
    # Current square of each side's Pope (evolved Bishop), or None if never
    # evolved / captured.
    white_pope_square: Optional[str] = None
    black_pope_square: Optional[str] = None
    # Current square of each side's Archer (evolved Knight), or None if never
    # evolved / captured.
    white_archer_square: Optional[str] = None
    black_archer_square: Optional[str] = None
    # Current squares of each side's Hydras/Cyclopses/Mirrors (each can have
    # several, drafted directly like the Dragon).
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
    # Same idea, for an Archer instead of a Hydra - mirrors the backend's
    # _mirror_current_mimic_is_archer, letting the frontend's Mirror
    # legal-move-hint logic know to show the Archer's own king-step-relocate/
    # knight-shape-shoot destinations instead of a plain Knight's.
    white_last_moved_was_archer: bool = False
    black_last_moved_was_archer: bool = False
    # Same idea again, for a Pope instead of a Hydra/Archer - mirrors the
    # backend's _mirror_current_mimic_is_pope, letting the frontend's Mirror
    # legal-move-hint logic know to show the Pope's own king-step
    # destinations instead of a plain Bishop's full diagonal.
    white_last_moved_was_pope: bool = False
    black_last_moved_was_pope: bool = False
    # True when whoever's turn it currently is (see `turn` above) is in
    # check right now - the same true-check computation _compute_status
    # uses for checkmate, so this correctly accounts for a hero piece's
    # extra threat squares too, not just what python-chess's own
    # board.is_check() can see. Lets the frontend show a check/checkmate
    # banner without duplicating any of that threat-detection logic itself.
    in_check: bool = False
    action_log: list[str]
    # One FEN per position the board has actually been in, oldest first -
    # see CustomGame.fen_history.
    fen_history: list[str] = []
    # One evolution-tracking snapshot per fen_history entry, same indexing -
    # see EvolutionSnapshot and CustomGame.evolution_history.
    evolution_history: list[EvolutionSnapshot] = []


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
    # Links the joiner's side of the built game to their account, same idea
    # as CustomSetupRequest.auth_token above.
    auth_token: Optional[str] = None


class OnlineJoinResponse(CustomGameState):
    # Secret - identifies the joining browser as black.
    black_token: str
