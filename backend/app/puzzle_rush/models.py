from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class StartRushRequest(BaseModel):
    duration_seconds: int = 180  # 180 (3 min) or 300 (5 min)


class StartRushResponse(BaseModel):
    session_id: str
    fen: str
    score: int
    time_remaining: float


class SubmitMoveRequest(BaseModel):
    session_id: str
    from_square: str
    to_square: str
    promotion: Optional[str] = None


class SubmitMoveResponse(BaseModel):
    correct: bool
    puzzle_solved: bool
    game_over: bool
    score: int
    time_remaining: float
    fen: str
    # True when `fen` is the START of a brand-new puzzle (either because
    # the previous one was just solved, or - not currently reachable, but
    # cheap to leave room for - some future "skip" action), so the client
    # knows to treat it as a fresh position rather than a move within the
    # one it already had on screen.
    next_puzzle: bool
