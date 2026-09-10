import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { onlineGameWsUrl, postOnlineMove } from "./api";
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

export default function OnlineGamePlay({ initialGame, myColor, myToken, onExit }) {
  const [gameState, setGameState] = useState(initialGame);
  const [connected, setConnected] = useState(false);
  const [shootArmed, setShootArmed] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState(null);
  const [legalDestinations, setLegalDestinations] = useState([]);
  const [selectedSquare, setSelectedSquare] = useState(null);

  const myPrefix = myColor === "white" ? "w" : "b";
  const isOver = gameState.status !== "in_progress";
  const isMyTurn = gameState.turn === myColor;
  const myArcherSquares = (myColor === "white" ? gameState.white_archer_squares : gameState.black_archer_squares) || [];
  const myWizardSquares = (myColor === "white" ? gameState.white_wizard_squares : gameState.black_wizard_squares) || [];
  const myDragonSquare = myColor === "white" ? gameState.white_dragon_square : gameState.black_dragon_square;
  const hasArchers = myArcherSquares.length > 0;

  // Both players read every state update off the same broadcast, rather
  // than the mover trusting its own POST response and the opponent trusting
  // the socket - keeps both boards guaranteed in sync with one source of
  // truth. Reconnects (with a short delay) if the socket drops mid-game,
  // since Render's free tier can recycle idle connections.
  const gameId = gameState.id;
  const reconnectTimer = useRef(null);

  useEffect(() => {
    let socket;
    let cancelled = false;

    function connect() {
      socket = new WebSocket(onlineGameWsUrl(gameId));
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        try {
          setGameState(JSON.parse(event.data));
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

  function showLegalDestinationsFor(square) {
    const isArcherSquare = myArcherSquares.includes(square);
    setLegalDestinations(
      computeLegalDestinations({
        fen: gameState.fen,
        square,
        isDragonSquare: square === myDragonSquare,
        isWizardSquare: myWizardSquares.includes(square),
        isArcherSquare,
        shootArmed: shootArmed && isArcherSquare,
      })
    );
  }

  function canDragMyTurn({ piece }) {
    return isMyTurn && piece.pieceType[0] === myPrefix;
  }

  function handlePieceDrag({ isSparePiece, square }) {
    if (isSparePiece || !square) return;
    setSelectedSquare(square);
    showLegalDestinationsFor(square);
  }

  function handleSquareClick({ piece, square }) {
    if (moving || isOver) return;
    if (selectedSquare === square || !piece || piece.pieceType[0] !== myPrefix) {
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
    if (!targetSquare || moving || isOver || !isMyTurn) return false;
    if (piece.pieceType[0] !== myPrefix) return false;

    const shoot = shootArmed && myArcherSquares.includes(sourceSquare);

    setMoving(true);
    setError(null);
    let succeeded = false;
    try {
      // The move's real effect arrives back over the socket (both players
      // read from that one broadcast) - this request just submits it.
      await postOnlineMove({
        game_id: gameState.id,
        player_token: myToken,
        from_square: sourceSquare,
        to_square: targetSquare,
        shoot,
      });
      succeeded = true;
      setShootArmed(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setMoving(false);
    }

    return succeeded && !shoot;
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
    boardStyle: { borderRadius: "10px", boxShadow: "0 10px 30px rgba(0,0,0,0.25)" },
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

      <div className="board-wrap custom-play-board">
        <Chessboard options={options} />
      </div>

      <div className="shoot-toggle-row">
        <button
          type="button"
          className={`shoot-toggle-btn${shootArmed ? " active" : ""}`}
          disabled={!hasArchers || isOver || moving || !isMyTurn}
          onClick={() => setShootArmed((v) => !v)}
        >
          {shootArmed ? "Shoot armed — drag your Archer to its target" : "Aim Archer Shot"}
        </button>
        {!hasArchers && <span className="shoot-toggle-hint">No Archer in your deck</span>}
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
