import os
import shutil
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# `neon link` (see repo root .neon/.env.local) writes the dev connection
# string one directory up from here, at the repo root - not loaded at all in
# production, where Render injects DATABASE_URL directly as a real env var.
# Doesn't override an already-set DATABASE_URL, so a real env var always wins.
load_dotenv(BASE_DIR.parent / ".env.local")

# .strip() guards against a stray trailing newline/whitespace in the env
# var's value (an easy mistake pasting a connection string into a dashboard
# text field) - psycopg parses it literally, so "require\n" as the sslmode
# fails validation and the app can't start at all. Learned the hard way:
# this exact thing took the whole backend down in production.
_raw_database_url = os.environ.get("DATABASE_URL")
DATABASE_URL = _raw_database_url.strip() if _raw_database_url else None

# Populated by the v1 setup (winget install Stockfish.Stockfish). Used only if
# "stockfish" isn't yet on PATH in the current shell session.
_FALLBACK_STOCKFISH_PATHS = [
    r"C:\Users\anton\AppData\Local\Microsoft\WinGet\Packages\Stockfish.Stockfish_Microsoft.Winget.Source_8wekyb3d8bbwe\stockfish\stockfish-windows-x86-64-avx2.exe",
]


def _resolve_stockfish_path() -> str:
    env_path = os.environ.get("STOCKFISH_PATH")
    if env_path:
        return env_path
    on_path = shutil.which("stockfish")
    if on_path:
        return on_path
    for candidate in _FALLBACK_STOCKFISH_PATHS:
        if Path(candidate).exists():
            return candidate
    return "stockfish"  # fail loudly at engine start if truly missing


STOCKFISH_PATH = _resolve_stockfish_path()
STOCKFISH_DEPTH = int(os.environ.get("STOCKFISH_DEPTH", "16"))
STOCKFISH_THREADS = int(os.environ.get("STOCKFISH_THREADS", "2"))
BEST_LINE_LENGTH = int(os.environ.get("CHESS_EVAL_BEST_LINE_LENGTH", "5"))

# Chess.com's Published-Data API requires a descriptive User-Agent with contact
# info, or it returns 403. See https://www.chess.com/news/view/published-data-api
CONTACT_EMAIL = os.environ.get("CHESS_EVAL_CONTACT_EMAIL", "antony@hitti.com.au")
CHESSCOM_USER_AGENT = f"ChessGameAnalyzer/1.0 (contact: {CONTACT_EMAIL})"
