from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel

from app.models.game import Game


class Classification(str, Enum):
    OK = "OK"
    INACCURACY = "Inaccuracy"
    MISTAKE = "Mistake"
    BLUNDER = "Blunder"


class MoveAnalysis(BaseModel):
    ply: int
    move_number: int
    side: Literal["white", "black"]
    is_player_move: bool  # True if the searched user made this move

    move_played_san: str
    move_played_uci: str

    # Centipawns, always from the searched player's perspective (positive =
    # good for them), so the eval graph never needs sign-flipping downstream.
    eval_before: int
    eval_after: int
    eval_swing: int  # eval_after - eval_before

    best_move_san: str
    best_move_uci: str
    best_line_san: list[str]  # principal variation, a few moves

    # Only meaningful when is_player_move is True; opponent moves are OK.
    classification: Classification

    fen_before: str


class GameAnalysis(BaseModel):
    game: Game
    searched_username: str
    depth: int
    generated_at: str  # ISO 8601
    moves: list[MoveAnalysis]
