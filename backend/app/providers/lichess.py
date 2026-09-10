from __future__ import annotations

import io

import chess.pgn
import requests

from app.errors import UserNotFoundError
from app.http_client import serial_get
from app.models.game import Game, PlayerInfo
from app.providers.base import GameProvider

EXPORT_URL = "https://lichess.org/api/games/user/{username}"


class LichessProvider(GameProvider):
    platform = "lichess"

    def get_recent_games(self, username: str, count: int) -> list[Game]:
        headers = {"Accept": "application/x-chess-pgn"}
        url = (
            EXPORT_URL.format(username=username)
            + f"?max={count}&pgnInJson=false&clocks=false&evals=false&opening=false&moves=true"
        )
        try:
            body, _ = serial_get(url, headers=headers, min_interval=1.0)
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 404:
                raise UserNotFoundError(username) from exc
            raise

        if not body.strip():
            return []

        username_lower = username.lower()
        games: list[Game] = []
        pgn_io = io.StringIO(body)
        while True:
            game_node = chess.pgn.read_game(pgn_io)
            if game_node is None:
                break
            game = self._normalize(game_node, username_lower)
            if game is not None:
                games.append(game)
        return games

    @staticmethod
    def _normalize(game_node: chess.pgn.Game, username_lower: str) -> Game | None:
        headers = game_node.headers
        white_username = headers.get("White", "?")
        black_username = headers.get("Black", "?")
        played_color = "white" if white_username.lower() == username_lower else "black"

        site = headers.get("Site", "")
        game_id = site.rstrip("/").rsplit("/", 1)[-1] if site else None
        if not game_id:
            return None

        exporter = chess.pgn.StringExporter(headers=True, variations=False, comments=False)
        pgn_text = game_node.accept(exporter)

        def rating(key: str) -> int | None:
            value = headers.get(key)
            return int(value) if value and value.isdigit() else None

        utc_date = headers.get("UTCDate")
        utc_time = headers.get("UTCTime")
        end_time = f"{utc_date}T{utc_time}Z" if utc_date and utc_time else None

        return Game(
            id=f"lichess:{game_id}",
            platform="lichess",
            platform_game_id=game_id,
            white=PlayerInfo(username=white_username, rating=rating("WhiteElo")),
            black=PlayerInfo(username=black_username, rating=rating("BlackElo")),
            result=headers.get("Result", "*"),
            time_control=headers.get("TimeControl"),
            end_time=end_time,
            played_color=played_color,
            pgn=pgn_text,
            url=site or None,
        )
