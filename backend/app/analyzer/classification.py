"""Lichess's move-quality convention: convert eval to win% (logistic curve),
classify a move by how much the mover's win% dropped as a result of it.
Thresholds and the win% formula match Lichess's own analysis board so results
feel familiar: https://github.com/lichess-org/lila/blob/master/ui/ceval
"""

from __future__ import annotations

import math

from app.models.analysis import Classification

MATE_CP = 100_000  # saturates the win% curve well before this magnitude

INACCURACY_THRESHOLD = 10.0
MISTAKE_THRESHOLD = 20.0
BLUNDER_THRESHOLD = 30.0


def score_to_cp(score) -> float:
    """score: a chess.engine Score already relative to the perspective we want
    (i.e. call PovScore.pov(color) before passing it in).

    Delegates mate handling to Score.score(mate_score=...) rather than
    reimplementing the sign logic: negating a losing Mate(0) ("I've just been
    mated") collapses to the special MateGiven singleton ("I've just delivered
    mate"), and both report mate() == 0 - the sign is only recoverable through
    score(), which python-chess already gets right for every case.
    """
    return float(score.score(mate_score=MATE_CP))


def cp_win_percent(cp: float) -> float:
    return 50 + 50 * (2 / (1 + math.exp(-0.00368208 * cp)) - 1)


def classify_swing(before_cp: float, after_cp: float) -> Classification:
    """before_cp/after_cp must both be from the mover's own perspective."""
    drop = cp_win_percent(before_cp) - cp_win_percent(after_cp)
    if drop >= BLUNDER_THRESHOLD:
        return Classification.BLUNDER
    if drop >= MISTAKE_THRESHOLD:
        return Classification.MISTAKE
    if drop >= INACCURACY_THRESHOLD:
        return Classification.INACCURACY
    return Classification.OK
