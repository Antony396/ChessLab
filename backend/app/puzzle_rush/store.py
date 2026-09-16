"""The shared Lichess tactics pool: a CC0-licensed sample of 1000 real
puzzles (see data/lichess_puzzles.csv) - standard chess only, unrelated to
Evo Chess's hero pieces, since no dataset (or realistic way to hand-build
one at any real scale) exists for those. Loaded into memory once at import
time and never mutated.

Originally backed the timed Puzzle Rush mode; that mode is gone (see
puzzle_map/store.py, which replaced it with a 50-node progression map), but
this pool of puzzles - sorted by rating - is exactly what that map draws
its plain-chess nodes from, so the loader stays here rather than getting
duplicated.
"""

from __future__ import annotations

import csv
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
