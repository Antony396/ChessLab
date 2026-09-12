"""Computer opponent for Hero Chess: plain Stockfish, weakened as far as it
goes. Stockfish never learns about hero abilities or Dragons - it just plays
legal chess against whatever position it's handed - so the AI never uses
either even if its own formation happened to include them.

Stockfish's UCI_Elo has a hard floor (1320 on this build; verified via
engine.options at build time) - true 1000 isn't reachable through that knob
alone. We sit at the floor and additionally cap search time/depth hard,
which knocks real playing strength down further below the calibrated floor.
It's an approximation of "~1000", not a calibrated one.
"""

from __future__ import annotations

import threading
from typing import Optional

import chess
import chess.engine

from app.config import STOCKFISH_PATH

AI_UCI_ELO_FLOOR = 1320
AI_TIME_LIMIT_SECONDS = 0.05
AI_DEPTH_LIMIT = 5

# Launching a fresh Stockfish subprocess (full UCI handshake included) on
# every single move dwarfed the ~50ms search time limit below - several
# seconds of pure process-spawn overhead on a resource-constrained host,
# which was the actual "the AI is slow" complaint, not the search itself.
# Keeping one engine process alive for the life of the server and reusing
# it turns every move after the very first into just the real search time.
# Guarded by a lock since FastAPI runs sync routes across a thread pool,
# and a UCI engine's stdin/stdout exchange isn't safe to interleave from
# two threads making moves in two different games at once.
_engine: Optional[chess.engine.SimpleEngine] = None
_engine_lock = threading.Lock()


def _get_engine() -> chess.engine.SimpleEngine:
    global _engine
    if _engine is None:
        _engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)
        _engine.configure({"UCI_LimitStrength": True, "UCI_Elo": AI_UCI_ELO_FLOOR})
    return _engine


def shutdown_engine() -> None:
    global _engine
    with _engine_lock:
        if _engine is not None:
            _engine.quit()
            _engine = None


def compute_ai_move(board: chess.Board, excluded_moves: Optional[set[chess.Move]] = None) -> chess.Move:
    # python-chess reconstructs the position for the engine as
    # "position fen <root> moves <move1> <move2> ..." - replaying the whole
    # move stack from the game's start. A Dragon's knight-shaped hop isn't a
    # legal move for whatever Stockfish thinks occupies that square (a plain
    # Rook, per the FEN), so replaying it desyncs the engine's own internal
    # board and produces garbage. Handing over a fresh snapshot with no move
    # history sends a plain "position fen <current fen>" instead, so nothing
    # ever gets replayed through Stockfish's rook-only understanding of that
    # piece.
    snapshot = chess.Board(board.fen())

    root_moves = None
    if excluded_moves:
        # The caller found `excluded_moves` illegal under rules Stockfish
        # can't see (an evolved piece's check-safety extra threat) - asking
        # again with those excluded from the search picks the engine's next
        # best legal try instead.
        root_moves = [m for m in snapshot.legal_moves if m not in excluded_moves]
        if not root_moves:
            raise RuntimeError("No legal moves remain for the engine to choose from")

    limit = chess.engine.Limit(time=AI_TIME_LIMIT_SECONDS, depth=AI_DEPTH_LIMIT)
    with _engine_lock:
        try:
            result = _get_engine().play(snapshot, limit, root_moves=root_moves)
        except chess.engine.EngineTerminatedError:
            # The process died underneath us (e.g. host OOM-killed it) -
            # relaunch once and retry rather than staying broken forever.
            global _engine
            _engine = None
            result = _get_engine().play(snapshot, limit, root_moves=root_moves)

    if result.move is None:
        raise RuntimeError("Engine returned no move")
    return result.move
