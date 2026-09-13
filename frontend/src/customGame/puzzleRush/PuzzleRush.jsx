import { useEffect, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { flat2dPieces, FLAT_2D_BOARD_COLORS } from "../../pieces/flat2dPieces";
import { playCaptureSound, playMoveSound } from "../sound";
import { postRushMove, postStartRush } from "./api";
import "./puzzleRush.css";

const CORRECT_FLASH_MS = 260;
const WRONG_FLASH_MS = 320;

// Standard chess only (see puzzle_rush/store.py's docstring for why) - a
// fixed-timer format: as many puzzles as you can solve before time runs
// out, with a wrong guess costing time rather than ending the run. The
// server is the sole judge of "correct"; this never sees the solution.
export default function PuzzleRush({ token, onExit }) {
  const [phase, setPhase] = useState("menu"); // "menu" | "playing" | "over"
  const [session, setSession] = useState(null); // {sessionId, fen, score}
  const [timeLeft, setTimeLeft] = useState(0);
  const [flash, setFlash] = useState(null); // "correct" | "wrong" | null
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const tickRef = useRef(null);

  useEffect(() => {
    if (phase !== "playing") return undefined;
    tickRef.current = window.setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          window.clearInterval(tickRef.current);
          setPhase("over");
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(tickRef.current);
  }, [phase]);

  async function handleStart(durationSeconds) {
    setError(null);
    try {
      const result = await postStartRush(token, durationSeconds);
      setSession({ sessionId: result.session_id, fen: result.fen, score: result.score });
      setTimeLeft(Math.ceil(result.time_remaining));
      setPhase("playing");
    } catch (e) {
      setError(e.message);
    }
  }

  function handlePieceDrop({ sourceSquare, targetSquare }) {
    if (!targetSquare || busy || phase !== "playing") return false;
    setBusy(true);
    postRushMove(token, {
      session_id: session.sessionId,
      from_square: sourceSquare,
      to_square: targetSquare,
      promotion: "q",
    })
      .then((result) => {
        setSession((prev) => ({ ...prev, fen: result.fen, score: result.score }));
        setTimeLeft(Math.ceil(result.time_remaining));
        if (result.correct) {
          playMoveSound();
          if (result.puzzle_solved) playCaptureSound();
          setFlash("correct");
          window.setTimeout(() => setFlash(null), CORRECT_FLASH_MS);
        } else {
          setFlash("wrong");
          window.setTimeout(() => setFlash(null), WRONG_FLASH_MS);
        }
        if (result.game_over) setPhase("over");
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
    return false; // the server (via `fen` above) is what actually moves the piece
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  if (phase === "menu") {
    return (
      <div className="puzzle-rush">
        <div className="puzzle-rush-menu">
          <h1>Puzzle Rush</h1>
          <p>Solve as many puzzles as you can before time runs out. A wrong move costs time, not the run.</p>
          {error && <div className="error-banner">{error}</div>}
          <div className="puzzle-rush-menu-buttons">
            <button type="button" onClick={() => handleStart(180)}>
              3 Minutes
            </button>
            <button type="button" onClick={() => handleStart(300)}>
              5 Minutes
            </button>
          </div>
          <button type="button" className="puzzle-rush-back-btn" onClick={onExit}>
            Back to Dorm
          </button>
        </div>
      </div>
    );
  }

  if (phase === "over") {
    return (
      <div className="puzzle-rush">
        <div className="puzzle-rush-menu">
          <h1>Time's Up!</h1>
          <p className="puzzle-rush-final-score">{session.score}</p>
          <p>puzzles solved</p>
          {error && <div className="error-banner">{error}</div>}
          <div className="puzzle-rush-menu-buttons">
            <button type="button" onClick={() => setPhase("menu")}>
              Play Again
            </button>
          </div>
          <button type="button" className="puzzle-rush-back-btn" onClick={onExit}>
            Back to Dorm
          </button>
        </div>
      </div>
    );
  }

  const options = {
    position: session.fen,
    allowDragging: !busy,
    showAnimations: false,
    onPieceDrop: handlePieceDrop,
    boardStyle: { borderRadius: "4px" },
    lightSquareStyle: { background: FLAT_2D_BOARD_COLORS.light },
    darkSquareStyle: { background: FLAT_2D_BOARD_COLORS.dark },
    pieces: flat2dPieces,
  };

  return (
    <div className="puzzle-rush">
      <div className="puzzle-rush-toolbar">
        <span className={`puzzle-rush-timer${timeLeft <= 30 ? " low" : ""}`}>{formatTime(timeLeft)}</span>
        <span className="puzzle-rush-score">Score: {session.score}</span>
        <button type="button" onClick={onExit}>
          Quit
        </button>
      </div>
      <div className={`puzzle-rush-board-wrap${flash ? ` flash-${flash}` : ""}`}>
        <Chessboard options={options} />
      </div>
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
