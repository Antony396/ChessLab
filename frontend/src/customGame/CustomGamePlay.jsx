import { useMemo, useState } from "react";
import { Chessboard } from "react-chessboard";
import { postAiMove, postCustomMove } from "./api";
import { FLAT_2D_BOARD_COLORS, buildPiecesWithEvolutions } from "../pieces/flat2dPieces";
import { computeLegalDestinations, isArcherShootMove, relocateHeroTrackingSquares, tryOptimisticFen } from "./legalMoves";
import { KING_SKINS, useEquippedSkin } from "./skinStore";
import { playMoveSound } from "./sound";
import GameStatusBanner from "./GameStatusBanner";
import { useMoveHistory } from "./useMoveHistory";
import { useCapturedRows } from "./CapturedTray";

const DOT_STYLE = { backgroundImage: "radial-gradient(circle, rgba(20,20,20,0.35) 19%, transparent 20%)" };
const RING_STYLE = { boxShadow: "inset 0 0 0 4px rgba(20,20,20,0.35)" };
const SHOOT_RING_STYLE = { boxShadow: "inset 0 0 0 4px rgba(200,60,30,0.6)" };
// chess.com-style highlight for the from/to squares of whatever move is
// currently on screen (live, or a reviewed past one - see useMoveHistory's
// lastMoveSquares). A background color rather than backgroundImage/
// boxShadow like the hint styles above, so it composes underneath one if a
// square happens to be both a highlighted last-move square and a legal-move
// hint at once.
const LAST_MOVE_STYLE = { background: "rgba(255, 214, 51, 0.45)" };

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
  const [moving, setMoving] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [error, setError] = useState(null);
  const [legalDestinations, setLegalDestinations] = useState([]);
  const [selectedSquare, setSelectedSquare] = useState(null);
  const history = useMoveHistory(gameState);
  const capturedRows = useCapturedRows(gameState, "white"); // the human is always White here (vs-AI)

  const isOver = gameState.status !== "in_progress";
  const whiteArcherSquares = gameState.white_archer_squares || [];
  const whiteWizardSquares = gameState.white_wizard_squares || [];
  const whiteHydraSquares = gameState.white_hydra_squares || [];
  const whiteCyclopsSquares = gameState.white_cyclops_squares || [];
  const whiteMirrorSquares = gameState.white_mirror_squares || [];
  // White's Mirror mimics whatever BLACK (its opponent) last moved.
  const mirrorMimicType = gameState.black_last_moved_type ? gameState.black_last_moved_type.toLowerCase() : null;
  const mirrorMimicIsHydra = gameState.black_last_moved_was_hydra;

  // Works for either color, not just White's - a click-to-preview should
  // show what the computer's own pieces could do too. handlePieceDrop/
  // tryOptimisticFen below stay hardcoded to White's own fields, since
  // those are only ever about the human's own move.
  function showLegalDestinationsFor(square, colorPrefix) {
    const isWhite = colorPrefix === "w";
    const dragonSquare = isWhite ? gameState.white_dragon_square : gameState.black_dragon_square;
    const wizardSquares = (isWhite ? gameState.white_wizard_squares : gameState.black_wizard_squares) || [];
    const archerSquares = (isWhite ? whiteArcherSquares : gameState.black_archer_squares) || [];
    const hydraSquares = (isWhite ? whiteHydraSquares : gameState.black_hydra_squares) || [];
    const cyclopsSquares = (isWhite ? whiteCyclopsSquares : gameState.black_cyclops_squares) || [];
    const mirrorSquares = (isWhite ? whiteMirrorSquares : gameState.black_mirror_squares) || [];
    const opponentLastType = isWhite ? gameState.black_last_moved_type : gameState.white_last_moved_type;
    const mimicIsHydra = isWhite ? gameState.black_last_moved_was_hydra : gameState.white_last_moved_was_hydra;
    setLegalDestinations(
      computeLegalDestinations({
        fen: gameState.fen,
        square,
        isDragonSquare: square === dragonSquare,
        isWizardSquare: wizardSquares.includes(square),
        isArcherSquare: archerSquares.includes(square),
        isHydraSquare: hydraSquares.includes(square),
        isCyclopsSquare: cyclopsSquares.includes(square),
        isMirrorSquare: mirrorSquares.includes(square),
        mirrorMimicType: opponentLastType ? opponentLastType.toLowerCase() : null,
        mirrorMimicIsHydra: mimicIsHydra,
      })
    );
  }

  function handlePieceDrag({ isSparePiece, square, piece }) {
    if (isSparePiece || !square || history.isViewingHistory) return;
    setSelectedSquare(square);
    showLegalDestinationsFor(square, piece.pieceType[0]);
  }

  // Previewing works for either side's pieces, and regardless of whether a
  // move is currently in flight - it's a read-only hint, not an action, so
  // it shouldn't be gated the way actually dropping a piece is (see
  // handlePieceDrop's own guard for that). Disabled while reviewing a past
  // position though, since the hint would be computed against the LIVE
  // gameState, not whatever position is actually on screen.
  function handleSquareClick({ piece, square }) {
    if (isOver || history.isViewingHistory) return;
    if (selectedSquare === square || !piece) {
      setSelectedSquare(null);
      setLegalDestinations([]);
      return;
    }
    setSelectedSquare(square);
    showLegalDestinationsFor(square, piece.pieceType[0]);
  }

  function handlePieceDrop({ sourceSquare, targetSquare, piece }) {
    setLegalDestinations([]);
    setSelectedSquare(null);
    if (!targetSquare || moving || isOver || history.isViewingHistory) return false;
    if (piece.pieceType[0] !== "w") return false; // the computer plays black

    // No more "arm the shot" toggle - an Archer drop is a shoot exactly
    // when the target is one of its knight's-move capture squares, and a
    // relocate otherwise (tryOptimisticFen/the server independently reject
    // anything that's neither).
    const shoot = whiteArcherSquares.includes(sourceSquare) && isArcherShootMove(gameState.fen, sourceSquare, targetSquare);

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
    const optimisticFen = tryOptimisticFen(gameState.fen, sourceSquare, targetSquare, {
      isDragonSquare: sourceSquare === gameState.white_dragon_square,
      isWizardSquare: whiteWizardSquares.includes(sourceSquare),
      isArcherSquare: whiteArcherSquares.includes(sourceSquare),
      isHydraSquare: whiteHydraSquares.includes(sourceSquare),
      isCyclopsSquare: whiteCyclopsSquares.includes(sourceSquare),
      isMirrorSquare: whiteMirrorSquares.includes(sourceSquare),
      mirrorMimicType,
      mirrorMimicIsHydra,
      shoot,
    });
    if (optimisticFen) {
      appliedOptimistic = true;
      // A shoot never relocates the Archer itself - only the FEN (already
      // updated above) changes, from the target square losing its piece.
      const trackingPatch = shoot ? {} : relocateHeroTrackingSquares(gameState, sourceSquare, targetSquare);
      setGameState((prev) => ({ ...prev, fen: optimisticFen, ...trackingPatch }));
    }

    playMoveSound();

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
        if (afterPlayerMove.vs_ai && afterPlayerMove.status === "in_progress" && afterPlayerMove.turn === "black") {
          setAiThinking(true);
          return postAiMove(afterPlayerMove.id).then((afterAiMove) => {
            playMoveSound(); // the computer's own move, played once it actually lands
            setGameState(afterAiMove);
          });
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

  // A reviewed past position (see useMoveHistory) renders with the SAME
  // hero-piece art the live position does, just from that position's own
  // evolution snapshot (history.viewingEvolution) instead of the live
  // gameState - a Dragon/Hydra/etc. still looks like itself when reviewing
  // the exact move it just made, rather than falling back to its plain
  // base-type art.
  const historyPieces = useMemo(() => {
    const snap = history.viewingEvolution || {};
    return buildPiecesWithEvolutions({
      whiteDragonSquare: snap.white_dragon_square,
      blackDragonSquare: snap.black_dragon_square,
      whiteWizardSquares: snap.white_wizard_squares,
      blackWizardSquares: snap.black_wizard_squares,
      whiteArcherSquares: snap.white_archer_squares,
      blackArcherSquares: snap.black_archer_squares,
      whiteHydraSquares: snap.white_hydra_squares,
      blackHydraSquares: snap.black_hydra_squares,
      whiteCyclopsSquares: snap.white_cyclops_squares,
      blackCyclopsSquares: snap.black_cyclops_squares,
      whiteMirrorSquares: snap.white_mirror_squares,
      blackMirrorSquares: snap.black_mirror_squares,
      whiteKingSkinSrc,
    });
  }, [history.viewingEvolution, whiteKingSkinSrc]);

  const squareStyles = useMemo(() => {
    const styles = {};
    if (history.lastMoveSquares) {
      styles[history.lastMoveSquares.from] = LAST_MOVE_STYLE;
      styles[history.lastMoveSquares.to] = LAST_MOVE_STYLE;
    }
    // Legal-move hints are computed against the LIVE position, so they'd be
    // wrong overlaid on a reviewed past one - only the last-move highlight
    // above (which is itself indexed to whatever's being reviewed) applies
    // while history.isViewingHistory.
    if (!history.isViewingHistory) {
      for (const { square, capture, shoot } of legalDestinations) {
        styles[square] = { ...styles[square], ...(shoot ? SHOOT_RING_STYLE : capture ? RING_STYLE : DOT_STYLE) };
      }
    }
    return styles;
  }, [legalDestinations, history.isViewingHistory, history.lastMoveSquares]);

  const options = {
    position: history.viewingFen,
    boardOrientation: "white",
    allowDragging: !moving && !isOver && !history.isViewingHistory,
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
    pieces: history.isViewingHistory ? historyPieces : pieces,
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

      {capturedRows.theirs}

      <div className="board-wrap custom-play-board">
        {history.isViewingHistory ? (
          <div className="game-status-banner reviewing">
            Reviewing move {history.currentIndex} of {history.liveIndex}
          </div>
        ) : (
          <GameStatusBanner status={gameState.status} inCheck={gameState.in_check} turn={gameState.turn} myColor="white" />
        )}
        <Chessboard options={options} />
      </div>

      {capturedRows.mine}

      <div className="move-history-nav">
        <button type="button" onClick={history.goBack} disabled={!history.canGoBack} title="Previous move">
          ‹
        </button>
        <button type="button" onClick={history.goLive} disabled={!history.isViewingHistory} title="Back to live">
          Live
        </button>
        <button type="button" onClick={history.goForward} disabled={!history.canGoForward} title="Next move">
          ›
        </button>
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
            <li key={i}>
              <button
                type="button"
                className={`action-log-entry${history.currentIndex === i + 1 ? " active" : ""}`}
                onClick={() => history.goToIndex(i + 1)}
              >
                {entry}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
