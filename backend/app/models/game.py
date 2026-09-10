from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

Platform = Literal["chesscom", "lichess"]
Color = Literal["white", "black"]


class PlayerInfo(BaseModel):
    username: str
    rating: Optional[int] = None


class Game(BaseModel):
    id: str  # "{platform}:{platform_game_id}"
    platform: Platform
    platform_game_id: str
    white: PlayerInfo
    black: PlayerInfo
    result: str  # PGN result: "1-0" | "0-1" | "1/2-1/2" | "*"
    time_control: Optional[str] = None
    end_time: Optional[str] = None  # ISO 8601
    played_color: Color  # colour the searched user played
    pgn: str
    url: Optional[str] = None
