import { useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import { postAiMove, postCustomMove } from "./api";
import { FLAT_2D_BOARD_COLORS, buildPiecesWithEvolutions } from "../pieces/flat2dPieces";
import { computeLegalDestinations } from "./legalMoves";

const DOT_STYLE = { backgroundImage: "radial-gradient(circle, rgba(20,20,20,0.35) 19%, transparent 20%)" };
const RING_STYLE = { boxShadow: "inset 0 0 0 4px rgba(20,20,20,0.35)" };
const SHOOT_RING_STYLE = { boxShadow: "inset 0 0 0 4px rgba(200,60,30,0.6)" };

const STATUS_LABEL = {
  in_progress: "In progress",
  checkmate: "Checkmate",
  stalemate: "Stalemate",
  draw: "Draw",
};

function canDragWhiteOnly({ piece }) {
  return piece.pieceType[0] === "w";
}

export default function CustomGamePlay({ initialGame, onExit }) {
  const [gameState, setGameState] = useState(initialGame);
  const [shootArmed, setShootArmed] = useState(false);
  const [moving, setMoving] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [error, setError] = useState(null);
  const [legalDestinations, setLegalDestinations] = useState([]);
  const [selectedSquare, setSelectedSquare] = useState(null);

  const isOver = gameState.status !== "in_progress";
  const whiteArcherSquares = gameState.white_archer_squares || [];
  const whiteWizardSquares = gameState.white_wizard_squares || [];
  const hasArchers = whiteArcherSquares.length > 0;

  function showLegalDestinationsFor(square) {
    const isArcherSquare = whiteArcherSquares.includes(square);
    setLegalDestinations(
      computeLegalDestinations({
        fen: gameState.fen,
        square,
        isDragonSquare: square === gameState.white_dragon_square,
        isWizardSquare: whiteWizardSquares.includes(square),
        isArcherSquare,
        shootArmed: shootArmed && isArcherSquare,
      })
    );
  }

  function handlePieceDrag({ isSparePiece, square }) {
    if (isSparePiece || !square) return;
    setSelectedSquare(square);
    showLegalDestinationsFor(square);
  }

  // Clicking a piece (without necessarily dragging it) previews its legal
  // destinations the same way starting a drag does - clicking the same
  // piece again, or an empty/enemy square, clears the preview.
  function handleSquareClick({ piece, square }) {
    if (moving || isOver) return;
    if (selectedSquare === square || !piece || piece.pieceType[0] !== "w") {
      setSelectedSquare(null);
      setLegalDestinations([]);
      return;
    }
    setSelectedSquare(square);
    showLegalDestinationsFor(square);
  }

  async function handlePieceDrop({ sourceSquare, targetSquare, piece }) {
    setLegalDestinations([]);
    setSelectedSquare(null);
    if (!targetSquare || moving || isOver) return false;
    if (piece.pieceType[0] !== "w") return false; // the computer plays black

    const shoot = shootArmed && whiteArcherSquares.includes(sourceSquare);

    setMoving(true);
    setError(null);
    try {
      // Resolve and render the player's own move first, so it never waits
      // on the computer's think time to appear on the board.
      const afterPlayerMove = await postCustomMove({
        game_id: gameState.id,
        from_square: sourceSquare,
        to_square: targetSquare,
        shoot,
      });
      setGameState(afterPlayerMove);
      setShootArmed(false);

      if (afterPlayerMove.vs_ai && afterPlayerMove.status === "in_progress" && afterPlayerMove.turn === "black") {
        setAiThinking(true);
        const afterAiMove = await postAiMove(afterPlayerMove.id);
        setGameState(afterAiMove);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setMoving(false);
      setAiThinking(false);
    }

    // A shoot never relocates the archer, so react-chessboard must not
    // "complete" the drag by moving the dragged piece to targetSquare -
    // returning false snaps it back to sourceSquare while gameState (already
    // updated above with the shot's real effect) re-renders the board.
    return !shoot;
  }

  const pieces = useMemo(
    () =>
      buildPiecesWithEvolutions({
        whiteDragonSquare: gameState.white_dragon_square,
        blackDragonSquare: gameState.black_dragon_square,
        whiteWizardSquares: gameState.white_wizard_squares,
        blackWizardSquares: gameState.black_wizard_squares,
        whiteArcherSquares: gameState.white_archer_squares,
        blackArcherSquares: gameState.black_archer_squares,
      }),
    [
      gameState.white_dragon_square,
      gameState.black_dragon_square,
      gameState.white_wizard_squares,
      gameState.black_wizard_squares,
      gameState.white_archer_squares,
      gameState.black_archer_squares,
    ]
  );

  const squareStyles = useMemo(() => {
    const styles = {};
    for (const { square, capture, shoot } of legalDestinations) {
      styles[square] = shoot ? SHOOT_RING_STYLE : capture ? RING_STYLE : DOT_STYLE;
    }
    return styles;
  }, [legalDestinations]);

  const options = {
    position: gameState.fen,
    boardOrientation: "white",
    allowDragging: !moving && !isOver,
    canDragPiece: canDragWhiteOnly,
    showAnimations: false,
    onPieceDrag: handlePieceDrag,
    onPieceDragCancel: () => {
      setLegalDestinations([]);
      setSelectedSquare(null);
    },
    onPieceDrop: handlePieceDrop,
    onSquareClick: handleSquareClick,
    boardStyle: { borderRadius: "10px", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" },
    lightSquareStyle: { background: FLAT_2D_BOARD_COLORS.light },
    darkSquareStyle: { background: FLAT_2D_BOARD_COLORS.dark },
    squareStyles,
    pieces,
  };

  return (
    <div className="custom-play">
      <div className="custom-play-toolbar">
        <span className="custom-play-turn">
          {isOver ? STATUS_LABEL[gameState.status] : aiThinking ? "Computer is thinking…" : "Your move"}
        </span>
        <button type="button" onClick={onExit}>
          New Game
        </button>
      </div>

      <div className="board-wrap custom-play-board">
        <Chessboard options={options} />
      </div>

      <div className="shoot-toggle-row">
        <button
          type="button"
          className={`shoot-toggle-btn${shootArmed ? " active" : ""}`}
          disabled={!hasArchers || isOver || moving}
          onClick={() => setShootArmed((v) => !v)}
        >
          {shootArmed ? "Shoot armed — drag your Archer to its target" : "Aim Archer Shot"}
        </button>
        {!hasArchers && <span className="shoot-toggle-hint">No Archer in your deck</span>}
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="custom-play-status">
        <div>
          <strong>Your Dragon:</strong>{" "}
          {gameState.white_dragon_square ? `at ${gameState.white_dragon_square}` : "none evolved / destroyed"}
        </div>
        <div>
          <strong>Your Wizards:</strong>{" "}
          {whiteWizardSquares.length > 0 ? whiteWizardSquares.join(", ") : "none evolved / destroyed"}
        </div>
        <div>
          <strong>Your Archers:</strong>{" "}
          {whiteArcherSquares.length > 0 ? whiteArcherSquares.join(", ") : "none in play"}
        </div>
        <div>
          <strong>Opponent:</strong> Computer (~1000)
        </div>
      </div>

      <h2>Action Log</h2>
      {gameState.action_log.length === 0 ? (
        <p className="hint">No moves yet.</p>
      ) : (
        <ol className="action-log">
          {gameState.action_log.map((entry, i) => (
            <li key={i}>{entry}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
