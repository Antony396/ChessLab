from __future__ import annotations

from pydantic import BaseModel

from app.custom_chess.models import CustomGameState


class MapNodeSummary(BaseModel):
    index: int
    solved: bool
    unlocked: bool
    is_finale: bool  # node 50 - solving it unlocks the Hydra King skin


class MapStateResponse(BaseModel):
    nodes: list[MapNodeSummary]
    solved_count: int
    unlocked_hydra_skin: bool


class MapStartRequest(BaseModel):
    index: int


class MapStartResponse(BaseModel):
    index: int
    game: CustomGameState
    my_side: str


class MapMoveRequest(BaseModel):
    from_square: str
    to_square: str
    shoot: bool = False


class MapMoveResponse(BaseModel):
    correct: bool
    puzzle_solved: bool
    game: CustomGameState
    solved_count: int
    unlocked_hydra_skin: bool
