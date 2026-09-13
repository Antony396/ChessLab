"""Local SQLite cache: HTTP ETag cache, fetched games, analysis results, and
(persistent, unlike everything in custom_chess/store.py) user accounts and
friendships.

One connection per thread (FastAPI's sync route handlers run in a thread
pool), each opened lazily and reused for the life of that thread.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import uuid
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
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            username_lower TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS friend_requests (
            id TEXT PRIMARY KEY,
            from_user_id TEXT NOT NULL,
            to_user_id TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(from_user_id, to_user_id)
        );
        CREATE TABLE IF NOT EXISTS saved_decks (
            user_id TEXT NOT NULL,
            slot INTEGER NOT NULL,
            name TEXT NOT NULL,
            deck_json TEXT NOT NULL,
            evolved_indices_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (user_id, slot)
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


# --- Users ---


class UsernameTakenError(Exception):
    pass


def create_user(username: str, password_hash: str, password_salt: str) -> dict:
    conn = get_conn()
    user_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc).isoformat()
    try:
        conn.execute(
            "INSERT INTO users (id, username, username_lower, password_hash, password_salt, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user_id, username, username.lower(), password_hash, password_salt, created_at),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        raise UsernameTakenError(username)
    return {"id": user_id, "username": username, "created_at": created_at}


def get_user_by_username(username: str) -> sqlite3.Row | None:
    return get_conn().execute(
        "SELECT * FROM users WHERE username_lower = ?", (username.lower(),)
    ).fetchone()


def get_user_by_id(user_id: str) -> sqlite3.Row | None:
    return get_conn().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def search_users(query: str, exclude_user_id: str, limit: int = 10) -> list[sqlite3.Row]:
    return get_conn().execute(
        "SELECT id, username FROM users WHERE username_lower LIKE ? AND id != ? "
        "ORDER BY username_lower LIMIT ?",
        (f"{query.lower()}%", exclude_user_id, limit),
    ).fetchall()


# --- Friend requests / friendships ---
# A friendship is just a friend_requests row with status='accepted' - no
# separate "friendships" table, so there's one place (not two) that can ever
# disagree about whether two users are friends.


class FriendRequestExistsError(Exception):
    pass


def create_friend_request(from_user_id: str, to_user_id: str) -> str:
    conn = get_conn()
    request_id = uuid.uuid4().hex
    try:
        conn.execute(
            "INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at) "
            "VALUES (?, ?, ?, 'pending', ?)",
            (request_id, from_user_id, to_user_id, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        raise FriendRequestExistsError((from_user_id, to_user_id))
    return request_id


def get_friend_request(request_id: str) -> sqlite3.Row | None:
    return get_conn().execute("SELECT * FROM friend_requests WHERE id = ?", (request_id,)).fetchone()


def get_friend_request_between(user_a: str, user_b: str) -> sqlite3.Row | None:
    return get_conn().execute(
        "SELECT * FROM friend_requests WHERE "
        "(from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)",
        (user_a, user_b, user_b, user_a),
    ).fetchone()


def set_friend_request_status(request_id: str, status: str) -> None:
    conn = get_conn()
    conn.execute("UPDATE friend_requests SET status = ? WHERE id = ?", (status, request_id))
    conn.commit()


def delete_friend_request(request_id: str) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM friend_requests WHERE id = ?", (request_id,))
    conn.commit()


def list_incoming_requests(user_id: str) -> list[sqlite3.Row]:
    return get_conn().execute(
        "SELECT fr.id, fr.created_at, u.id AS from_user_id, u.username AS from_username "
        "FROM friend_requests fr JOIN users u ON u.id = fr.from_user_id "
        "WHERE fr.to_user_id = ? AND fr.status = 'pending' ORDER BY fr.created_at",
        (user_id,),
    ).fetchall()


def list_friends(user_id: str) -> list[sqlite3.Row]:
    return get_conn().execute(
        "SELECT u.id, u.username FROM friend_requests fr "
        "JOIN users u ON u.id = (CASE WHEN fr.from_user_id = ? THEN fr.to_user_id ELSE fr.from_user_id END) "
        "WHERE fr.status = 'accepted' AND (fr.from_user_id = ? OR fr.to_user_id = ?) "
        "ORDER BY u.username_lower",
        (user_id, user_id, user_id),
    ).fetchall()


def are_friends(user_a: str, user_b: str) -> bool:
    row = get_conn().execute(
        "SELECT 1 FROM friend_requests WHERE status = 'accepted' AND "
        "((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))",
        (user_a, user_b, user_b, user_a),
    ).fetchone()
    return row is not None


# --- Saved decks ---
#
# A "deck" here is exactly DeckBuilder.jsx's own in-memory shape: an 8-entry
# array of piece letters (or null), file-indexed - not tied to a rank, so it
# loads back in identically whether the player ends up White or Black next
# time - plus which of those indices are evolved. Two slots per user, chosen
# by the frontend (1 or 2); this layer doesn't care how many a UI offers.


def save_deck(user_id: str, slot: int, name: str, deck: list, evolved_indices: list[int]) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO saved_decks (user_id, slot, name, deck_json, evolved_indices_json, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(user_id, slot) DO UPDATE SET "
        "name=excluded.name, deck_json=excluded.deck_json, evolved_indices_json=excluded.evolved_indices_json, "
        "updated_at=excluded.updated_at",
        (user_id, slot, name, json.dumps(deck), json.dumps(evolved_indices), datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def list_saved_decks(user_id: str) -> list[dict]:
    rows = get_conn().execute(
        "SELECT slot, name, deck_json, evolved_indices_json FROM saved_decks WHERE user_id = ? ORDER BY slot",
        (user_id,),
    ).fetchall()
    return [
        {
            "slot": r["slot"],
            "name": r["name"],
            "deck": json.loads(r["deck_json"]),
            "evolved_indices": json.loads(r["evolved_indices_json"]),
        }
        for r in rows
    ]


def delete_saved_deck(user_id: str, slot: int) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM saved_decks WHERE user_id = ? AND slot = ?", (user_id, slot))
    conn.commit()
