import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { onlineGameWsUrl, postOnlineMove } from "./api";
import { FLAT_2D_BOARD_COLORS, buildPiecesWithEvolutions } from "../pieces/flat2dPieces";
import { KING_SKINS, useEquippedSkin } from "./skinStore";
import { computeLegalDestinations, isArcherShootMove, relocateHeroTrackingSquares, tryOptimisticFen } from "./legalMoves";
import { playMoveSound } from "./sound";
import GameStatusBanner from "./GameStatusBanner";

const DOT_STYLE = { backgroundImage: "radial-gradient(circle, rgba(20,20,20,0.35) 19%, transparent 20%)" };
const RING_STYLE = { boxShadow: "inset 0 0 0 4px rgba(20,20,20,0.35)" };
const SHOOT_RING_STYLE = { boxShadow: "inset 0 0 0 4px rgba(200,60,30,0.6)" };

const STATUS_LABEL = {
  in_progress: "In progress",
  checkmate: "Checkmate",
  stalemate: "Stalemate",
  draw: "Draw",
};

export default function OnlineGamePlay({ initialGame, myColor, myToken, onExit }) {
  const [gameState, setGameState] = useState(initialGame);
  const [connected, setConnected] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState(null);
  const [legalDestinations, setLegalDestinations] = useState([]);
  const [selectedSquare, setSelectedSquare] = useState(null);

  const myPrefix = myColor === "white" ? "w" : "b";
  // Only my own King wears my equipped skin - the opponent's equipped skin
  // isn't synced over the wire, so their King just stays the classic art.
  // Which image depends on which side I actually am: White gets the skin's
  // recolored-to-white variant, Black gets its normal look (see
  // skinStore.js).
  const equippedSkin = useEquippedSkin();
  const myKingSkinSrc = myColor === "white" ? KING_SKINS[equippedSkin].whiteTeamSrc : KING_SKINS[equippedSkin].src;
  const isOver = gameState.status !== "in_progress";
  const isMyTurn = gameState.turn === myColor;
  const myArcherSquares = (myColor === "white" ? gameState.white_archer_squares : gameState.black_archer_squares) || [];
  const myWizardSquares = (myColor === "white" ? gameState.white_wizard_squares : gameState.black_wizard_squares) || [];
  const myDragonSquare = myColor === "white" ? gameState.white_dragon_square : gameState.black_dragon_square;
  const myHydraSquares = (myColor === "white" ? gameState.white_hydra_squares : gameState.black_hydra_squares) || [];
  const myCyclopsSquares = (myColor === "white" ? gameState.white_cyclops_squares : gameState.black_cyclops_squares) || [];
  const myMirrorSquares = (myColor === "white" ? gameState.white_mirror_squares : gameState.black_mirror_squares) || [];
  // My Mirror mimics whatever my OPPONENT last moved.
  const opponentLastMovedType = myColor === "white" ? gameState.black_last_moved_type : gameState.white_last_moved_type;
  const mirrorMimicType = opponentLastMovedType ? opponentLastMovedType.toLowerCase() : null;
  const mirrorMimicIsHydra =
    myColor === "white" ? gameState.black_last_moved_was_hydra : gameState.white_last_moved_was_hydra;

  // Both players read every state update off the same broadcast, rather
  // than the mover trusting its own POST response and the opponent trusting
  // the socket - keeps both boards guaranteed in sync with one source of
  // truth. Reconnects (with a short delay) if the socket drops mid-game,
  // since Render's free tier can recycle idle connections.
  const gameId = gameState.id;
  const reconnectTimer = useRef(null);
  // Set right when I fire off my own move (after already playing its sound
  // instantly - see handlePieceDrop), so the broadcast that confirms it
  // moments later doesn't play a second sound for the same move. Anything
  // else that grows the action log - the opponent's move, or a puzzle-free
  // reconnect landing on an already-current state - falls through to the
  // length check below instead.
  const pendingOwnMoveRef = useRef(false);

  useEffect(() => {
    let socket;
    let cancelled = false;

    function connect() {
      socket = new WebSocket(onlineGameWsUrl(gameId));
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        try {
          const next = JSON.parse(event.data);
          setGameState((prev) => {
            const isNewMove = next.action_log.length > prev.action_log.length;
            if (isNewMove && !pendingOwnMoveRef.current) playMoveSound();
            pendingOwnMoveRef.current = false;
            return next;
          });
        } catch {
          // ignore malformed frames
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!cancelled) {
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };
      socket.onerror = () => socket.close();
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer.current);
      socket?.close();
    };
  }, [gameId]);

  // Works for either color, not just mine - a click-to-preview should show
  // what an opponent's piece could do too (see the isWhite branches below),
  // unlike handlePieceDrop/tryOptimisticFen below which are only ever about
  // MY own move and so stay hardcoded to "my" fields.
  function showLegalDestinationsFor(square, colorPrefix) {
    const isWhite = colorPrefix === "w";
    const dragonSquare = isWhite ? gameState.white_dragon_square : gameState.black_dragon_square;
    const wizardSquares = (isWhite ? gameState.white_wizard_squares : gameState.black_wizard_squares) || [];
    const archerSquares = (isWhite ? gameState.white_archer_squares : gameState.black_archer_squares) || [];
    const hydraSquares = (isWhite ? gameState.white_hydra_squares : gameState.black_hydra_squares) || [];
    const cyclopsSquares = (isWhite ? gameState.white_cyclops_squares : gameState.black_cyclops_squares) || [];
    const mirrorSquares = (isWhite ? gameState.white_mirror_squares : gameState.black_mirror_squares) || [];
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

  function canDragMyTurn({ piece }) {
    return isMyTurn && piece.pieceType[0] === myPrefix;
  }

  function handlePieceDrag({ isSparePiece, square, piece }) {
    if (isSparePiece || !square) return;
    setSelectedSquare(square);
    showLegalDestinationsFor(square, piece.pieceType[0]);
  }

  // Previewing works for either side's pieces, and regardless of whose turn
  // it is or whether a move is currently in flight - it's a read-only hint,
  // not an action, so it shouldn't be gated the way actually dropping a
  // piece is (see handlePieceDrop's own guard for that).
  function handleSquareClick({ piece, square }) {
    if (isOver) return;
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
    if (!targetSquare || moving || isOver || !isMyTurn) return false;
    if (piece.pieceType[0] !== myPrefix) return false;

    // No more "arm the shot" toggle - an Archer drop is a shoot exactly
    // when the target is one of its knight's-move capture squares, and a
    // relocate otherwise (tryOptimisticFen/the server independently reject
    // anything that's neither).
    const shoot = myArcherSquares.includes(sourceSquare) && isArcherShootMove(gameState.fen, sourceSquare, targetSquare);

    // Show my own move immediately rather than waiting on the round trip -
    // see tryOptimisticFen's own comment for exactly which moves this
    // covers. The authoritative broadcast (in the WS effect above)
    // overwrites this guess moments later regardless; if the server
    // rejects the move outright, the .catch() below rolls the board back.
    //
    // Deliberately NOT awaited before returning: react-chessboard appears
    // to hold the drag/drop visual open until this function's return value
    // is known, so awaiting the network round trip here would recreate the
    // exact lag this is meant to fix. The request instead runs in the
    // background and this returns synchronously with just the optimistic
    // guess.
    const previousGameState = gameState;
    let appliedOptimistic = false;
    const optimisticFen = tryOptimisticFen(gameState.fen, sourceSquare, targetSquare, {
      isDragonSquare: sourceSquare === myDragonSquare,
      isWizardSquare: myWizardSquares.includes(sourceSquare),
      isArcherSquare: myArcherSquares.includes(sourceSquare),
      isHydraSquare: myHydraSquares.includes(sourceSquare),
      isCyclopsSquare: myCyclopsSquares.includes(sourceSquare),
      isMirrorSquare: myMirrorSquares.includes(sourceSquare),
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
    pendingOwnMoveRef.current = true;

    setMoving(true);
    setError(null);
    postOnlineMove({
      game_id: gameState.id,
      player_token: myToken,
      from_square: sourceSquare,
      to_square: targetSquare,
      shoot,
    })
      .catch((e) => {
        pendingOwnMoveRef.current = false; // never landed - don't suppress the next real broadcast
        setError(e.message);
        if (appliedOptimistic) setGameState(previousGameState);
      })
      .finally(() => setMoving(false));

    // A shoot never relocates the Archer - always snap it back regardless
    // of the request's outcome, since gameState (left untouched above)
    // already reflects the truth either way once the broadcast lands.
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
        whiteKingSkinSrc: myColor === "white" ? myKingSkinSrc : undefined,
        blackKingSkinSrc: myColor === "black" ? myKingSkinSrc : undefined,
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
      myColor,
      myKingSkinSrc,
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
    boardOrientation: myColor,
    allowDragging: !moving && !isOver && isMyTurn,
    canDragPiece: canDragMyTurn,
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

  let turnLabel;
  if (isOver) turnLabel = STATUS_LABEL[gameState.status];
  else if (!connected) turnLabel = "Reconnecting…";
  else turnLabel = isMyTurn ? "Your move" : "Opponent's move";

  return (
    <div className="custom-play">
      <div className="custom-play-toolbar">
        <span className="custom-play-turn">{turnLabel}</span>
        <button type="button" onClick={onExit}>
          New Game
        </button>
      </div>

      <GameStatusBanner status={gameState.status} inCheck={gameState.in_check} turn={gameState.turn} myColor={myColor} />

      <div className="board-wrap custom-play-board">
        <Chessboard options={options} />
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="custom-play-status">
        <div>
          <strong>Your Dragon:</strong> {myDragonSquare ? `at ${myDragonSquare}` : "none evolved / destroyed"}
        </div>
        <div>
          <strong>Your Wizards:</strong> {myWizardSquares.length > 0 ? myWizardSquares.join(", ") : "none evolved / destroyed"}
        </div>
        <div>
          <strong>Your Archers:</strong> {myArcherSquares.length > 0 ? myArcherSquares.join(", ") : "none in play"}
        </div>
        <div>
          <strong>Your Hydras:</strong> {myHydraSquares.length > 0 ? myHydraSquares.join(", ") : "none in play"}
        </div>
        <div>
          <strong>Your Cyclopses:</strong> {myCyclopsSquares.length > 0 ? myCyclopsSquares.join(", ") : "none in play"}
        </div>
        <div>
          <strong>Your Mirrors:</strong> {myMirrorSquares.length > 0 ? myMirrorSquares.join(", ") : "none in play"}
        </div>
        <div>
          <strong>Opponent:</strong> Human ({myColor === "white" ? "black" : "white"})
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
