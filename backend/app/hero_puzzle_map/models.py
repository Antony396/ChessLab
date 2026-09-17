from __future__ import annotations

from pydantic import BaseModel

from app.custom_chess.models import CustomGameState
from app.daily_puzzle.models import DailyPuzzleCustomPosition, DailyPuzzleMoveSpec


class HeroMapNodeSummary(BaseModel):
    index: int
    authored: bool  # has anyone posted a puzzle for this slot yet
    solved: bool
    unlocked: bool
    is_finale: bool  # node 50 - solving it unlocks the Hydra King skin


class HeroMapStateResponse(BaseModel):
    nodes: list[HeroMapNodeSummary]
    solved_count: int
    unlocked_hydra_skin: bool


class HeroMapCreateNodeRequest(BaseModel):
    index: int
    custom_position: DailyPuzzleCustomPosition
    # The solver's moves to find, alternating with the opponent's forced
    # replies - same shape/ordering as Daily Puzzle's own solution list.
    solution: list[DailyPuzzleMoveSpec]


class HeroMapCreateNodeResponse(BaseModel):
    index: int


class HeroMapStartRequest(BaseModel):
    index: int


class HeroMapStartResponse(BaseModel):
    index: int
    game: CustomGameState
    my_side: str


class HeroMapMoveRequest(BaseModel):
    from_square: str
    to_square: str
    shoot: bool = False


class HeroMapMoveResponse(BaseModel):
    correct: bool
    puzzle_solved: bool
    game: CustomGameState
    solved_count: int
    unlocked_hydra_skin: bool
