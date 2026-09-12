import { useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import { postAiMove, postCustomMove } from "./api";
import { FLAT_2D_BOARD_COLORS, buildPiecesWithEvolutions } from "../pieces/flat2dPieces";
import { computeLegalDestinations, tryOptimisticFen } from "./legalMoves";
import { KING_SKINS, useEquippedSkin } from "./skinStore";

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
  // The human is always White here (vs-AI), so the equipped skin only ever
  // needs to replace White's King art.
  const equippedSkin = useEquippedSkin();
  const whiteKingSkinSrc = KING_SKINS[equippedSkin].whiteTeamSrc;
  const [shootArmed, setShootArmed] = useState(false);
  const [moving, setMoving] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [error, setError] = useState(null);
  const [legalDestinations, setLegalDestinations] = useState([]);
  const [selectedSquare, setSelectedSquare] = useState(null);

  const isOver = gameState.status !== "in_progress";
  const whiteArcherSquares = gameState.white_archer_squares || [];
  const whiteWizardSquares = gameState.white_wizard_squares || [];
  const whiteHydraSquares = gameState.white_hydra_squares || [];
  const whiteCyclopsSquares = gameState.white_cyclops_squares || [];
  const whiteMirrorSquares = gameState.white_mirror_squares || [];
  const hasArchers = whiteArcherSquares.length > 0;
  // White's Mirror mimics whatever BLACK (its opponent) last moved.
  const mirrorMimicType = gameState.black_last_moved_type ? gameState.black_last_moved_type.toLowerCase() : null;

  function showLegalDestinationsFor(square) {
    const isArcherSquare = whiteArcherSquares.includes(square);
    setLegalDestinations(
      computeLegalDestinations({
        fen: gameState.fen,
        square,
        isDragonSquare: square === gameState.white_dragon_square,
        isWizardSquare: whiteWizardSquares.includes(square),
        isArcherSquare,
        isHydraSquare: whiteHydraSquares.includes(square),
        isCyclopsSquare: whiteCyclopsSquares.includes(square),
        isMirrorSquare: whiteMirrorSquares.includes(square),
        mirrorMimicType,
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

  function handlePieceDrop({ sourceSquare, targetSquare, piece }) {
    setLegalDestinations([]);
    setSelectedSquare(null);
    if (!targetSquare || moving || isOver) return false;
    if (piece.pieceType[0] !== "w") return false; // the computer plays black

    const shoot = shootArmed && whiteArcherSquares.includes(sourceSquare);

    // Show the player's own move immediately rather than waiting on the
    // round trip - see tryOptimisticFen's own comment for exactly which
    // moves this covers. The real response (below) overwrites this guess
    // moments later regardless; if the server rejects the move outright,
    // the .catch() rolls the board back to how it looked before.
    //
    // Deliberately not awaited before returning - react-chessboard appears
    // to hold the drag/drop visual open until this function's return value
    // is known, so awaiting the network round trip here would recreate the
    // exact lag this is meant to fix. Everything below runs in the
    // background instead.
    const previousGameState = gameState;
    let appliedOptimistic = false;
    if (!shoot) {
      const optimisticFen = tryOptimisticFen(gameState.fen, sourceSquare, targetSquare);
      if (optimisticFen) {
        appliedOptimistic = true;
        setGameState((prev) => ({ ...prev, fen: optimisticFen }));
      }
    }

    setMoving(true);
    setError(null);
    postCustomMove({
      game_id: gameState.id,
      from_square: sourceSquare,
      to_square: targetSquare,
      shoot,
    })
      .then((afterPlayerMove) => {
        setGameState(afterPlayerMove);
        setShootArmed(false);
        if (afterPlayerMove.vs_ai && afterPlayerMove.status === "in_progress" && afterPlayerMove.turn === "black") {
          setAiThinking(true);
          return postAiMove(afterPlayerMove.id).then((afterAiMove) => setGameState(afterAiMove));
        }
      })
      .catch((e) => {
        setError(e.message);
        if (appliedOptimistic) setGameState(previousGameState);
      })
      .finally(() => {
        setMoving(false);
        setAiThinking(false);
      });

    // A shoot never relocates the archer, so react-chessboard must not
    // "complete" the drag by moving the dragged piece to targetSquare -
    // returning false snaps it back to sourceSquare while gameState (once
    // the shot's real effect comes back above) re-renders the board.
    return appliedOptimistic && !shoot;
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
        whiteHydraSquares: gameState.white_hydra_squares,
        blackHydraSquares: gameState.black_hydra_squares,
        whiteCyclopsSquares: gameState.white_cyclops_squares,
        blackCyclopsSquares: gameState.black_cyclops_squares,
        whiteMirrorSquares: gameState.white_mirror_squares,
        blackMirrorSquares: gameState.black_mirror_squares,
        whiteKingSkinSrc,
      }),
    [
      gameState.white_dragon_square,
      gameState.black_dragon_square,
      gameState.white_wizard_squares,
      gameState.black_wizard_squares,
      gameState.white_archer_squares,
      gameState.black_archer_squares,
      gameState.white_hydra_squares,
      gameState.black_hydra_squares,
      gameState.white_cyclops_squares,
      gameState.black_cyclops_squares,
      gameState.white_mirror_squares,
      gameState.black_mirror_squares,
      whiteKingSkinSrc,
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
    boardStyle: { borderRadius: "4px" },
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
          <strong>Your Hydras:</strong> {whiteHydraSquares.length > 0 ? whiteHydraSquares.join(", ") : "none in play"}
        </div>
        <div>
          <strong>Your Cyclopses:</strong>{" "}
          {whiteCyclopsSquares.length > 0 ? whiteCyclopsSquares.join(", ") : "none in play"}
        </div>
        <div>
          <strong>Your Mirrors:</strong> {whiteMirrorSquares.length > 0 ? whiteMirrorSquares.join(", ") : "none in play"}
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
