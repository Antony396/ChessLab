import { useMemo, useState } from "react";
import { Chess } from "chess.js";
import SearchForm from "./components/SearchForm";
import GameList from "./components/GameList";
import BoardViewer from "./components/BoardViewer";
import EvalGraph from "./components/EvalGraph";
import MistakeList from "./components/MistakeList";
import BestMovePanel from "./components/BestMovePanel";
import { fetchGameAnalysis, fetchGames } from "./api";
import { loadStoredTheme, storeTheme } from "./theme";
import { formatEval } from "./utils/evalFormat";
import { computePvArrows } from "./utils/pv";
import HeroChessApp from "./customGame/HeroChessApp";
import HomePage from "./HomePage";
import "./App.css";

function buildPositions(analysis) {
  const chess = new Chess();
  const positions = [chess.fen()];
  for (const m of analysis.moves) {
    chess.move({
      from: m.move_played_uci.slice(0, 2),
      to: m.move_played_uci.slice(2, 4),
      promotion: m.move_played_uci.slice(4) || undefined,
    });
    positions.push(chess.fen());
  }
  return positions;
}

function MoveDetail({ analysis, currentPly }) {
  if (currentPly === 0) return <p className="move-detail">Start position</p>;
  const m = analysis.moves[currentPly - 1];
  return (
    <div className={`move-detail move-detail-${m.classification.toLowerCase()}`}>
      <strong>
        Move {m.move_number} ({m.side}):
      </strong>{" "}
      {m.move_played_san}
      {m.classification !== "OK" && (
        <span>
          {" "}
          — {m.classification}. Best was {m.best_move_san} ({m.best_line_san.join(" ")})
        </span>
      )}
      <span className="move-eval">
        {" "}
        eval: {formatEval(m.eval_before)} → {formatEval(m.eval_after)}
      </span>
    </div>
  );
}

function SubNav({ title, onHome }) {
  return (
    <div className="sub-nav">
      <button type="button" className="home-link" onClick={onHome}>
        ← Home
      </button>
      <span className="sub-nav-title">{title}</span>
    </div>
  );
}

export default function App() {
  const [games, setGames] = useState([]);
  const [selectedGame, setSelectedGame] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [currentPly, setCurrentPly] = useState(0);
  const [loadingGames, setLoadingGames] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [error, setError] = useState(null);
  const [themeKey, setThemeKey] = useState(loadStoredTheme);
  const [showPath, setShowPath] = useState(false);
  // A shared multiplayer link (?join=<gameId>) must land straight in Hero
  // Chess, not the home screen, regardless of how someone opened it.
  const [joinGameId] = useState(() => new URLSearchParams(window.location.search).get("join"));
  const [view, setView] = useState(() => (joinGameId ? "hero-chess" : "home")); // "home" | "analyzer" | "hero-chess"

  function handleThemeChange(key) {
    setThemeKey(key);
    storeTheme(key);
  }

  async function handleSearch({ platform, username, count }) {
    setLoadingGames(true);
    setError(null);
    setGames([]);
    setSelectedGame(null);
    setAnalysis(null);
    try {
      const fetched = await fetchGames(platform, username, count);
      setGames(fetched);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingGames(false);
    }
  }

  async function handleSelectGame(game) {
    setSelectedGame(game);
    setAnalysis(null);
    setCurrentPly(0);
    setShowPath(false);
    setLoadingAnalysis(true);
    setError(null);
    try {
      const result = await fetchGameAnalysis(game.id);
      setAnalysis(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingAnalysis(false);
    }
  }

  const positions = useMemo(() => (analysis ? buildPositions(analysis) : null), [analysis]);

  // The position "at" currentPly is the one about to have moves[currentPly]
  // played from it (moves[i].fen_before === positions[i]); at the final ply
  // there's no next move, so fall back to the last move's resulting eval.
  const currentEval = analysis
    ? currentPly < analysis.moves.length
      ? analysis.moves[currentPly].eval_before
      : analysis.moves[analysis.moves.length - 1]?.eval_after ?? 0
    : 0;
  const currentMove = analysis && currentPly < analysis.moves.length ? analysis.moves[currentPly] : null;
  const currentBestMoveUci = currentMove?.best_move_uci ?? null;
  const pathArrows =
    showPath && currentMove ? computePvArrows(currentMove.fen_before, currentMove.best_line_san) : [];

  if (view === "home") {
    return <HomePage onSelect={setView} />;
  }

  if (view === "hero-chess") {
    return (
      <div className="app">
        <SubNav title="Hero Chess" onHome={() => setView("home")} />
        <HeroChessApp joinGameId={joinGameId} />
      </div>
    );
  }

  return (
    <div className="app">
      <SubNav title="Game Analyzer" onHome={() => setView("home")} />

      <SearchForm onSearch={handleSearch} loading={loadingGames} />

      {error && <div className="error-banner">{error}</div>}

      <div className="main-layout">
        <div className="sidebar">
          {loadingGames && <p className="hint">Fetching games…</p>}
          <GameList games={games} selectedGameId={selectedGame?.id} onSelect={handleSelectGame} />
        </div>

        <div className="content">
          {loadingAnalysis && <p className="hint">Analysing with Stockfish… this can take a little while.</p>}
          {analysis && positions && (
            <>
              <BoardViewer
                positions={positions}
                currentPly={currentPly}
                setCurrentPly={setCurrentPly}
                orientation={selectedGame.played_color}
                evalCp={currentEval}
                bestMoveUci={currentBestMoveUci}
                pathArrows={pathArrows}
                themeKey={themeKey}
                onThemeChange={handleThemeChange}
              />
              <BestMovePanel
                analysis={analysis}
                currentPly={currentPly}
                showPath={showPath}
                onTogglePath={() => setShowPath((v) => !v)}
              />
              <MoveDetail analysis={analysis} currentPly={currentPly} />
              <EvalGraph analysis={analysis} currentPly={currentPly} setCurrentPly={setCurrentPly} />
              <h2>Mistakes</h2>
              <MistakeList analysis={analysis} currentPly={currentPly} setCurrentPly={setCurrentPly} />
            </>
          )}
          {!analysis && !loadingAnalysis && games.length > 0 && (
            <p className="hint">Pick a game on the left to analyse it.</p>
          )}
        </div>
      </div>
    </div>
  );
}
