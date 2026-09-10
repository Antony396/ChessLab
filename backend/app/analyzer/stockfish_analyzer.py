from __future__ import annotations

import io
from datetime import datetime, timezone

import chess
import chess.engine
import chess.pgn

from app.analyzer.base import Analyzer
from app.analyzer.classification import classify_swing, score_to_cp
from app.config import BEST_LINE_LENGTH, STOCKFISH_DEPTH, STOCKFISH_PATH, STOCKFISH_THREADS
from app.models.analysis import Classification, GameAnalysis, MoveAnalysis
from app.models.game import Game


class StockfishAnalyzer(Analyzer):
    """Runs native Stockfish over UCI via python-chess.

    All engine interaction lives here — nothing outside this class knows or
    cares that Stockfish is a local process. Swapping to WASM Stockfish for a
    hosted/mobile build later means writing a new Analyzer, not touching
    providers, the API, or the frontend.
    """

    def __init__(
        self,
        engine_path: str = STOCKFISH_PATH,
        depth: int = STOCKFISH_DEPTH,
        threads: int = STOCKFISH_THREADS,
    ):
        self.engine_path = engine_path
        self.depth = depth
        self.threads = threads

    def analyze_game(self, game: Game, searched_username: str) -> GameAnalysis:
        pgn_game = chess.pgn.read_game(io.StringIO(game.pgn))
        if pgn_game is None:
            raise ValueError("Could not parse PGN for game")

        pov = chess.WHITE if game.played_color == "white" else chess.BLACK
        limit = chess.engine.Limit(depth=self.depth)

        moves_out: list[MoveAnalysis] = []
        with chess.engine.SimpleEngine.popen_uci(self.engine_path) as engine:
            engine.configure({"Threads": self.threads})

            board = pgn_game.board()
            info = engine.analyse(board, limit)

            for ply, move in enumerate(pgn_game.mainline_moves(), start=1):
                mover_color = "white" if board.turn == chess.WHITE else "black"
                is_player_move = mover_color == game.played_color

                fen_before = board.fen()
                san_played = board.san(move)
                uci_played = move.uci()

                pv = info.get("pv") or []
                if pv:
                    best_move = pv[0]
                    best_move_san = board.san(best_move)
                    best_line_san = []
                    pv_board = board.copy()
                    for pv_move in pv[:BEST_LINE_LENGTH]:
                        best_line_san.append(pv_board.san(pv_move))
                        pv_board.push(pv_move)
                else:
                    best_move = move
                    best_move_san = san_played
                    best_line_san = [san_played]

                eval_before = score_to_cp(info["score"].pov(pov))

                board.push(move)
                info = engine.analyse(board, limit)
                eval_after = score_to_cp(info["score"].pov(pov))

                classification = (
                    classify_swing(eval_before, eval_after)
                    if is_player_move
                    else Classification.OK
                )

                moves_out.append(
                    MoveAnalysis(
                        ply=ply,
                        move_number=(ply + 1) // 2,
                        side=mover_color,
                        is_player_move=is_player_move,
                        move_played_san=san_played,
                        move_played_uci=uci_played,
                        eval_before=round(eval_before),
                        eval_after=round(eval_after),
                        eval_swing=round(eval_after - eval_before),
                        best_move_san=best_move_san,
                        best_move_uci=best_move.uci(),
                        best_line_san=best_line_san,
                        classification=classification,
                        fen_before=fen_before,
                    )
                )

        return GameAnalysis(
            game=game,
            searched_username=searched_username,
            depth=self.depth,
            generated_at=datetime.now(timezone.utc).isoformat(),
            moves=moves_out,
        )
