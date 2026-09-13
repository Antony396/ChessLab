"""Puzzle content and live Puzzle Rush sessions.

Puzzle data is a CC0-licensed sample of 1000 real Lichess puzzles (see
data/lichess_puzzles.csv) - standard chess only, unrelated to Evo Chess's
hero pieces, since no dataset (or realistic way to hand-build one at any
real scale) exists for those. Loaded into memory once at import time and
never mutated; sessions are in-memory too and don't survive a restart,
same tradeoff the rest of this app's live/ephemeral state already makes.
"""

from __future__ import annotations

import csv
import random
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import chess

_CSV_PATH = Path(__file__).resolve().parent / "data" / "lichess_puzzles.csv"


@dataclass
class Puzzle:
    id: str
    # The position the SOLVER actually sees - the raw Lichess FEN is the
    # position *before* the opponent's setup move (Moves[0]), which this
    # has already had applied, so nothing downstream needs to know about
    # that quirk of the source format.
    start_fen: str
    # The solver's remaining moves to find, alternating with the
    # opponent's forced replies (solver, opponent, solver, ...), in UCI.
    solution_moves: list[str]
    rating: int


def _load_puzzles() -> list[Puzzle]:
    puzzles: list[Puzzle] = []
    with open(_CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                moves = row["Moves"].split()
                if len(moves) < 2:
                    continue
                board = chess.Board(row["FEN"])
                board.push_uci(moves[0])
                puzzles.append(
                    Puzzle(
                        id=row["PuzzleId"],
                        start_fen=board.fen(),
                        solution_moves=moves[1:],
                        rating=int(row["Rating"]),
                    )
                )
            except Exception:
                continue  # skip a malformed row rather than fail the whole load
    puzzles.sort(key=lambda p: p.rating)
    return puzzles


_PUZZLES: list[Puzzle] = _load_puzzles()


def puzzle_count() -> int:
    return len(_PUZZLES)


def puzzle_at(index: int) -> Optional[Puzzle]:
    if 0 <= index < len(_PUZZLES):
        return _PUZZLES[index]
    return None


def pick_start_index() -> int:
    # Starting somewhere in the easier third (rather than always at the
    # very bottom) means a run still naturally ramps up in difficulty as
    # it goes, while varying between runs instead of opening on the exact
    # same puzzle every time.
    easy_ceiling = max(1, len(_PUZZLES) // 3)
    return random.randint(0, easy_ceiling - 1)


@dataclass
class RushSession:
    id: str
    user_id: str
    duration_seconds: int
    started_at: float
    puzzle_index: int
    board: chess.Board  # current position within the current puzzle
    remaining_moves: list[str]  # this puzzle's not-yet-played solution moves
    score: int = 0
    finished: bool = False


_SESSIONS: dict[str, RushSession] = {}


def create_session(user_id: str, duration_seconds: int) -> RushSession:
    start_index = pick_start_index()
    puzzle = puzzle_at(start_index)
    session = RushSession(
        id=uuid.uuid4().hex,
        user_id=user_id,
        duration_seconds=duration_seconds,
        started_at=time.time(),
        puzzle_index=start_index,
        board=chess.Board(puzzle.start_fen),
        remaining_moves=list(puzzle.solution_moves),
    )
    _SESSIONS[session.id] = session
    return session


def get_session(session_id: str) -> Optional[RushSession]:
    return _SESSIONS.get(session_id)


def time_remaining(session: RushSession) -> float:
    elapsed = time.time() - session.started_at
    return max(0.0, session.duration_seconds - elapsed)


def advance_to_next_puzzle(session: RushSession) -> Puzzle:
    session.puzzle_index += 1
    puzzle = puzzle_at(session.puzzle_index)
    if puzzle is None:
        # Ran past the end of the pool (only realistic for an extremely
        # fast run) - loop back to the start rather than error out.
        session.puzzle_index = 0
        puzzle = puzzle_at(0)
    session.board = chess.Board(puzzle.start_fen)
    session.remaining_moves = list(puzzle.solution_moves)
    return puzzle
