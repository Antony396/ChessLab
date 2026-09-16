import { useEffect, useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import { FLAT_2D_BOARD_COLORS, buildPiecesWithEvolutions } from "../../pieces/flat2dPieces";
import { computeLegalDestinations, isArcherShootMove } from "../legalMoves";
import { playCaptureSound, playMoveSound } from "../sound";
import { fetchTodaysPuzzle, postDailyPuzzleMove } from "./api";
import "./dailyPuzzle.css";

const DOT_STYLE = { backgroundImage: "radial-gradient(circle, rgba(20,20,20,0.35) 19%, transparent 20%)" };
const RING_STYLE = { boxShadow: "inset 0 0 0 4px rgba(20,20,20,0.35)" };
const SHOOT_RING_STYLE = { boxShadow: "inset 0 0 0 4px rgba(200,60,30,0.6)" };
const CORRECT_FLASH_MS = 260;
const WRONG_FLASH_MS = 320;

// A new, hand-authored puzzle every day - unlike the Puzzle Map's static
// route of plain-chess puzzles, this one features the hero pieces and is
// the same position for everyone (see backend's daily_puzzle_routes.py).
// Solving it extends a daily streak; streak-gated skins check that streak
// (see skinStore.js's requiresStreak / SkinsPanel.jsx).
export default function DailyPuzzle({ token, onExit }) {
  const [phase, setPhase] = useState("loading"); // "loading" | "solving" | "solved" | "already-solved" | "no-puzzle" | "error"
  const [data, setData] = useState(null); // the /today response
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null); // "correct" | "wrong" | null
  const [selectedSquare, setSelectedSquare] = useState(null);
  const [legalDestinations, setLegalDestinations] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchTodaysPuzzle(token)
      .then((result) => {
        setData(result);
        setPhase(result.already_solved_today ? "already-solved" : "solving");
      })
      .catch((e) => {
        if (e.message?.toLowerCase().includes("no puzzle")) {
          setPhase("no-puzzle");
        } else {
          setError(e.message);
          setPhase("error");
        }
      });
  }, [token]);

  const game = data?.game;
  const mySide = data?.my_side || "white";
  const myPrefix = mySide === "white" ? "w" : "b";

  const archerSquare = myPrefix === "w" ? game?.white_archer_square : game?.black_archer_square;
  const popeSquare = myPrefix === "w" ? game?.white_pope_square : game?.black_pope_square;
  const dragonSquares = (myPrefix === "w" ? game?.white_dragon_squares : game?.black_dragon_squares) || [];
  const hydraSquares = (myPrefix === "w" ? game?.white_hydra_squares : game?.black_hydra_squares) || [];
  const cyclopsSquares = (myPrefix === "w" ? game?.white_cyclops_squares : game?.black_cyclops_squares) || [];
  const mirrorSquares = (myPrefix === "w" ? game?.white_mirror_squares : game?.black_mirror_squares) || [];
  const opponentLastType = myPrefix === "w" ? game?.black_last_moved_type : game?.white_last_moved_type;
  const mirrorMimicType = opponentLastType ? opponentLastType.toLowerCase() : null;
  const mirrorMimicIsHydra = myPrefix === "w" ? game?.black_last_moved_was_hydra : game?.white_last_moved_was_hydra;
  const mirrorMimicIsArcher = myPrefix === "w" ? game?.black_last_moved_was_archer : game?.white_last_moved_was_archer;
  const mirrorMimicIsPope = myPrefix === "w" ? game?.black_last_moved_was_pope : game?.white_last_moved_was_pope;

  const pieces = useMemo(() => {
    if (!game) return undefined;
    return buildPiecesWithEvolutions({
      whiteDragonSquares: game.white_dragon_squares,
      blackDragonSquares: game.black_dragon_squares,
      whitePopeSquare: game.white_pope_square,
      blackPopeSquare: game.black_pope_square,
      whiteArcherSquare: game.white_archer_square,
      blackArcherSquare: game.black_archer_square,
      whiteHydraSquares: game.white_hydra_squares,
      blackHydraSquares: game.black_hydra_squares,
      whiteCyclopsSquares: game.white_cyclops_squares,
      blackCyclopsSquares: game.black_cyclops_squares,
      whiteMirrorSquares: game.white_mirror_squares,
      blackMirrorSquares: game.black_mirror_squares,
    });
  }, [game]);

  function showLegalDestinationsFor(square) {
    setLegalDestinations(
      computeLegalDestinations({
        fen: game.fen,
        square,
        isDragonSquare: dragonSquares.includes(square),
        isPopeSquare: square === popeSquare,
        isArcherSquare: square === archerSquare,
        isHydraSquare: hydraSquares.includes(square),
        isCyclopsSquare: cyclopsSquares.includes(square),
        isMirrorSquare: mirrorSquares.includes(square),
        mirrorMimicType,
        mirrorMimicIsHydra,
        mirrorMimicIsArcher,
        mirrorMimicIsPope,
        ownPopeSquare: popeSquare,
      })
    );
  }

  function handlePieceDrag({ isSparePiece, square, piece }) {
    if (isSparePiece || !square || phase !== "solving") return;
    if (piece.pieceType[0] !== myPrefix) return;
    setSelectedSquare(square);
    showLegalDestinationsFor(square);
  }

  function handleSquareClick({ piece, square }) {
    if (phase !== "solving") return;
    if (selectedSquare === square || !piece || piece.pieceType[0] !== myPrefix) {
      setSelectedSquare(null);
      setLegalDestinations([]);
      return;
    }
    setSelectedSquare(square);
    showLegalDestinationsFor(square);
  }

  function handlePieceDrop({ sourceSquare, targetSquare, piece }) {
    setLegalDestinations([]);
    setSelectedSquare(null);
    if (!targetSquare || busy || phase !== "solving") return false;
    if (piece.pieceType[0] !== myPrefix) return false;

    const isMirrorArcherMove = mirrorSquares.includes(sourceSquare) && mirrorMimicType === "n" && mirrorMimicIsArcher;
    const shoot =
      (sourceSquare === archerSquare || isMirrorArcherMove) && isArcherShootMove(game.fen, sourceSquare, targetSquare);

    setBusy(true);
    postDailyPuzzleMove(token, { from_square: sourceSquare, to_square: targetSquare, shoot })
      .then((result) => {
        setData((prev) => ({ ...prev, game: result.game, current_streak: result.current_streak, longest_streak: result.longest_streak }));
        if (result.correct) {
          playMoveSound();
          setFlash("correct");
          window.setTimeout(() => setFlash(null), CORRECT_FLASH_MS);
          if (result.puzzle_solved) {
            playCaptureSound();
            setPhase("solved");
          }
        } else {
          setFlash("wrong");
          window.setTimeout(() => setFlash(null), WRONG_FLASH_MS);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));

    // The server is the source of truth for hero-special moves the same
    // way OnlineGamePlay's optimistic-update path is - here there's no
    // optimistic guess at all (a wrong guess must never visually move
    // anything), so this always returns false and waits for the response.
    return false;
  }

  if (phase === "loading") {
    return (
      <div className="daily-puzzle">
        <p>Loading today's puzzle…</p>
        <button type="button" className="daily-puzzle-back-btn" onClick={onExit}>
          Back to Dorm
        </button>
      </div>
    );
  }

  if (phase === "no-puzzle") {
    return (
      <div className="daily-puzzle">
        <div className="daily-puzzle-menu">
          <h1>Daily Puzzle</h1>
          <p>No puzzle has been posted for today yet - check back soon.</p>
          <button type="button" className="daily-puzzle-back-btn" onClick={onExit}>
            Back to Dorm
          </button>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="daily-puzzle">
        <div className="daily-puzzle-menu">
          <h1>Daily Puzzle</h1>
          {error && <div className="error-banner">{error}</div>}
          <button type="button" className="daily-puzzle-back-btn" onClick={onExit}>
            Back to Dorm
          </button>
        </div>
      </div>
    );
  }

  if (phase === "already-solved" || phase === "solved") {
    return (
      <div className="daily-puzzle">
        <div className="daily-puzzle-menu">
          <h1>{phase === "solved" ? "Solved!" : "Already Solved Today"}</h1>
          <p className="daily-puzzle-streak">{data.current_streak}</p>
          <p>day streak{data.current_streak === 1 ? "" : "s"} in a row</p>
          {data.longest_streak > data.current_streak && <p className="daily-puzzle-longest">Best: {data.longest_streak}</p>}
          <p>Come back tomorrow for a new one.</p>
          <button type="button" className="daily-puzzle-back-btn" onClick={onExit}>
            Back to Dorm
          </button>
        </div>
      </div>
    );
  }

  const squareStyles = {};
  for (const { square, capture, shoot: isShoot } of legalDestinations) {
    squareStyles[square] = isShoot ? SHOOT_RING_STYLE : capture ? RING_STYLE : DOT_STYLE;
  }

  const options = {
    position: game.fen,
    boardOrientation: mySide,
    allowDragging: !busy,
    showAnimations: false,
    onPieceDrop: handlePieceDrop,
    onPieceDrag: handlePieceDrag,
    onSquareClick: handleSquareClick,
    squareStyles,
    boardStyle: { borderRadius: "4px" },
    lightSquareStyle: { background: FLAT_2D_BOARD_COLORS.light },
    darkSquareStyle: { background: FLAT_2D_BOARD_COLORS.dark },
    pieces,
  };

  return (
    <div className="daily-puzzle">
      <div className="daily-puzzle-toolbar">
        <span className="daily-puzzle-date">{data.puzzle_date}</span>
        <span className="daily-puzzle-streak-badge">🔥 {data.current_streak}</span>
        <button type="button" onClick={onExit}>
          Quit
        </button>
      </div>
      <div className={`daily-puzzle-board-wrap${flash ? ` flash-${flash}` : ""}`}>
        <Chessboard options={options} />
      </div>
      {error && <div className="error-banner">{error}</div>}
    </div>
  );
}
