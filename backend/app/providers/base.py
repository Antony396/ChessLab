from abc import ABC, abstractmethod

from app.models.game import Game


class GameProvider(ABC):
    """Fetches a user's recent games from one platform, normalised to Game."""

    platform: str

    @abstractmethod
    def get_recent_games(self, username: str, count: int) -> list[Game]:
        ...
