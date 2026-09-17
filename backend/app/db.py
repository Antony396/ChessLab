"""Postgres (Neon) persistence: HTTP ETag cache, fetched games, analysis
results, and user accounts/friendships/saved decks - all of it durable across
a deploy, unlike everything in custom_chess/store.py (and unlike this file's
own previous life as a local SQLite file, which didn't survive a Render
redeploy since the container filesystem is ephemeral there).

One connection per thread (FastAPI's sync route handlers run in a thread
pool), each opened lazily and reused for the life of that thread. Neon's
compute auto-suspends after a period of inactivity, which silently breaks a
long-idle thread's held connection - get_conn() below pings before handing
one back and transparently reconnects if it's gone.
"""

from __future__ import annotations

import json
import threading
import uuid
from datetime import date, datetime, timedelta, timezone

import psycopg
from psycopg.rows import dict_row

from app.config import DATABASE_URL
from app.models.analysis import GameAnalysis
from app.models.game import Game

_local = threading.local()


def _connect() -> psycopg.Connection:
    # prepare_threshold=None disables psycopg's automatic server-side
    # prepared statements - harmless on their own, but Neon's pooled
    # connection string can transparently swap which real Postgres backend
    # session a connection is attached to between transactions, and a
    # statement prepared against one backend session doesn't exist on
    # another. Without this, a query repeated enough times to cross
    # psycopg's default prepare threshold could start intermittently failing
    # with "prepared statement does not exist" under real traffic.
    #
    # autocommit=True: psycopg3 defaults to autocommit=False, meaning even a
    # bare read (SELECT * FROM users WHERE id = %s, say) opens a real
    # transaction that stays open - "idle in transaction" - until something
    # ELSE on that same thread's connection happens to commit. Almost every
    # read function in this file never calls .commit() at all (there's
    # nothing to persist), so on a long-lived thread each read just left its
    # transaction open indefinitely. Normally harmless, but it holds a lock
    # that blocks a DDL statement needing exclusive access to that table -
    # this is exactly what silently hung this backend's own startup for
    # several minutes once enough read-only requests had accumulated open
    # transactions across worker threads: init_db()'s ALTER TABLE ... ADD
    # COLUMN queued behind them and never got a chance to run. Every write
    # below still calls .commit() explicitly (now a harmless no-op under
    # autocommit) - none of them needs multi-statement atomicity with
    # anything else, so there's no downside to this being always-on.
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, prepare_threshold=None, autocommit=True)


def get_conn() -> psycopg.Connection:
    conn = getattr(_local, "conn", None)
    if conn is not None and not conn.closed:
        try:
            conn.execute("SELECT 1")
        except psycopg.Error:
            conn.close()
            conn = None
    if conn is None:
        conn = _connect()
        _local.conn = conn
    return conn


