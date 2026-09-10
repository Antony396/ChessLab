from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app import db
from app.analyzer.stockfish_analyzer import StockfishAnalyzer
from app.config import STOCKFISH_DEPTH
from app.errors import UserNotFoundError
from app.models.analysis import GameAnalysis
from app.models.game import Game, Platform
from app.providers.chesscom import ChessComProvider
from app.providers.lichess import LichessProvider

router = APIRouter()

PROVIDERS = {
    "chesscom": ChessComProvider(),
    "lichess": LichessProvider(),
}


@router.get("/games", response_model=list[Game])
def get_games(platform: Platform, username: str, count: int = Query(10, ge=1, le=50)):
    provider = PROVIDERS[platform]
    username = username.strip()
    if not username:
        raise HTTPException(400, "username is required")

    try:
        games = provider.get_recent_games(username, count)
    except UserNotFoundError:
        raise HTTPException(404, f"No {platform} user found with username '{username}'")
    except Exception as exc:  # provider/network failure
        raise HTTPException(502, f"Failed to fetch games from {platform}: {exc}")

    if not games:
        raise HTTPException(
            404,
            f"No games found for '{username}' on {platform} "
            "(profile may be private, empty, or the username may be wrong)",
        )

    for game in games:
        db.save_game(game, queried_username=username)
    return games


@router.get("/games/{game_id}", response_model=Game)
def get_game(game_id: str):
    game = db.get_game(game_id)
    if game is None:
        raise HTTPException(404, "Game not found in local cache. Fetch it via /api/games first.")
    return game


@router.get("/games/{game_id}/analysis", response_model=GameAnalysis)
def get_analysis(game_id: str, depth: int = Query(STOCKFISH_DEPTH, ge=6, le=24)):
    game = db.get_game(game_id)
    if game is None:
        raise HTTPException(404, "Game not found in local cache. Fetch it via /api/games first.")

    cached = db.get_cached_analysis(game_id, depth)
    if cached is not None:
        return cached

    searched_username = game.white.username if game.played_color == "white" else game.black.username
    try:
        analysis = StockfishAnalyzer(depth=depth).analyze_game(game, searched_username)
    except Exception as exc:
        raise HTTPException(500, f"Analysis failed: {exc}")

    db.save_analysis(game_id, depth, analysis)
    return analysis
