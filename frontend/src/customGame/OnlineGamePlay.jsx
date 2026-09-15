import { useEffect, useMemo, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { onlineGameWsUrl, postOnlineMove } from "./api";
import { FLAT_2D_BOARD_COLORS, buildPiecesWithEvolutions } from "../pieces/flat2dPieces";
import { KING_SKINS, useEquippedSkin } from "./skinStore";
import { computeLegalDestinations, isArcherShootMove, relocateHeroTrackingSquares, tryOptimisticFen } from "./legalMoves";
import { playMoveSound, warmUpAudio } from "./sound";
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
// A queued premove's from/to squares (see the premove state below) - a
// distinct blue so it's never confused with the yellow last-move highlight
// or the black hint dots/rings, matching the color premoves conventionally
// use elsewhere (chess.com included).
const PREMOVE_STYLE = { background: "rgba(59, 130, 246, 0.45)" };

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
  // At most one queued premove - {from, to} | null. Dropping my own piece
  // during the opponent's turn queues one instead of submitting right away
  // (see handlePieceDrop); the effect below fires it for real the instant
  // it actually becomes my turn. Never validated up front beyond "it's my
  // own piece" - if the position has since changed enough to make it
  // illegal, the normal move-rejection path (the .catch() in submitMove)
  // handles that exactly like a bad move typed in on your own turn would.
  const [premove, setPremove] = useState(null);
  const history = useMoveHistory(gameState);
  const capturedRows = useCapturedRows(gameState, myColor);

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
  const myArcherSquare = myColor === "white" ? gameState.white_archer_square : gameState.black_archer_square;
  const myPopeSquare = myColor === "white" ? gameState.white_pope_square : gameState.black_pope_square;
  const myDragonSquares = (myColor === "white" ? gameState.white_dragon_squares : gameState.black_dragon_squares) || [];
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

  // Pays the AudioContext's one-time ~250-300ms construction cost here, at
  // mount, instead of on a player's first drop - see warmUpAudio's own
  // comment (sound.js). Without this, that cost lands synchronously right
  // after the very first optimistic move update, blocking React from
  // actually rendering it - the "moving a piece isn't instant" bug.
  useEffect(() => {
    warmUpAudio();
  }, []);

  useEffect(() => {
    let socket;
    let cancelled = false;
    // Updated on every inbound frame, pings (see below) included - the
    // watchdog below uses this to notice a connection that's gone silently
    // dead, which onclose alone can't be trusted to catch (see its comment).
    let lastMessageAt = Date.now();

    function connect() {
      lastMessageAt = Date.now();
      socket = new WebSocket(onlineGameWsUrl(gameId));
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        lastMessageAt = Date.now();
        try {
          const next = JSON.parse(event.data);
          // A keepalive frame (see backend's _hold_open) - nothing to apply,
          // its only job is refreshing lastMessageAt above.
          if (next.type === "ping") return;
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

    // The backend pings every 20s whenever there's no real traffic (see
    // _hold_open in online_game_routes.py), so going quiet much longer than
    // that means the connection died without a clean close frame - a proxy
    // (Render's included) can silently drop an idle socket without telling
    // either side, which otherwise leaves this stuck showing only a stale
    // optimistic guess indefinitely: onclose never fires, so the normal
    // reconnect above never runs, while the browser's own dead-TCP
    // detection can take a very long time (or never trigger at all) behind
    // a proxy that just stops relaying frames. Forcing a close here instead
    // routes through that same onclose -> reconnect path on our own schedule.
    const watchdog = setInterval(() => {
      if (Date.now() - lastMessageAt > 45000) socket?.close();
    }, 10000);

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer.current);
      clearInterval(watchdog);
      socket?.close();
    };
  }, [gameId]);

  // Works for either color, not just mine - a click-to-preview should show
  // what an opponent's piece could do too (see the isWhite branches below),
  // unlike handlePieceDrop/tryOptimisticFen below which are only ever about
  // MY own move and so stay hardcoded to "my" fields.
  function showLegalDestinationsFor(square, colorPrefix) {
    const isWhite = colorPrefix === "w";
    const dragonSquares = (isWhite ? gameState.white_dragon_squares : gameState.black_dragon_squares) || [];
    const popeSquare = isWhite ? gameState.white_pope_square : gameState.black_pope_square;
    const archerSquare = isWhite ? gameState.white_archer_square : gameState.black_archer_square;
    const hydraSquares = (isWhite ? gameState.white_hydra_squares : gameState.black_hydra_squares) || [];
    const cyclopsSquares = (isWhite ? gameState.white_cyclops_squares : gameState.black_cyclops_squares) || [];
    const mirrorSquares = (isWhite ? gameState.white_mirror_squares : gameState.black_mirror_squares) || [];
    const opponentLastType = isWhite ? gameState.black_last_moved_type : gameState.white_last_moved_type;
    const mimicIsHydra = isWhite ? gameState.black_last_moved_was_hydra : gameState.white_last_moved_was_hydra;
    setLegalDestinations(
      computeLegalDestinations({
        fen: gameState.fen,
        square,
        isDragonSquare: dragonSquares.includes(square),
        isPopeSquare: square === popeSquare,
        isArcherSquare: square === archerSquare,
        isHydraSquare: hydraSquares.includes(square),
        isCyclopsSquare: cyclopsSquares.includes(square),
        isMirrorSquare: mirrorSquares.includes(square),
        mirrorMimicType: opponentLastType ? opponentLastType.toLowerCase() : null,
        mirrorMimicIsHydra: mimicIsHydra,
        ownPopeSquare: popeSquare,
      })
    );
  }

  // Allows dragging my own piece even on the opponent's turn - that's what
  // makes a premove possible at all (see handlePieceDrop). Still only ever
  // my own piece, and never while reviewing history or once the game's over.
  function canDragMyTurn({ piece }) {
    return !isOver && !history.isViewingHistory && piece.pieceType[0] === myPrefix;
  }

  function handlePieceDrag({ isSparePiece, square, piece }) {
    if (isSparePiece || !square || history.isViewingHistory) return;
    setSelectedSquare(square);
    showLegalDestinationsFor(square, piece.pieceType[0]);
  }

  // Previewing works for either side's pieces, and regardless of whose turn
  // it is or whether a move is currently in flight - it's a read-only hint,
  // not an action, so it shouldn't be gated the way actually dropping a
  // piece is (see handlePieceDrop's own guard for that). Disabled while
  // reviewing a past position though, since the hint would be computed
  // against the LIVE gameState, not whatever position is actually on screen.
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

  // The actual move submission - shared by a real drop (called directly)
  // and a queued premove (called by the effect below once it's actually my
  // turn). `shoot` is always recomputed fresh against whatever gameState is
  // current at the moment this runs, never trusted from whenever a premove
  // was originally queued - the position (and so which squares an Archer
  // can actually shoot) may have changed while it was waiting.
  function submitMove(sourceSquare, targetSquare) {
    // No more "arm the shot" toggle - an Archer drop is a shoot exactly
    // when the target is one of its knight's-move capture squares, and a
    // relocate otherwise (tryOptimisticFen/the server independently reject
    // anything that's neither).
    const shoot = sourceSquare === myArcherSquare && isArcherShootMove(gameState.fen, sourceSquare, targetSquare);

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
      isDragonSquare: myDragonSquares.includes(sourceSquare),
      isPopeSquare: sourceSquare === myPopeSquare,
      isArcherSquare: sourceSquare === myArcherSquare,
      isHydraSquare: myHydraSquares.includes(sourceSquare),
      isCyclopsSquare: myCyclopsSquares.includes(sourceSquare),
      isMirrorSquare: myMirrorSquares.includes(sourceSquare),
      mirrorMimicType,
      mirrorMimicIsHydra,
      ownPopeSquare: myPopeSquare,
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

  function handlePieceDrop({ sourceSquare, targetSquare, piece }) {
    setLegalDestinations([]);
    setSelectedSquare(null);
    if (!targetSquare || moving || isOver || history.isViewingHistory) return false;
    if (piece.pieceType[0] !== myPrefix) return false;

    if (!isMyTurn) {
      // Premove: queue it instead of submitting now (see submitMove and the
      // effect below for where it actually fires) - nothing has really
      // moved yet, so the piece must snap back to sourceSquare (return
      // false) rather than visually relocating.
      setPremove({ from: sourceSquare, to: targetSquare });
      return false;
    }

    return submitMove(sourceSquare, targetSquare);
  }

  // Fires a queued premove the instant it actually becomes my turn - not
  // re-validated against the current position beyond what submitMove
  // itself already does for a normal drop (the server is the final word
  // either way; a premove that's no longer legal just gets rejected and
  // rolled back exactly like a bad on-turn move would).
  useEffect(() => {
    if (!isMyTurn || !premove || isOver) return;
    const { from, to } = premove;
    setPremove(null);
    submitMove(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMyTurn, isOver]);

  const pieces = useMemo(
    () =>
      buildPiecesWithEvolutions({
        whiteDragonSquares: gameState.white_dragon_squares,
        blackDragonSquares: gameState.black_dragon_squares,
        whitePopeSquare: gameState.white_pope_square,
        blackPopeSquare: gameState.black_pope_square,
        whiteArcherSquare: gameState.white_archer_square,
        blackArcherSquare: gameState.black_archer_square,
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
      gameState.white_dragon_squares,
      gameState.black_dragon_squares,
      gameState.white_pope_square,
      gameState.black_pope_square,
      gameState.white_archer_square,
      gameState.black_archer_square,
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

  // A reviewed past position (see useMoveHistory) renders with the SAME
  // hero-piece art the live position does, just from that position's own
  // evolution snapshot (history.viewingEvolution) instead of the live
  // gameState - a Dragon/Hydra/etc. still looks like itself when reviewing
  // the exact move it just made, rather than falling back to its plain
  // base-type art.
  const historyPieces = useMemo(() => {
    const snap = history.viewingEvolution || {};
    return buildPiecesWithEvolutions({
      whiteDragonSquares: snap.white_dragon_squares,
      blackDragonSquares: snap.black_dragon_squares,
      whitePopeSquare: snap.white_pope_square,
      blackPopeSquare: snap.black_pope_square,
      whiteArcherSquare: snap.white_archer_square,
      blackArcherSquare: snap.black_archer_square,
      whiteHydraSquares: snap.white_hydra_squares,
      blackHydraSquares: snap.black_hydra_squares,
      whiteCyclopsSquares: snap.white_cyclops_squares,
      blackCyclopsSquares: snap.black_cyclops_squares,
      whiteMirrorSquares: snap.white_mirror_squares,
      blackMirrorSquares: snap.black_mirror_squares,
      whiteKingSkinSrc: myColor === "white" ? myKingSkinSrc : undefined,
      blackKingSkinSrc: myColor === "black" ? myKingSkinSrc : undefined,
    });
  }, [history.viewingEvolution, myColor, myKingSkinSrc]);

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
    // Drawn last so it always wins over a last-move/hint style on the same
    // square - a queued premove is the more important thing to see.
    if (premove) {
      styles[premove.from] = { ...styles[premove.from], ...PREMOVE_STYLE };
      styles[premove.to] = { ...styles[premove.to], ...PREMOVE_STYLE };
    }
    return styles;
  }, [legalDestinations, history.isViewingHistory, history.lastMoveSquares, premove]);

  const options = {
    position: history.viewingFen,
    boardOrientation: myColor,
    // No longer gated on isMyTurn - canDragMyTurn (below) already restricts
    // this to my own piece only, and allowing it off-turn too is what makes
    // a premove possible in the first place (see handlePieceDrop).
    allowDragging: !moving && !isOver && !history.isViewingHistory,
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
    pieces: history.isViewingHistory ? historyPieces : pieces,
  };

  let turnLabel;
  if (isOver) turnLabel = STATUS_LABEL[gameState.status];
  else if (!connected) turnLabel = "Reconnecting…";
  else if (isMyTurn) turnLabel = "Your move";
  else turnLabel = premove ? "Opponent's move — premove queued" : "Opponent's move";

  return (
    <div className="custom-play">
      <div className="custom-play-toolbar">
        <span className="custom-play-turn">{turnLabel}</span>
        <div className="custom-play-toolbar-actions">
          {premove && (
            <button type="button" onClick={() => setPremove(null)} title="Cancel the queued premove">
              Cancel Premove
            </button>
          )}
          <button type="button" onClick={onExit}>
            New Game
          </button>
        </div>
      </div>

      {capturedRows.theirs}

      <div className="board-wrap custom-play-board">
        {history.isViewingHistory ? (
          <div className="game-status-banner reviewing">
            Reviewing move {history.currentIndex} of {history.liveIndex}
          </div>
        ) : (
          <GameStatusBanner status={gameState.status} inCheck={gameState.in_check} turn={gameState.turn} myColor={myColor} />
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
          <strong>Your Dragons:</strong> {myDragonSquares.length > 0 ? myDragonSquares.join(", ") : "none in play"}
        </div>
        <div>
          <strong>Your Pope:</strong> {myPopeSquare ? `at ${myPopeSquare}` : "none evolved / destroyed"}
        </div>
        <div>
          <strong>Your Archer:</strong> {myArcherSquare ? `at ${myArcherSquare}` : "none evolved / destroyed"}
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