def init_db() -> None:
    conn = get_conn()
    conn.execute(
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
        CREATE TABLE IF NOT EXISTS daily_puzzles (
            puzzle_date TEXT PRIMARY KEY,
            definition_json TEXT NOT NULL,
            created_by TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_puzzle_streaks (
            user_id TEXT PRIMARY KEY,
            current_streak INTEGER NOT NULL DEFAULT 0,
            longest_streak INTEGER NOT NULL DEFAULT 0,
            last_solved_date TEXT
        );
        CREATE TABLE IF NOT EXISTS map_puzzle_progress (
            user_id TEXT PRIMARY KEY,
            solved_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS hero_puzzle_map_nodes (
            node_index INTEGER PRIMARY KEY,
            definition_json TEXT NOT NULL,
            created_by TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS hero_map_puzzle_progress (
            user_id TEXT PRIMARY KEY,
            solved_json TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS owned_skins (
            user_id TEXT NOT NULL,
            skin_key TEXT NOT NULL,
            purchased_at TEXT NOT NULL,
            PRIMARY KEY (user_id, skin_key)
        );
        CREATE TABLE IF NOT EXISTS battle_pass_claims (
            user_id TEXT NOT NULL,
            level INTEGER NOT NULL,
            claimed_at TEXT NOT NULL,
            PRIMARY KEY (user_id, level)
        );
        """
    )
    # A plain ALTER rather than folding this into the users table's own
    # CREATE TABLE above - that CREATE is a no-op against an already-
    # existing table (this one's been live since the Neon migration), so a
    # new column needs its own statement to actually reach accounts created
    # before this feature existed. IF NOT EXISTS makes it safe to run again
    # every startup, same as the CREATE TABLEs above.
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS elo INTEGER NOT NULL DEFAULT 1000;")
    # currency: the win-reward balance (see award_currency_for_win) - a
    # separate concept from elo, which only ever tracks skill/rank.
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS currency INTEGER NOT NULL DEFAULT 0;")
    # equipped_skin: mirrors the frontend's own skinStore.js local choice,
    # persisted here too so OTHER users (the leaderboard, a dorm visit) can
    # see what King skin someone has on - local-only storage has no way to
    # answer "what does this other player look like" for anyone but you.
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_skin TEXT NOT NULL DEFAULT 'classic';")
    # xp: the level-system total (see award_xp_for_result) - unlike currency,
    # both sides of a real game earn some (a loss just earns less), since
    # this is meant to track "how much have you played", not "how much have
    # you won".
    conn.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;")
    conn.commit()


# --- HTTP cache (ETag) ---


def get_cached_response(cache_key: str) -> dict | None:
    row = get_conn().execute(
        "SELECT etag, body FROM http_cache WHERE cache_key = %s", (cache_key,)
    ).fetchone()
    return dict(row) if row else None


def set_cached_response(cache_key: str, etag: str | None, body: str) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO http_cache (cache_key, etag, body, fetched_at) VALUES (%s, %s, %s, %s) "
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
        "VALUES (%s, %s, %s, %s, %s) "
        "ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json, end_time=excluded.end_time",
        (game.id, game.platform, queried_username.lower(), game.model_dump_json(), game.end_time),
    )
    conn.commit()


def get_game(game_id: str) -> Game | None:
    row = get_conn().execute("SELECT data_json FROM games WHERE id = %s", (game_id,)).fetchone()
    return Game.model_validate_json(row["data_json"]) if row else None


def list_games(platform: str, username: str) -> list[Game]:
    rows = get_conn().execute(
        "SELECT data_json FROM games WHERE platform = %s AND queried_username = %s "
        "ORDER BY end_time DESC",
        (platform, username.lower()),
    ).fetchall()
    return [Game.model_validate_json(r["data_json"]) for r in rows]


# --- Analysis cache ---


def get_cached_analysis(game_id: str, depth: int) -> GameAnalysis | None:
    row = get_conn().execute(
        "SELECT analysis_json FROM analysis_cache WHERE game_id = %s AND depth = %s",
        (game_id, depth),
    ).fetchone()
    return GameAnalysis.model_validate_json(row["analysis_json"]) if row else None


def save_analysis(game_id: str, depth: int, analysis: GameAnalysis) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO analysis_cache (game_id, depth, analysis_json, generated_at) "
        "VALUES (%s, %s, %s, %s) "
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
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (user_id, username, username.lower(), password_hash, password_salt, created_at),
        )
        conn.commit()
    except psycopg.errors.UniqueViolation:
        conn.rollback()
        raise UsernameTakenError(username)
    return {"id": user_id, "username": username, "created_at": created_at}


def get_user_by_username(username: str) -> dict | None:
    return get_conn().execute(
        "SELECT * FROM users WHERE username_lower = %s", (username.lower(),)
    ).fetchone()


def get_user_by_id(user_id: str) -> dict | None:
    return get_conn().execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()


def search_users(query: str, exclude_user_id: str, limit: int = 10) -> list[dict]:
    return get_conn().execute(
        "SELECT id, username FROM users WHERE username_lower LIKE %s AND id != %s "
        "ORDER BY username_lower LIMIT %s",
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
            "VALUES (%s, %s, %s, 'pending', %s)",
            (request_id, from_user_id, to_user_id, datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()
    except psycopg.errors.UniqueViolation:
        conn.rollback()
        raise FriendRequestExistsError((from_user_id, to_user_id))
    return request_id


def get_friend_request(request_id: str) -> dict | None:
    return get_conn().execute("SELECT * FROM friend_requests WHERE id = %s", (request_id,)).fetchone()


def get_friend_request_between(user_a: str, user_b: str) -> dict | None:
    return get_conn().execute(
        "SELECT * FROM friend_requests WHERE "
        "(from_user_id = %s AND to_user_id = %s) OR (from_user_id = %s AND to_user_id = %s)",
        (user_a, user_b, user_b, user_a),
    ).fetchone()


def set_friend_request_status(request_id: str, status: str) -> None:
    conn = get_conn()
    conn.execute("UPDATE friend_requests SET status = %s WHERE id = %s", (status, request_id))
    conn.commit()


def delete_friend_request(request_id: str) -> None:
    conn = get_conn()
    conn.execute("DELETE FROM friend_requests WHERE id = %s", (request_id,))
    conn.commit()


def list_incoming_requests(user_id: str) -> list[dict]:
    return get_conn().execute(
        "SELECT fr.id, fr.created_at, u.id AS from_user_id, u.username AS from_username "
        "FROM friend_requests fr JOIN users u ON u.id = fr.from_user_id "
        "WHERE fr.to_user_id = %s AND fr.status = 'pending' ORDER BY fr.created_at",
        (user_id,),
    ).fetchall()


def list_friends(user_id: str) -> list[dict]:
    return get_conn().execute(
        "SELECT u.id, u.username, u.xp, u.equipped_skin FROM friend_requests fr "
        "JOIN users u ON u.id = (CASE WHEN fr.from_user_id = %s THEN fr.to_user_id ELSE fr.from_user_id END) "
        "WHERE fr.status = 'accepted' AND (fr.from_user_id = %s OR fr.to_user_id = %s) "
        "ORDER BY u.username_lower",
        (user_id, user_id, user_id),
    ).fetchall()


def are_friends(user_a: str, user_b: str) -> bool:
    row = get_conn().execute(
        "SELECT 1 FROM friend_requests WHERE status = 'accepted' AND "
        "((from_user_id = %s AND to_user_id = %s) OR (from_user_id = %s AND to_user_id = %s))",
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
        "VALUES (%s, %s, %s, %s, %s, %s) "
        "ON CONFLICT(user_id, slot) DO UPDATE SET "
        "name=excluded.name, deck_json=excluded.deck_json, evolved_indices_json=excluded.evolved_indices_json, "
        "updated_at=excluded.updated_at",
        (user_id, slot, name, json.dumps(deck), json.dumps(evolved_indices), datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def list_saved_decks(user_id: str) -> list[dict]:
    rows = get_conn().execute(
        "SELECT slot, name, deck_json, evolved_indices_json FROM saved_decks WHERE user_id = %s ORDER BY slot",
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
    conn.execute("DELETE FROM saved_decks WHERE user_id = %s AND slot = %s", (user_id, slot))
    conn.commit()


# --- ELO ---
#
# Every account starts at DEFAULT_ELO (the "elo INTEGER NOT NULL DEFAULT
# 1000" column above) and only ever changes here, when a REAL online game
# between two known accounts actually finishes (see online_game_routes.py's
# online_move) - a vs_ai/local-sandbox game, or an online game where either
# side never linked an account (see CustomGame.white_user_id/
# black_user_id), never touches this at all. One fixed K-factor for
# everyone for now - no provisional/established-rating split, no separate
# pools per time control - simplest thing that actually rates real games.

DEFAULT_ELO = 1000
ELO_K_FACTOR = 32


def get_elo(user_id: str) -> int:
    row = get_conn().execute("SELECT elo FROM users WHERE id = %s", (user_id,)).fetchone()
    return row["elo"] if row else DEFAULT_ELO


def update_elo(user_id: str, new_elo: int) -> None:
    conn = get_conn()
    conn.execute("UPDATE users SET elo = %s WHERE id = %s", (new_elo, user_id))
    conn.commit()


def apply_elo_result(white_user_id: str, black_user_id: str, result: str) -> tuple[int, int]:
    """The standard ELO update for one finished game. `result` is
    "white" | "black" | "draw" - whichever side actually won, or a draw.
    Returns (new_white_elo, new_black_elo)."""
    white_elo = get_elo(white_user_id)
    black_elo = get_elo(black_user_id)
    expected_white = 1 / (1 + 10 ** ((black_elo - white_elo) / 400))
    score_white = 1.0 if result == "white" else 0.0 if result == "black" else 0.5
    new_white_elo = round(white_elo + ELO_K_FACTOR * (score_white - expected_white))
    new_black_elo = round(black_elo + ELO_K_FACTOR * ((1 - score_white) - (1 - expected_white)))
    update_elo(white_user_id, new_white_elo)
    update_elo(black_user_id, new_black_elo)
    return new_white_elo, new_black_elo


# --- Currency ---
#
# A separate reward balance from elo (which only ever tracks skill/rank) -
# awarded for actually winning, not for playing well in a game you lost.
# Same scope as elo: only a real online game between two known accounts
# (see online_game_routes.py's online_move, right next to its own
# apply_elo_result call) ever moves this - vs_ai/local-sandbox play doesn't.
# No spending mechanism exists yet; this is just the earning side.

CURRENCY_PER_WIN = 10


def get_currency(user_id: str) -> int:
    row = get_conn().execute("SELECT currency FROM users WHERE id = %s", (user_id,)).fetchone()
    return row["currency"] if row else 0


def add_currency(user_id: str, amount: int) -> int:
    conn = get_conn()
    conn.execute("UPDATE users SET currency = currency + %s WHERE id = %s", (amount, user_id))
    conn.commit()
    return get_currency(user_id)


def award_currency_for_win(white_user_id: str, black_user_id: str, result: str) -> None:
    """`result` is "white" | "black" | "draw", same as apply_elo_result's own
    - only the actual winner gets anything; a draw pays out nothing to
    either side."""
    if result == "white":
        add_currency(white_user_id, CURRENCY_PER_WIN)
    elif result == "black":
        add_currency(black_user_id, CURRENCY_PER_WIN)


# --- XP / Level -----------------------------------------------------------
#
# A separate progression track from both elo (skill/rank) and currency
# (spendable reward) - tracks "how much have you played", so unlike
# currency BOTH sides of a real game earn something, a loss just earns
# less. Same scope as elo/currency: only a real online game between two
# known accounts moves this (see award_xp_for_result's call site,
# online_game_routes.py's _apply_game_end_rewards).
#
# Level uses a triangular (1+2+3+...) curve rather than a flat per-level
# cost, so each level takes a little longer than the last - a standard
# RPG-style curve, and one simple closed-form formula covers both
# directions (xp -> level, level -> xp-required) without needing a lookup
# table.

XP_PER_WIN = 20
XP_PER_LOSS = 5
XP_PER_DRAW = 10
_XP_LEVEL_UNIT = 100  # xp_for_level(n) = _XP_LEVEL_UNIT * n * (n-1) / 2


def xp_for_level(level: int) -> int:
    """Cumulative XP required to REACH `level` (level 1 = 0 XP)."""
    n = level - 1
    return _XP_LEVEL_UNIT * n * (n + 1) // 2


def level_for_xp(xp: int) -> int:
    """Inverse of xp_for_level - the highest level `xp` actually reaches."""
    level = 1
    while xp_for_level(level + 1) <= xp:
        level += 1
    return level


def get_xp(user_id: str) -> int:
    row = get_conn().execute("SELECT xp FROM users WHERE id = %s", (user_id,)).fetchone()
    return row["xp"] if row else 0


def add_xp(user_id: str, amount: int) -> int:
    conn = get_conn()
    conn.execute("UPDATE users SET xp = xp + %s WHERE id = %s", (amount, user_id))
    conn.commit()
    return get_xp(user_id)


def award_xp_for_result(white_user_id: str, black_user_id: str, result: str) -> None:
    """`result` is "white" | "black" | "draw" - the winner earns XP_PER_WIN,
    the loser still earns XP_PER_LOSS (a draw pays XP_PER_DRAW to both)."""
    if result == "white":
        add_xp(white_user_id, XP_PER_WIN)
        add_xp(black_user_id, XP_PER_LOSS)
    elif result == "black":
        add_xp(black_user_id, XP_PER_WIN)
        add_xp(white_user_id, XP_PER_LOSS)
    else:
        add_xp(white_user_id, XP_PER_DRAW)
        add_xp(black_user_id, XP_PER_DRAW)


# --- Equipped skin ---
#
# Mirrors the frontend's own skinStore.js local choice (localStorage,
# per-browser) - persisted here too so OTHER users can see what King skin
# someone has equipped (the leaderboard, a dorm/Commons visit), which local
# storage alone could never answer for anyone but the viewer themselves.
# Not validated against the frontend's KING_SKINS registry - an unrecognized
# key just falls back to the classic skin wherever it's rendered, same as
# an unrecognized bot skin already does (see social/bots.py).

DEFAULT_EQUIPPED_SKIN = "classic"


def set_equipped_skin(user_id: str, skin: str) -> None:
    conn = get_conn()
    conn.execute("UPDATE users SET equipped_skin = %s WHERE id = %s", (skin, user_id))
    conn.commit()


# --- Shop (skin purchases) -------------------------------------------------
#
# SHOP_CATALOG is the one authoritative price list - the frontend's
# KING_SKINS registry (skinStore.js) mirrors these same numbers for display,
# but purchase_skin below always charges from HERE, never from anything the
# client sends, so a stale bundle or a tampered request can't buy a skin
# for less than its real price.

SHOP_CATALOG: dict[str, int] = {
    "dragonKing": 150,
    "crimsonKnight": 150,
    "emberKnight": 180,
    "bronzeKing": 200,
    "silverAscendant": 250,
    "goldenAscendant": 300,
    "emeraldWarden": 220,
}

SHOP_SKIN_NOT_FOR_SALE = "not_for_sale"
SHOP_SKIN_INSUFFICIENT_FUNDS = "insufficient_funds"
SHOP_SKIN_ALREADY_OWNED = "already_owned"


class ShopPurchaseError(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def get_owned_skins(user_id: str) -> list[str]:
    rows = get_conn().execute(
        "SELECT skin_key FROM owned_skins WHERE user_id = %s", (user_id,)
    ).fetchall()
    return [r["skin_key"] for r in rows]


def owns_skin(user_id: str, skin_key: str) -> bool:
    row = get_conn().execute(
        "SELECT 1 FROM owned_skins WHERE user_id = %s AND skin_key = %s", (user_id, skin_key)
    ).fetchone()
    return row is not None


def purchase_skin(user_id: str, skin_key: str) -> int:
    """Looks the price up from SHOP_CATALOG itself (see its own comment) and
    deducts it, atomically enough for this app's traffic (single-row
    read-then-write on one thread's own connection - see this module's own
    docstring on the concurrency model). Raises ShopPurchaseError instead of
    silently no-op'ing so the route layer can tell the failure cases apart.
    Returns the new currency balance."""
    if skin_key not in SHOP_CATALOG:
        raise ShopPurchaseError(SHOP_SKIN_NOT_FOR_SALE)
    if owns_skin(user_id, skin_key):
        raise ShopPurchaseError(SHOP_SKIN_ALREADY_OWNED)
    cost = SHOP_CATALOG[skin_key]
    if get_currency(user_id) < cost:
        raise ShopPurchaseError(SHOP_SKIN_INSUFFICIENT_FUNDS)
    conn = get_conn()
    conn.execute("UPDATE users SET currency = currency - %s WHERE id = %s", (cost, user_id))
    conn.execute(
        "INSERT INTO owned_skins (user_id, skin_key, purchased_at) VALUES (%s, %s, %s) "
        "ON CONFLICT (user_id, skin_key) DO NOTHING",
        (user_id, skin_key, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    return get_currency(user_id)


# --- Battle pass ------------------------------------------------------------
#
# One free reward track keyed off the XP/level system above - no premium
# tier yet (there's no payment system to sell one through). Every level is
# claimable exactly once, for a currency reward that scales with the level
# itself, so there's no fixed reward table to run out of or keep in sync
# with new content.

BATTLE_PASS_REWARD_PER_LEVEL = 20  # level N's claim pays N * this amount


def battle_pass_reward_for_level(level: int) -> int:
    return level * BATTLE_PASS_REWARD_PER_LEVEL


def get_claimed_battle_pass_levels(user_id: str) -> list[int]:
    rows = get_conn().execute(
        "SELECT level FROM battle_pass_claims WHERE user_id = %s ORDER BY level", (user_id,)
    ).fetchall()
    return [r["level"] for r in rows]


class BattlePassClaimError(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def claim_battle_pass_level(user_id: str, level: int) -> int:
    """Raises BattlePassClaimError if `level` is above the account's actual
    level (not reached yet) or already claimed. Returns the new currency
    balance."""
    if level < 1 or level > level_for_xp(get_xp(user_id)):
        raise BattlePassClaimError("not_reached")
    if level in get_claimed_battle_pass_levels(user_id):
        raise BattlePassClaimError("already_claimed")
    conn = get_conn()
    conn.execute(
        "INSERT INTO battle_pass_claims (user_id, level, claimed_at) VALUES (%s, %s, %s)",
        (user_id, level, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()
    return add_currency(user_id, battle_pass_reward_for_level(level))


def get_leaderboard(limit: int = 20) -> list[dict]:
    return get_conn().execute(
        "SELECT id, username, elo, equipped_skin FROM users ORDER BY elo DESC, username_lower LIMIT %s", (limit,)
    ).fetchall()


def get_leaderboard_rank(user_id: str) -> int | None:
    """1-indexed rank by elo (ties broken by username, matching
    get_leaderboard's own ORDER BY) - None if the user doesn't exist."""
    row = get_conn().execute(
        "SELECT rank FROM ("
        "  SELECT id, RANK() OVER (ORDER BY elo DESC, username_lower) AS rank FROM users"
        ") ranked WHERE id = %s",
        (user_id,),
    ).fetchone()
    return row["rank"] if row else None


# --- Daily puzzle ---
#
# One puzzle per calendar day (puzzle_date, "YYYY-MM-DD"), featuring the
# hero pieces - unlike puzzle_rush/store.py's static Lichess-derived pool
# (plain chess only), these are hand-authored and "posted" via
# create_daily_puzzle (see daily_puzzle_routes.py's POST endpoint) rather
# than loaded from a fixed dataset. `definition` is a plain dict shaped
# exactly like _build_game_from_two_decks's own inputs plus a `solution`
# move list, so building the puzzle's starting position reuses that
# existing function directly - see daily_puzzle/store.py for the live
# in-memory attempt this gets loaded into.
STREAK_UNLOCK_SKIN_DAYS = 10


def create_daily_puzzle(puzzle_date: str, definition: dict, created_by: str | None) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO daily_puzzles (puzzle_date, definition_json, created_by, created_at) "
        "VALUES (%s, %s, %s, %s) "
        "ON CONFLICT(puzzle_date) DO UPDATE SET "
        "definition_json=excluded.definition_json, created_by=excluded.created_by, created_at=excluded.created_at",
        (puzzle_date, json.dumps(definition), created_by, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def get_daily_puzzle(puzzle_date: str) -> dict | None:
    row = get_conn().execute(
        "SELECT definition_json FROM daily_puzzles WHERE puzzle_date = %s", (puzzle_date,)
    ).fetchone()
    return json.loads(row["definition_json"]) if row else None


def today_string() -> str:
    return date.today().isoformat()


def get_streak(user_id: str) -> dict:
    row = get_conn().execute(
        "SELECT current_streak, longest_streak, last_solved_date FROM daily_puzzle_streaks WHERE user_id = %s",
        (user_id,),
    ).fetchone()
    if row is None:
        return {"current_streak": 0, "longest_streak": 0, "last_solved_date": None}
    return dict(row)


def record_daily_solve(user_id: str, puzzle_date: str) -> dict:
    """Call exactly once, the moment a user finishes today's puzzle -
    advances their streak if puzzle_date is the day right after
    last_solved_date, resets to 1 on any gap (including a first-ever
    solve), and is a no-op if puzzle_date was already recorded (repeat
    calls for the same day, e.g. a page refresh after solving, must never
    double-count). Returns the resulting streak row."""
    current = get_streak(user_id)
    if current["last_solved_date"] == puzzle_date:
        return current

    solved_day = date.fromisoformat(puzzle_date)
    yesterday = (solved_day - timedelta(days=1)).isoformat()
    if current["last_solved_date"] == yesterday:
        new_current = current["current_streak"] + 1
    else:
        new_current = 1
    new_longest = max(current["longest_streak"], new_current)

    conn = get_conn()
    conn.execute(
        "INSERT INTO daily_puzzle_streaks (user_id, current_streak, longest_streak, last_solved_date) "
        "VALUES (%s, %s, %s, %s) "
        "ON CONFLICT(user_id) DO UPDATE SET "
        "current_streak=excluded.current_streak, longest_streak=excluded.longest_streak, "
        "last_solved_date=excluded.last_solved_date",
        (user_id, new_current, new_longest, puzzle_date),
    )
    conn.commit()
    return {"current_streak": new_current, "longest_streak": new_longest, "last_solved_date": puzzle_date}


# --- Puzzle Map ---
#
# The 50-node puzzle progression (see app/puzzle_map/store.py for what each
# node actually is) - just a permanent per-user set of solved node indices,
# same durability tradeoff as the streak table above. Reaching node 50
# unlocks the Regal King skin (see frontend's skinStore.js).


def get_map_progress(user_id: str) -> list[int]:
    row = get_conn().execute(
        "SELECT solved_json FROM map_puzzle_progress WHERE user_id = %s", (user_id,)
    ).fetchone()
    return json.loads(row["solved_json"]) if row else []


def record_map_solve(user_id: str, index: int) -> list[int]:
    solved = sorted(set(get_map_progress(user_id)) | {index})
    conn = get_conn()
    conn.execute(
        "INSERT INTO map_puzzle_progress (user_id, solved_json) VALUES (%s, %s) "
        "ON CONFLICT(user_id) DO UPDATE SET solved_json = excluded.solved_json",
        (user_id, json.dumps(solved)),
    )
    conn.commit()
    return solved


# --- Hero Puzzle Map ---
#
# A second 50-slot puzzle route, structurally identical to the Puzzle Map
# above (same sequential-unlock/permanent-solved-set shape - see
# app/hero_puzzle_map/store.py), but its nodes are hand-authored by whoever
# posts them via POST /hero-puzzle-map/nodes (see hero_puzzle_map_routes.py)
# rather than derived from the shared Lichess pool, so unlike the original
# map not every slot 1-50 necessarily has a puzzle yet - get_hero_map_node
# returning None for an un-authored index is expected, not an error.
# Reaching node 50 unlocks the Hydra King skin (moved here from the
# original Puzzle Map - see frontend's skinStore.js).


def create_hero_map_node(index: int, definition: dict, created_by: str | None) -> None:
    conn = get_conn()
    conn.execute(
        "INSERT INTO hero_puzzle_map_nodes (node_index, definition_json, created_by, created_at) "
        "VALUES (%s, %s, %s, %s) "
        "ON CONFLICT(node_index) DO UPDATE SET "
        "definition_json=excluded.definition_json, created_by=excluded.created_by, created_at=excluded.created_at",
        (index, json.dumps(definition), created_by, datetime.now(timezone.utc).isoformat()),
    )
    conn.commit()


def get_hero_map_node(index: int) -> dict | None:
    row = get_conn().execute(
        "SELECT definition_json FROM hero_puzzle_map_nodes WHERE node_index = %s", (index,)
    ).fetchone()
    return json.loads(row["definition_json"]) if row else None


def get_authored_hero_map_indices() -> set[int]:
    rows = get_conn().execute("SELECT node_index FROM hero_puzzle_map_nodes").fetchall()
    return {row["node_index"] for row in rows}


def get_hero_map_progress(user_id: str) -> list[int]:
    row = get_conn().execute(
        "SELECT solved_json FROM hero_map_puzzle_progress WHERE user_id = %s", (user_id,)
    ).fetchone()
    return json.loads(row["solved_json"]) if row else []


def record_hero_map_solve(user_id: str, index: int) -> list[int]:
    solved = sorted(set(get_hero_map_progress(user_id)) | {index})
    conn = get_conn()
    conn.execute(
        "INSERT INTO hero_map_puzzle_progress (user_id, solved_json) VALUES (%s, %s) "
        "ON CONFLICT(user_id) DO UPDATE SET solved_json = excluded.solved_json",
        (user_id, json.dumps(solved)),
    )
    conn.commit()
    return solved
