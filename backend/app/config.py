import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = os.environ.get("CHESS_EVAL_DB_PATH", str(DATA_DIR / "chess_eval.db"))

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
