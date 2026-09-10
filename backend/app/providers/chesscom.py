from __future__ import annotations

import json
import re
from datetime import datetime, timezone

import requests

from app.config import CHESSCOM_USER_AGENT
from app.errors import UserNotFoundError
from app.http_client import serial_get
from app.models.game import Game, PlayerInfo
from app.providers.base import GameProvider

ARCHIVES_URL = "https://api.chess.com/pub/player/{username}/games/archives"

_RESULT_RE = re.compile(r'\[Result "([^"]+)"\]')


class ChessComProvider(GameProvider):
    platform = "chesscom"

    def get_recent_games(self, username: str, count: int) -> list[Game]:
        username_lower = username.lower()
        headers = {"User-Agent": CHESSCOM_USER_AGENT, "Accept": "application/json"}

        try:
            body, _ = serial_get(
                ARCHIVES_URL.format(username=username_lower), headers=headers
            )
        except requests.HTTPError as exc:
            if exc.response is not None and exc.response.status_code == 404:
                raise UserNotFoundError(username) from exc
            raise

        archives: list[str] = json.loads(body).get("archives", [])
        if not archives:
            return []

        games: list[Game] = []
        # Most recent month first; stop as soon as we have enough games.
        for archive_url in reversed(archives):
            cache_key = f"chesscom:archive:{archive_url}"
            archive_body, _ = serial_get(archive_url, headers=headers, cache_key=cache_key)
            month_games = json.loads(archive_body).get("games", [])
            for g in reversed(month_games):
                if g.get("rules") != "chess":
                    continue  # skip variants (chess960, bughouse, etc.)
                game = self._normalize(g, username_lower)
                if game is None:
                    continue
                games.append(game)
                if len(games) >= count:
                    return games
        return games

    @staticmethod
    def _normalize(g: dict, username_lower: str) -> Game | None:
        pgn = g.get("pgn")
        if not pgn:
            return None

        white = g.get("white", {})
        black = g.get("black", {})
        white_username = white.get("username", "?")
        black_username = black.get("username", "?")
        played_color = "white" if white_username.lower() == username_lower else "black"

        match = _RESULT_RE.search(pgn)
        result = match.group(1) if match else "*"

        url = g.get("url", "")
        game_id = url.rstrip("/").rsplit("/", 1)[-1] or f"{white_username}-{black_username}"

        end_time = g.get("end_time")
        return Game(
            id=f"chesscom:{game_id}",
            platform="chesscom",
            platform_game_id=game_id,
            white=PlayerInfo(username=white_username, rating=white.get("rating")),
            black=PlayerInfo(username=black_username, rating=black.get("rating")),
            result=result,
            time_control=g.get("time_control"),
            end_time=(
                datetime.fromtimestamp(end_time, tz=timezone.utc).isoformat()
                if end_time
                else None
            ),
            played_color=played_color,
            pgn=pgn,
            url=g.get("url"),
        )
