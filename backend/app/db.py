"""Local SQLite cache: HTTP ETag cache, fetched games, and analysis results.

One connection per thread (FastAPI's sync route handlers run in a thread
pool), each opened lazily and reused for the life of that thread.
"""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from app.config import DB_PATH
from app.models.analysis import GameAnalysis
from app.models.game import Game

_local = threading.local()


def _connect() -> sqlite3.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def get_conn() -> sqlite3.Connection:
    if not hasattr(_local, "conn"):
        _local.conn = _connect()
    return _local.conn


def init_db() -> None:
    get_conn().executescript(
        """
        CREATE TABLE IF NOT EXISTS http_cache (
            cache_key TEXT PRIMARY KEY,
            etag TEXT,
            body TEXT NOT NULL,
            fetched_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS games (
            id TEXT PRIMARY KEY,
            platform TEXT NOT NULL,
            queried_username TEXT NOT NULL,
            data_json TEXT NOT NULL,
            end_time TEXT
        );
        CREATE TABLE IF NOT EXISTS analysis_cache (
            game_id TEXT NOT NULL,
            depth INTEGER NOT NULL,
            analysis_json TEXT NOT NULL,
            generated_at TEXT NOT NULL,
            PRIMARY KEY (game_id, depth)
        );
        """
    )
    get_conn().commit()


# --- HTTP cache (ETag) ---


def get_cached_response(cache_key: str) -> dict | None:
    row = get_conn().execute(
        "SELECT etag, body FROM http_cache WHERE cache_key = ?", (cache_key,)
    ).fetchone()
    return dict(row) if row else None


def set_cached_response(cache_key: str, etag: str | None, body: str) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO http_cache (cache_key, etag, body, fetched_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(cache_key) DO UPDATE SET "
        "etag=excluded.etag, body=excluded.body, fetched_at=excluded.fetched_at",
        (cache_key, etag, body, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


# --- Games ---


def save_game(game: Game, queried_username: str) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO games (id, platform, queried_username, data_json, end_time) "
        "VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, end_time=excluded.end_time",
        (game.id, game.platform, queried_username.lower(), game.model_dump_json(), game.end_time),
    )
    conn.commit()


def get_game(game_id: str) -> Game | None:
    row = get_conn().execute("SELECT data_json FROM games WHERE id = ?", (game_id,)).fetchone()
    return Game.model_validate_json(row["data_json"]) if row else None


def list_games(platform: str, username: str) -> list[Game]:
    rows = get_conn().execute(
        "SELECT data_json FROM games WHERE platform = ? AND queried_username = ? "
        "ORDER BY end_time DESC",
        (platform, username.lower()),
    ).fetchall()
    return [Game.model_validate_json(r["data_json"]) for r in rows]


# --- Analysis cache ---


def get_cached_analysis(game_id: str, depth: int) -> GameAnalysis | None:
    row = get_conn().execute(
        "SELECT analysis_json FROM analysis_cache WHERE game_id = ? AND depth = ?",
        (game_id, depth),
    ).fetchone()
    return GameAnalysis.model_validate_json(row["analysis_json"]) if row else None


def save_analysis(game_id: str, depth: int, analysis: GameAnalysis) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO analysis_cache (game_id, depth, analysis_json, generated_at) "
        "VALUES (?, ?, ?, ?) "
        "ON CONFLICT(game_id, depth) DO UPDATE SET "
        "analysis_json=excluded.analysis_json, generated_at=excluded.generated_at",
        (game_id, depth, analysis.model_dump_json(), analysis.generated_at),
    )
    conn.commit()
