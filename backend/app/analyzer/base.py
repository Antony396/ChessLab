from abc import ABC, abstractmethod

from app.models.analysis import GameAnalysis
from app.models.game import Game


class Analyzer(ABC):
    """Turns a Game into a fully-computed GameAnalysis. Engine-agnostic."""

    @abstractmethod
    def analyze_game(self, game: Game, searched_username: str) -> GameAnalysis:
        ...
